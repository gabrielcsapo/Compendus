//
//  AttributedStringBuilder.swift
//  Compendus
//
//  Converts ContentNode AST into NSAttributedString for native rendering.
//  Maps reader settings (font, size, color, line height) directly to
//  NSAttributedString attributes. CSS-derived BlockStyle and TextStyle
//  are applied per-node for layout (alignment, indent, margins) and
//  inline styling (small-caps, uppercase).
//

import UIKit
import AVFoundation
import os.log

private let logger = Logger(subsystem: "com.compendus.reader", category: "AttrStringBuilder")

// MARK: - Offset Map

/// Maps character ranges in the attributed string back to content blocks.
public struct OffsetMap {
    public struct Entry {
        public let range: NSRange
        public let blockIndex: Int
    }
    public var entries: [Entry] = []

    public init() {}

    /// Find the entry containing a character offset.
    public func entry(at offset: Int) -> Entry? {
        entries.first { NSLocationInRange(offset, $0.range) }
    }
}

// MARK: - Media Attachment Info

/// Tracks media attachments (video/audio) embedded in the attributed string
/// so that taps on them can be routed to playback.
public struct MediaAttachment {
    public enum Kind { case video, audio }
    public let kind: Kind
    public let url: URL
    public let range: NSRange
}

/// Describes a CSS-floated image that should be rendered as a subview with
/// an exclusion path so text wraps around it.
public struct FloatingElement {
    public let imageURL: URL
    public let size: CGSize
    public let floatSide: CSSFloat       // .left or .right
    public let marginInline: CGFloat     // margin between image and wrapping text
    public let marginTop: CGFloat
    public let marginBottom: CGFloat
    public let markerIndex: Int          // character index in full attributed string
    public let alt: String?
}

// MARK: - Attributed String Builder

public class AttributedStringBuilder {
    // Prevent the compiler from generating an isolated deinit.
    nonisolated deinit {}

    private let font: UIFont
    private let boldFont: UIFont
    private let italicFont: UIFont
    private let boldItalicFont: UIFont
    private let monoFont: UIFont
    private let textColor: UIColor
    private let backgroundColor: UIColor
    private let accentColor: UIColor
    private let fontSize: CGFloat
    private let lineHeight: CGFloat
    private let fontFamily: ReaderFont
    let contentWidth: CGFloat
    let contentHeight: CGFloat

    /// Media attachments found during build (video/audio placeholders).
    private(set) var mediaAttachments: [MediaAttachment] = []

    /// Floating elements (CSS float:left/right images) found during build.
    private(set) var floatingElements: [FloatingElement] = []

    @MainActor
    public init(settings: ReaderSettings, contentWidth: CGFloat, contentHeight: CGFloat = .greatestFiniteMagnitude, accentColor: UIColor = .tintColor) {
        self.font = settings.nativeFont
        self.boldFont = settings.nativeBoldFont
        self.italicFont = settings.nativeItalicFont
        self.boldItalicFont = settings.nativeBoldItalicFont
        self.monoFont = settings.nativeMonoFont
        self.textColor = settings.theme.textColor
        self.backgroundColor = settings.theme.backgroundColor
        self.accentColor = accentColor
        self.fontSize = CGFloat(settings.fontSize)
        self.lineHeight = CGFloat(settings.lineHeight)
        self.fontFamily = settings.fontFamily
        self.contentWidth = contentWidth
        self.contentHeight = contentHeight
    }

    public init(theme: ReaderTheme, fontFamily: ReaderFont, fontSize: Double,
         lineHeight: Double, contentWidth: CGFloat, contentHeight: CGFloat = .greatestFiniteMagnitude, accentColor: UIColor = .tintColor) {
        self.fontFamily = fontFamily
        self.fontSize = CGFloat(fontSize)
        self.lineHeight = CGFloat(lineHeight)
        self.textColor = theme.textColor
        self.backgroundColor = theme.backgroundColor
        self.accentColor = accentColor
        self.contentWidth = contentWidth
        self.contentHeight = contentHeight

        let size = CGFloat(fontSize)
        let base: UIFont = {
            if let f = UIFont(name: fontFamily.previewFontName, size: size) { return f }
            return fontFamily == .sansSerif ? .systemFont(ofSize: size) :
                (UIFont(name: "Georgia", size: size) ?? .systemFont(ofSize: size))
        }()
        self.font = base
        self.boldFont = {
            if let d = base.fontDescriptor.withSymbolicTraits(.traitBold) {
                return UIFont(descriptor: d, size: size)
            }
            return .boldSystemFont(ofSize: size)
        }()
        self.italicFont = {
            if let d = base.fontDescriptor.withSymbolicTraits(.traitItalic) {
                return UIFont(descriptor: d, size: size)
            }
            return .italicSystemFont(ofSize: size)
        }()
        self.boldItalicFont = {
            if let d = base.fontDescriptor.withSymbolicTraits([.traitBold, .traitItalic]) {
                return UIFont(descriptor: d, size: size)
            }
            return .boldSystemFont(ofSize: size)
        }()
        self.monoFont = .monospacedSystemFont(ofSize: size * 0.9, weight: .regular)
    }

    /// Build an NSAttributedString from content nodes.
    /// Returns the string, an offset map for highlight mapping, and a plain-text-to-attributed-string map for read-along alignment.
    public func build(from nodes: [ContentNode]) -> (NSAttributedString, OffsetMap, PlainTextToAttrStringMap) {
        let result = NSMutableAttributedString()
        var offsetMap = OffsetMap()
        var plainTextMap = PlainTextToAttrStringMap()
        mediaAttachments = []
        floatingElements = []

        // Build the plain text in parallel to track offsets
        var plainTextOffset = 0
        for (index, node) in nodes.enumerated() {
            let attrStart = result.length
            let ptStart = plainTextOffset
            appendNode(node, to: result, depth: 0)
            let attrRange = NSRange(location: attrStart, length: result.length - attrStart)
            if attrRange.length > 0 {
                offsetMap.entries.append(OffsetMap.Entry(range: attrRange, blockIndex: index))
            }

            // Compute how much plain text this node contributes
            let ptLength = Self.plainTextLength(of: node)
            if ptLength > 0 && attrRange.length > 0 {
                plainTextMap.entries.append(PlainTextToAttrStringMap.Entry(
                    plainTextRange: NSRange(location: ptStart, length: ptLength),
                    attrStringRange: attrRange
                ))
            }
            plainTextOffset += ptLength
        }

        // Remove trailing newline if present, and shrink the last offset map entry to match.
        if result.length > 0 && result.string.hasSuffix("\n") {
            result.deleteCharacters(in: NSRange(location: result.length - 1, length: 1))
            // The last entry's range now extends 1 past the end — clamp it.
            if var last = offsetMap.entries.last {
                let clampedLength = min(last.range.length, result.length - last.range.location)
                if clampedLength != last.range.length {
                    last = OffsetMap.Entry(range: NSRange(location: last.range.location, length: clampedLength), blockIndex: last.blockIndex)
                    offsetMap.entries[offsetMap.entries.count - 1] = last
                }
            }
        }

        return (result, offsetMap, plainTextMap)
    }

    /// Compute the plain text character count for a content node (matching extractPlainText logic).
    private static func plainTextLength(of node: ContentNode) -> Int {
        var text = ""
        appendPlainText(from: node, to: &text)
        return text.count
    }

    private static func appendPlainText(from node: ContentNode, to text: inout String) {
        switch node {
        case .paragraph(let runs, _), .heading(_, let runs, _):
            for run in runs { text += run.text }
            text += "\n"
        case .codeBlock(let code):
            text += code + "\n"
        case .list(_, let items, _):
            for item in items {
                for child in item.children {
                    appendPlainText(from: child, to: &text)
                }
            }
        case .blockquote(let children), .container(let children, _):
            for child in children {
                appendPlainText(from: child, to: &text)
            }
        case .table(let rows):
            for row in rows {
                for cell in row.cells {
                    for run in cell.runs { text += run.text }
                    text += "\t"
                }
                text += "\n"
            }
        case .image(_, let alt, _, _, _):
            if let alt = alt { text += alt + "\n" }
        case .horizontalRule:
            text += "\n"
        case .video, .audio:
            break
        }
    }

    // MARK: - Node Rendering

    private func appendNode(_ node: ContentNode, to result: NSMutableAttributedString, depth: Int) {
        switch node {
        case .paragraph(let runs, let blockStyle):
            // Skip hidden elements
            if blockStyle.display == CSSDisplay.none { return }
            appendParagraph(runs: runs, blockStyle: blockStyle, to: result, depth: depth)

        case .heading(let level, let runs, let blockStyle):
            appendHeading(level: level, runs: runs, blockStyle: blockStyle, to: result)

        case .image(let url, let alt, let width, let height, let style):
            appendImage(url: url, alt: alt, hintWidth: width, hintHeight: height, style: style, to: result)

        case .list(let ordered, let items, let blockStyle):
            appendList(ordered: ordered, items: items, blockStyle: blockStyle, to: result, depth: depth)

        case .blockquote(let children):
            appendBlockquote(children: children, to: result, depth: depth)

        case .codeBlock(let text):
            appendCodeBlock(text: text, to: result)

        case .horizontalRule:
            appendHorizontalRule(to: result)

        case .table(let rows):
            appendTable(rows: rows, to: result)

        case .container(let children, let blockStyle):
            if blockStyle.display == CSSDisplay.none { return }
            for child in children {
                appendNode(child, to: result, depth: depth)
            }

        case .video(let url, let poster, let style):
            appendVideo(url: url, poster: poster, style: style, to: result)

        case .audio(let url, let style):
            appendAudio(url: url, style: style, to: result)
        }
    }

    // MARK: - Paragraphs

    private func appendParagraph(runs: [TextRun], blockStyle: BlockStyle,
                                  to result: NSMutableAttributedString, depth: Int) {
        let paraStyle = makeParagraphStyle()

        // Apply CSS block styles
        applyBlockStyleToParaStyle(blockStyle, paraStyle: paraStyle, depth: depth)

        let startIndex = result.length
        appendRuns(runs, to: result, baseFont: font, paragraphStyle: paraStyle)
        result.append(NSAttributedString(string: "\n"))

        // Apply block background color
        if let bg = blockStyle.backgroundColor {
            let range = NSRange(location: startIndex, length: result.length - startIndex)
            result.addAttribute(.backgroundColor, value: bg, range: range)
        }
    }

    /// Apply common block style properties (alignment, margins, padding, direction) to a paragraph style.
    private func applyBlockStyleToParaStyle(_ blockStyle: BlockStyle, paraStyle: NSMutableParagraphStyle, depth: Int = 0) {
        if let align = blockStyle.textAlign {
            switch align {
            case .center: paraStyle.alignment = .center
            case .right: paraStyle.alignment = .right
            case .left: paraStyle.alignment = .left
            case .justify: paraStyle.alignment = .justified
            }
        }

        if let indent = blockStyle.textIndent {
            paraStyle.firstLineHeadIndent = max(0, indent.resolve(relativeTo: fontSize))
        } else if depth > 0 {
            paraStyle.firstLineHeadIndent = fontSize * 1.2
        }

        if let marginTop = blockStyle.marginTop {
            paraStyle.paragraphSpacingBefore = max(0, marginTop.resolve(relativeTo: fontSize))
        }
        if let marginBottom = blockStyle.marginBottom {
            paraStyle.paragraphSpacing = max(0, marginBottom.resolve(relativeTo: fontSize))
        }

        if let marginLeft = blockStyle.marginLeft {
            let leftIndent = max(0, marginLeft.resolve(relativeTo: fontSize))
            paraStyle.headIndent = leftIndent
            if let indent = blockStyle.textIndent {
                paraStyle.firstLineHeadIndent = max(0, leftIndent + indent.resolve(relativeTo: fontSize))
            } else if depth == 0 {
                paraStyle.firstLineHeadIndent = leftIndent
            }
        }

        // CSS padding (approximated as additional spacing/indent)
        if let pl = blockStyle.paddingLeft {
            let padding = pl.resolve(relativeTo: fontSize)
            paraStyle.headIndent += padding
            paraStyle.firstLineHeadIndent += padding
        }
        if let pr = blockStyle.paddingRight {
            paraStyle.tailIndent = -pr.resolve(relativeTo: fontSize)
        }
        if let pt = blockStyle.paddingTop {
            paraStyle.paragraphSpacingBefore += pt.resolve(relativeTo: fontSize)
        }
        if let pb = blockStyle.paddingBottom {
            paraStyle.paragraphSpacing += pb.resolve(relativeTo: fontSize)
        }

        // Writing direction
        if let dir = blockStyle.writingDirection {
            paraStyle.baseWritingDirection = dir
        }
    }

    // MARK: - Headings

    private func appendHeading(level: Int, runs: [TextRun], blockStyle: BlockStyle,
                                to result: NSMutableAttributedString) {
        let scale: CGFloat
        switch level {
        case 1: scale = 1.6
        case 2: scale = 1.4
        case 3: scale = 1.2
        default: scale = 1.0
        }

        let headingSize = fontSize * scale
        let headingFont = makeFont(size: headingSize, bold: true)

        let paraStyle = NSMutableParagraphStyle()
        paraStyle.lineHeightMultiple = lineHeight
        paraStyle.paragraphSpacingBefore = headingSize * 0.6
        paraStyle.paragraphSpacing = headingSize * 0.5
        paraStyle.hyphenationFactor = 0
        paraStyle.alignment = .natural

        // Apply CSS overrides (alignment, margins, padding, direction)
        if let align = blockStyle.textAlign {
            switch align {
            case .center: paraStyle.alignment = .center
            case .right: paraStyle.alignment = .right
            case .left: paraStyle.alignment = .left
            case .justify: paraStyle.alignment = .justified
            }
        }
        if let marginTop = blockStyle.marginTop {
            paraStyle.paragraphSpacingBefore = max(0, marginTop.resolve(relativeTo: fontSize))
        }
        if let marginBottom = blockStyle.marginBottom {
            paraStyle.paragraphSpacing = max(0, marginBottom.resolve(relativeTo: fontSize))
        }
        if let dir = blockStyle.writingDirection {
            paraStyle.baseWritingDirection = dir
        }
        if let pl = blockStyle.paddingLeft {
            paraStyle.headIndent += pl.resolve(relativeTo: fontSize)
            paraStyle.firstLineHeadIndent += pl.resolve(relativeTo: fontSize)
        }
        if let pt = blockStyle.paddingTop {
            paraStyle.paragraphSpacingBefore += pt.resolve(relativeTo: fontSize)
        }
        if let pb = blockStyle.paddingBottom {
            paraStyle.paragraphSpacing += pb.resolve(relativeTo: fontSize)
        }

        let startIndex = result.length
        appendRuns(runs, to: result, baseFont: headingFont, paragraphStyle: paraStyle)
        result.append(NSAttributedString(string: "\n"))

        if let bg = blockStyle.backgroundColor {
            let range = NSRange(location: startIndex, length: result.length - startIndex)
            result.addAttribute(.backgroundColor, value: bg, range: range)
        }
    }

    // MARK: - Images

    private func appendImage(url: URL, alt: String?, hintWidth: CGFloat?,
                             hintHeight: CGFloat?, style: MediaStyle,
                             to result: NSMutableAttributedString) {
        guard url.isFileURL else {
            print("[Image] URL is not a file URL: \(url.absoluteString)")
            return
        }

        // Read dimensions from file header only (no pixel decode).
        // CGImageSource reads ~100-500 bytes vs full bitmap decode.
        guard let intrinsicSize = EPUBImageCache.shared.imageDimensions(forPath: url.path) else {
            let exists = FileManager.default.fileExists(atPath: url.path)
            print("[Image] FAILED to read dimensions: \(url.path)")
            print("[Image]   exists=\(exists), alt=\(alt ?? "none")")
            // Image not found — show alt text if available
            if let alt = alt, !alt.isEmpty {
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: italicFont,
                    .foregroundColor: textColor.withAlphaComponent(0.6)
                ]
                result.append(NSAttributedString(string: "[\(alt)]\n", attributes: attrs))
            }
            return
        }

        // Determine target width from CSS, HTML attributes, or default to content width
        let maxWidth = contentWidth
        // Reserve space for surrounding text — images shouldn't fill the entire page
        let maxHeight = contentHeight * 0.75
        var imageWidth: CGFloat
        if let cssW = style.cssWidth {
            imageWidth = min(cssW.resolve(relativeTo: maxWidth), maxWidth)
        } else if let hw = hintWidth, hw > 0 {
            imageWidth = min(hw, maxWidth)
        } else {
            // No CSS or HTML sizing — fill content width (standard EPUB behavior)
            imageWidth = maxWidth
        }

        let scaleFactor = imageWidth / intrinsicSize.width
        var imageHeight: CGFloat
        if let cssH = style.cssHeight {
            imageHeight = min(cssH.resolve(relativeTo: maxHeight), maxHeight)
        } else {
            imageHeight = intrinsicSize.height * scaleFactor
        }

        // If still too tall, scale down further to fit height
        if imageHeight > maxHeight && maxHeight > 0 {
            let heightScale = maxHeight / imageHeight
            imageWidth *= heightScale
            imageHeight = maxHeight
        }

        // CSS float: record as floating element for exclusion-path rendering
        if style.cssFloat == .left || style.cssFloat == .right {
            let marginInline: CGFloat
            if style.cssFloat == .left {
                marginInline = style.marginRight?.resolve(relativeTo: fontSize) ?? fontSize
            } else {
                marginInline = style.marginLeft?.resolve(relativeTo: fontSize) ?? fontSize
            }
            let marginTop = style.marginTop?.resolve(relativeTo: fontSize) ?? 0
            let marginBottom = style.marginBottom?.resolve(relativeTo: fontSize) ?? 0

            // Insert a tiny 1x1 marker attachment so we can find the Y position later
            let markerIndex = result.length
            let markerAttachment = NSTextAttachment()
            markerAttachment.bounds = CGRect(x: 0, y: 0, width: 1, height: 1)
            let markerStyle = NSMutableParagraphStyle()
            markerStyle.paragraphSpacing = 0
            markerStyle.paragraphSpacingBefore = 0
            markerStyle.lineHeightMultiple = 0.01
            let markerStr = NSMutableAttributedString(attachment: markerAttachment)
            markerStr.addAttribute(.paragraphStyle, value: markerStyle,
                                   range: NSRange(location: 0, length: markerStr.length))
            result.append(markerStr)
            result.append(NSAttributedString(string: "\n"))

            floatingElements.append(FloatingElement(
                imageURL: url,
                size: CGSize(width: imageWidth, height: imageHeight),
                floatSide: style.cssFloat!,
                marginInline: marginInline,
                marginTop: marginTop,
                marginBottom: marginBottom,
                markerIndex: markerIndex,
                alt: alt
            ))
            return
        }

        // Non-floated image: lazy attachment with correct bounds but no pixel data.
        // Actual image is loaded at render time via loadImageIfNeeded().
        let displayBounds = CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight)
        let attachment = LazyImageAttachment(
            imageURL: url,
            intrinsicSize: intrinsicSize,
            displayBounds: displayBounds
        )

        let paraStyle = NSMutableParagraphStyle()
        paraStyle.paragraphSpacingBefore = fontSize * 0.5
        paraStyle.paragraphSpacing = fontSize * 0.5
        paraStyle.alignment = .center

        let attachString = NSMutableAttributedString(attachment: attachment)
        attachString.addAttribute(.paragraphStyle, value: paraStyle,
                                  range: NSRange(location: 0, length: attachString.length))

        result.append(attachString)
        result.append(NSAttributedString(string: "\n"))

        // Add alt text caption if available
        if let alt = alt, !alt.isEmpty {
            let captionStyle = NSMutableParagraphStyle()
            captionStyle.alignment = paraStyle.alignment
            captionStyle.paragraphSpacing = fontSize * 0.5

            let captionAttrs: [NSAttributedString.Key: Any] = [
                .font: italicFont,
                .foregroundColor: textColor.withAlphaComponent(0.6),
                .paragraphStyle: captionStyle
            ]
            result.append(NSAttributedString(string: "\(alt)\n", attributes: captionAttrs))
        }
    }

    // MARK: - Video/Audio Placeholders

    private func appendVideo(url: URL, poster: URL?, style: MediaStyle,
                             to result: NSMutableAttributedString) {
        let startIndex = result.length

        // Determine target size from CSS or defaults
        let targetWidth: CGFloat
        if let cssW = style.cssWidth {
            targetWidth = min(cssW.resolve(relativeTo: contentWidth), contentWidth)
        } else {
            targetWidth = contentWidth
        }
        let targetHeight: CGFloat
        if let cssH = style.cssHeight {
            targetHeight = cssH.resolve(relativeTo: contentHeight)
        } else {
            targetHeight = targetWidth * 9 / 16 // default 16:9
        }

        let paraStyle = NSMutableParagraphStyle()
        paraStyle.paragraphSpacingBefore = fontSize * 0.5
        paraStyle.paragraphSpacing = fontSize * 0.5

        switch style.cssFloat {
        case .left: paraStyle.alignment = .left
        case .right: paraStyle.alignment = .right
        default: paraStyle.alignment = .center
        }

        // Generate a video thumbnail with play button overlay
        let thumbnailImage = generateVideoThumbnail(
            url: url, poster: poster,
            targetWidth: targetWidth, targetHeight: targetHeight
        )

        let attachment = NSTextAttachment()
        attachment.image = thumbnailImage
        attachment.bounds = CGRect(x: 0, y: 0, width: targetWidth, height: targetHeight)

        let attachStr = NSMutableAttributedString(attachment: attachment)
        attachStr.addAttribute(.paragraphStyle, value: paraStyle,
                               range: NSRange(location: 0, length: attachStr.length))
        result.append(attachStr)
        result.append(NSAttributedString(string: "\n"))

        let range = NSRange(location: startIndex, length: result.length - startIndex)
        mediaAttachments.append(MediaAttachment(kind: .video, url: url, range: range))
    }

    /// Generate a video thumbnail: use poster image if available, otherwise
    /// extract a frame from the video. The inline player view provides its own
    /// interactive play button, so the thumbnail is just the frame preview.
    private func generateVideoThumbnail(url: URL, poster: URL?,
                                        targetWidth: CGFloat, targetHeight: CGFloat) -> UIImage {
        var baseImage: UIImage?

        // Try poster image first
        if let posterURL = poster, posterURL.isFileURL {
            if let cached = EPUBImageCache.shared.image(forPath: posterURL.path) {
                baseImage = cached
            } else if let loaded = UIImage(contentsOfFile: posterURL.path) {
                EPUBImageCache.shared.setImage(loaded, forPath: posterURL.path)
                baseImage = loaded
            }
        }

        // Try extracting a frame from the video file
        if baseImage == nil, url.isFileURL {
            let asset = AVAsset(url: url)
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            if let cgImage = try? generator.copyCGImage(at: .zero, actualTime: nil) {
                baseImage = UIImage(cgImage: cgImage)
            }
        }

        let size = CGSize(width: targetWidth, height: targetHeight)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            // Draw base image or dark background
            if let base = baseImage {
                base.draw(in: CGRect(origin: .zero, size: size))
            } else {
                textColor.withAlphaComponent(0.1).setFill()
                ctx.fill(CGRect(origin: .zero, size: size))
            }
        }
    }

    private func appendAudio(url: URL, style: MediaStyle,
                             to result: NSMutableAttributedString) {
        let startIndex = result.length

        // Determine width from CSS or default to content width
        let barWidth: CGFloat
        if let cssW = style.cssWidth {
            barWidth = min(cssW.resolve(relativeTo: contentWidth), contentWidth)
        } else {
            barWidth = contentWidth
        }
        let barHeight: CGFloat = max(fontSize * 2.8, 44)

        let paraStyle = NSMutableParagraphStyle()
        paraStyle.paragraphSpacingBefore = fontSize * 0.3
        paraStyle.paragraphSpacing = fontSize * 0.3

        switch style.cssFloat {
        case .left: paraStyle.alignment = .left
        case .right: paraStyle.alignment = .right
        default: paraStyle.alignment = .center
        }

        // Render a compact audio player bar image
        let barImage = generateAudioBar(width: barWidth, height: barHeight)
        let attachment = NSTextAttachment()
        attachment.image = barImage
        attachment.bounds = CGRect(x: 0, y: 0, width: barWidth, height: barHeight)

        let attachStr = NSMutableAttributedString(attachment: attachment)
        attachStr.addAttribute(.paragraphStyle, value: paraStyle,
                               range: NSRange(location: 0, length: attachStr.length))
        result.append(attachStr)
        result.append(NSAttributedString(string: "\n"))

        let range = NSRange(location: startIndex, length: result.length - startIndex)
        mediaAttachments.append(MediaAttachment(kind: .audio, url: url, range: range))
    }

    /// Renders a compact audio player bar with play button, progress track, and time label.
    private func generateAudioBar(width: CGFloat, height: CGFloat) -> UIImage {
        let size = CGSize(width: width, height: height)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            let rect = CGRect(origin: .zero, size: size)

            // Rounded background
            let bgPath = UIBezierPath(roundedRect: rect, cornerRadius: 10)
            textColor.withAlphaComponent(0.1).setFill()
            bgPath.fill()

            // Play button circle on the left
            let circleSize: CGFloat = height * 0.6
            let circleX: CGFloat = 12
            let circleY: CGFloat = (height - circleSize) / 2
            let circleRect = CGRect(x: circleX, y: circleY, width: circleSize, height: circleSize)
            accentColor.setFill()
            UIBezierPath(ovalIn: circleRect).fill()

            // Play triangle (contrast color against accent)
            let triInset = circleSize * 0.3
            let triPath = UIBezierPath()
            let tLeft = circleRect.minX + triInset + circleSize * 0.05
            let tRight = circleRect.maxX - triInset + circleSize * 0.05
            let tTop = circleRect.minY + triInset
            let tBottom = circleRect.maxY - triInset
            triPath.move(to: CGPoint(x: tLeft, y: tTop))
            triPath.addLine(to: CGPoint(x: tRight, y: circleRect.midY))
            triPath.addLine(to: CGPoint(x: tLeft, y: tBottom))
            triPath.close()
            backgroundColor.setFill()
            triPath.fill()

            // Progress track
            let trackLeft = circleX + circleSize + 12
            let trackRight = width - 12
            let trackY = height / 2
            let trackHeight: CGFloat = 4
            let trackRect = CGRect(x: trackLeft, y: trackY - trackHeight / 2,
                                   width: trackRight - trackLeft, height: trackHeight)
            let trackPath = UIBezierPath(roundedRect: trackRect, cornerRadius: 2)
            textColor.withAlphaComponent(0.2).setFill()
            trackPath.fill()

            // Time label "0:00" at bottom-right of track
            let timeStr = "0:00" as NSString
            let timeAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.monospacedDigitSystemFont(ofSize: max(10, height * 0.25), weight: .medium),
                .foregroundColor: textColor.withAlphaComponent(0.5)
            ]
            let timeSize = timeStr.size(withAttributes: timeAttrs)
            timeStr.draw(
                at: CGPoint(x: trackRight - timeSize.width, y: trackY + trackHeight / 2 + 2),
                withAttributes: timeAttrs
            )
        }
    }

    // MARK: - Lists

    private func appendList(ordered: Bool, items: [ListItem], blockStyle: BlockStyle,
                            to result: NSMutableAttributedString, depth: Int) {
        let suppressBullets = blockStyle.listStyleType == CSSListStyleType.none

        for (index, item) in items.enumerated() {
            let bullet: String
            if suppressBullets {
                bullet = ""
            } else if ordered {
                bullet = orderedBullet(index: index, depth: depth) + "\t"
            } else {
                bullet = unorderedBullet(depth: depth) + "\t"
            }

            let baseIndent = CGFloat(depth + 1) * fontSize * 1.5
            let bulletWidth = suppressBullets ? 0 : fontSize * 1.2

            let paraStyle = NSMutableParagraphStyle()
            paraStyle.lineHeightMultiple = lineHeight
            paraStyle.paragraphSpacing = fontSize * 0.4
            paraStyle.headIndent = baseIndent
            paraStyle.firstLineHeadIndent = suppressBullets ? baseIndent : baseIndent - bulletWidth
            paraStyle.alignment = .natural
            paraStyle.hyphenationFactor = 0.8

            // Add tab stop for proper bullet-text alignment
            if !suppressBullets {
                let tabStop = NSTextTab(textAlignment: .natural, location: baseIndent)
                paraStyle.tabStops = [tabStop]
                paraStyle.defaultTabInterval = baseIndent
            }

            if !bullet.isEmpty {
                let bulletAttrs: [NSAttributedString.Key: Any] = [
                    .font: font,
                    .foregroundColor: textColor.withAlphaComponent(0.6),
                    .paragraphStyle: paraStyle
                ]
                result.append(NSAttributedString(string: bullet, attributes: bulletAttrs))
            }

            // Add list item content
            for (childIndex, child) in item.children.enumerated() {
                switch child {
                case .paragraph(let runs, let itemStyle):
                    // Apply list item's own CSS styles (alignment, margins) with clamping
                    let itemParaStyle = paraStyle.mutableCopy() as! NSMutableParagraphStyle
                    if let align = itemStyle.textAlign {
                        switch align {
                        case .center: itemParaStyle.alignment = .center
                        case .right: itemParaStyle.alignment = .right
                        case .left: itemParaStyle.alignment = .left
                        case .justify: itemParaStyle.alignment = .justified
                        }
                    }
                    if let marginTop = itemStyle.marginTop {
                        itemParaStyle.paragraphSpacingBefore = max(0, marginTop.resolve(relativeTo: fontSize))
                    }
                    if let marginBottom = itemStyle.marginBottom {
                        itemParaStyle.paragraphSpacing = max(0, marginBottom.resolve(relativeTo: fontSize))
                    }
                    if let marginLeft = itemStyle.marginLeft {
                        let extra = max(0, marginLeft.resolve(relativeTo: fontSize))
                        itemParaStyle.headIndent = baseIndent + extra
                        itemParaStyle.firstLineHeadIndent = itemParaStyle.firstLineHeadIndent + extra
                    }
                    appendRuns(runs, to: result, baseFont: font, paragraphStyle: itemParaStyle)
                    result.append(NSAttributedString(string: "\n"))
                default:
                    if childIndex == 0 && !bullet.isEmpty {
                        result.append(NSAttributedString(string: "\n"))
                    }
                    appendNode(child, to: result, depth: depth + 1)
                }
            }
        }
    }

    /// Returns depth-appropriate bullet character for unordered lists.
    private func unorderedBullet(depth: Int) -> String {
        switch depth % 3 {
        case 0: return "\u{2022}"  // •
        case 1: return "\u{25E6}"  // ◦
        case 2: return "\u{25AA}"  // ▪
        default: return "\u{2022}"
        }
    }

    /// Returns depth-appropriate numbering for ordered lists.
    private func orderedBullet(index: Int, depth: Int) -> String {
        switch depth % 3 {
        case 0: return "\(index + 1)."
        case 1: return "\(Character(UnicodeScalar(97 + (index % 26))!))"  + "."  // a. b. c.
        case 2: return romanNumeral(index + 1) + "."
        default: return "\(index + 1)."
        }
    }

    /// Simple lowercase Roman numeral conversion.
    private func romanNumeral(_ number: Int) -> String {
        let values = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"),
                      (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
                      (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
        var result = ""
        var remaining = number
        for (value, numeral) in values {
            while remaining >= value {
                result += numeral
                remaining -= value
            }
        }
        return result
    }

    // MARK: - Blockquotes

    private func appendBlockquote(children: [ContentNode], to result: NSMutableAttributedString, depth: Int) {
        let indent = fontSize * 1.5

        for child in children {
            switch child {
            case .paragraph(let runs, let blockStyle):
                let paraStyle = makeParagraphStyle()
                paraStyle.headIndent = indent
                paraStyle.firstLineHeadIndent = indent

                // Apply CSS overrides from blockquote content
                if let align = blockStyle.textAlign {
                    switch align {
                    case .center: paraStyle.alignment = .center
                    case .right: paraStyle.alignment = .right
                    case .left: paraStyle.alignment = .left
                    case .justify: paraStyle.alignment = .justified
                    }
                }
                if let dir = blockStyle.writingDirection {
                    paraStyle.baseWritingDirection = dir
                }

                // Blockquote text is italic
                let italicRuns = runs.map { run -> TextRun in
                    var modified = run
                    modified.styles.insert(.italic)
                    return modified
                }
                appendRuns(italicRuns, to: result, baseFont: font, paragraphStyle: paraStyle)
                result.append(NSAttributedString(string: "\n"))

            default:
                appendNode(child, to: result, depth: depth + 1)
            }
        }
    }

    // MARK: - Code Blocks

    private func appendCodeBlock(text: String, to result: NSMutableAttributedString) {
        let paraStyle = NSMutableParagraphStyle()
        paraStyle.lineHeightMultiple = 1.3
        paraStyle.paragraphSpacingBefore = fontSize * 0.5
        paraStyle.paragraphSpacing = fontSize * 0.5
        paraStyle.headIndent = fontSize
        paraStyle.firstLineHeadIndent = fontSize

        let attrs: [NSAttributedString.Key: Any] = [
            .font: monoFont,
            .foregroundColor: textColor,
            .paragraphStyle: paraStyle,
            .backgroundColor: textColor.withAlphaComponent(0.05)
        ]

        result.append(NSAttributedString(string: text + "\n", attributes: attrs))
    }

    // MARK: - Horizontal Rules

    private func appendHorizontalRule(to result: NSMutableAttributedString) {
        let paraStyle = NSMutableParagraphStyle()
        paraStyle.alignment = .center
        paraStyle.paragraphSpacingBefore = fontSize
        paraStyle.paragraphSpacing = fontSize

        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: textColor.withAlphaComponent(0.3),
            .paragraphStyle: paraStyle
        ]

        result.append(NSAttributedString(string: "\u{2014}  \u{2014}  \u{2014}\n", attributes: attrs))
    }

    // MARK: - Tables

    private func appendTable(rows: [TableRow], to result: NSMutableAttributedString) {
        guard !rows.isEmpty else { return }

        // Check for complex spanning — fall back to simple rendering
        let hasSpans = rows.contains { row in
            row.cells.contains { $0.colspan > 1 || $0.rowspan > 1 }
        }
        if hasSpans {
            appendTableSimple(rows: rows, to: result)
            return
        }

        appendTableGrid(rows: rows, to: result)
    }

    /// Simple tab-separated table rendering (fallback for complex tables with spans).
    private func appendTableSimple(rows: [TableRow], to result: NSMutableAttributedString) {
        let paraStyle = NSMutableParagraphStyle()
        paraStyle.lineHeightMultiple = lineHeight
        paraStyle.paragraphSpacing = fontSize * 0.25

        // Inform the reader that the table layout was simplified
        let captionStyle = NSMutableParagraphStyle()
        captionStyle.lineHeightMultiple = lineHeight
        captionStyle.paragraphSpacingBefore = fontSize * 0.25
        captionStyle.paragraphSpacing = fontSize * 0.15
        let captionAttrs: [NSAttributedString.Key: Any] = [
            .font: UIFont.italicSystemFont(ofSize: fontSize * 0.85),
            .foregroundColor: textColor.withAlphaComponent(0.55),
            .paragraphStyle: captionStyle
        ]
        result.append(NSAttributedString(string: "⚠ Table contains merged cells — layout simplified.\n", attributes: captionAttrs))

        for row in rows {
            let cellTexts = row.cells.map { cell -> String in
                cell.runs.map(\.text).joined()
            }
            let rowFont = row.cells.first?.isHeader == true ? boldFont : font
            let attrs: [NSAttributedString.Key: Any] = [
                .font: rowFont,
                .foregroundColor: textColor,
                .paragraphStyle: paraStyle
            ]
            let rowText = cellTexts.joined(separator: "\t|\t")
            result.append(NSAttributedString(string: rowText + "\n", attributes: attrs))
        }
        result.append(NSAttributedString(string: "\n"))
    }

    /// Grid-based table rendering with column width calculation and tab stops.
    private func appendTableGrid(rows: [TableRow], to result: NSMutableAttributedString) {
        let columnCount = rows.map { $0.cells.count }.max() ?? 0
        guard columnCount > 0 else { return }

        // Measure natural width of each column
        let cellPadding: CGFloat = fontSize * 0.8
        let maxCellWidth = max(fontSize * 3, (contentWidth - cellPadding * CGFloat(columnCount - 1)) / CGFloat(columnCount))
        var columnWidths = Array(repeating: CGFloat(0), count: columnCount)

        for row in rows {
            for (col, cell) in row.cells.enumerated() where col < columnCount {
                let text = cell.runs.map(\.text).joined()
                let cellFont = cell.isHeader ? boldFont : font
                let size = (text as NSString).size(withAttributes: [.font: cellFont])
                columnWidths[col] = min(max(columnWidths[col], size.width + cellPadding), maxCellWidth)
            }
        }

        // Ensure minimum column width
        let minColWidth = fontSize * 2
        columnWidths = columnWidths.map { max($0, minColWidth) }

        // Scale if total exceeds content width
        let totalWidth = columnWidths.reduce(0, +)
        if totalWidth > contentWidth && totalWidth > 0 {
            let scale = contentWidth / totalWidth
            columnWidths = columnWidths.map { $0 * scale }
        }

        // Build tab stops from cumulative column positions
        var tabStops: [NSTextTab] = []
        var cumulative: CGFloat = 0
        for width in columnWidths {
            cumulative += width
            tabStops.append(NSTextTab(textAlignment: .left, location: cumulative))
        }

        // Render each row
        for (rowIndex, row) in rows.enumerated() {
            let isHeaderRow = row.cells.first?.isHeader == true

            let paraStyle = NSMutableParagraphStyle()
            paraStyle.lineHeightMultiple = lineHeight
            paraStyle.tabStops = tabStops
            paraStyle.defaultTabInterval = maxCellWidth
            paraStyle.paragraphSpacing = fontSize * 0.15
            paraStyle.paragraphSpacingBefore = rowIndex == 0 ? fontSize * 0.3 : 0

            // Build the row text with tab separators
            let rowStr = NSMutableAttributedString()
            for (col, cell) in row.cells.enumerated() {
                if col > 0 {
                    rowStr.append(NSAttributedString(string: "\t", attributes: [
                        .font: font, .foregroundColor: textColor, .paragraphStyle: paraStyle
                    ]))
                }
                // Render cell content with proper styles
                let cellFont = cell.isHeader ? boldFont : font
                for run in cell.runs {
                    var effectiveCellFont = cellFont
                    if let scale = run.fontSizeScale, scale > 0, scale != 1.0 {
                        effectiveCellFont = cellFont.withSize(max(8, cellFont.pointSize * scale))
                    }
                    let runFont = fontForRun(run, baseFont: effectiveCellFont)
                    var attrs: [NSAttributedString.Key: Any] = [
                        .font: runFont,
                        .foregroundColor: readableColor(for: run.textColor),
                        .paragraphStyle: paraStyle
                    ]
                    if run.styles.contains(.bold) || cell.isHeader {
                        attrs[.font] = fontForRun(run, baseFont: boldFont)
                    }
                    if let link = run.link {
                        attrs[.foregroundColor] = accentColor
                        attrs[.link] = link
                    }
                    rowStr.append(NSAttributedString(string: run.text, attributes: attrs))
                }
                // If cell has no runs, add empty space
                if cell.runs.isEmpty {
                    rowStr.append(NSAttributedString(string: " ", attributes: [
                        .font: cellFont, .foregroundColor: textColor, .paragraphStyle: paraStyle
                    ]))
                }
            }
            rowStr.append(NSAttributedString(string: "\n", attributes: [
                .font: font, .foregroundColor: textColor, .paragraphStyle: paraStyle
            ]))
            result.append(rowStr)

            // Header separator line
            if isHeaderRow {
                let sepStyle = NSMutableParagraphStyle()
                sepStyle.lineHeightMultiple = 0.3
                sepStyle.paragraphSpacing = fontSize * 0.15
                let sepWidth = min(totalWidth, contentWidth)
                let dashes = String(repeating: "\u{2500}", count: max(1, Int(sepWidth / fontSize * 1.5)))
                let sepAttrs: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: fontSize * 0.5),
                    .foregroundColor: textColor.withAlphaComponent(0.3),
                    .paragraphStyle: sepStyle
                ]
                result.append(NSAttributedString(string: dashes + "\n", attributes: sepAttrs))
            }
        }

        // Table bottom spacing
        let bottomStyle = NSMutableParagraphStyle()
        bottomStyle.paragraphSpacing = fontSize * 0.3
        result.append(NSAttributedString(string: "\n", attributes: [
            .font: font, .paragraphStyle: bottomStyle
        ]))
    }

    // MARK: - Text Run Rendering

    private func appendRuns(_ runs: [TextRun], to result: NSMutableAttributedString,
                            baseFont: UIFont, paragraphStyle: NSParagraphStyle) {
        for run in runs {
            var displayText = run.text

            // Apply CSS font-size scaling
            var effectiveBaseFont = baseFont
            if let scale = run.fontSizeScale, scale > 0, scale != 1.0 {
                let scaledSize = max(8, baseFont.pointSize * scale) // floor at 8pt
                effectiveBaseFont = baseFont.withSize(scaledSize)
            }

            var runFont: UIFont

            // Handle small-caps: uppercase text + smaller font
            if run.styles.contains(.smallCaps) {
                displayText = displayText.uppercased()
                let smallCapSize = effectiveBaseFont.pointSize * 0.8
                let smallCapBase = effectiveBaseFont.withSize(smallCapSize)
                runFont = fontForRun(run, baseFont: smallCapBase)
            } else if run.styles.contains(.uppercase) {
                displayText = displayText.uppercased()
                runFont = fontForRun(run, baseFont: effectiveBaseFont)
            } else {
                runFont = fontForRun(run, baseFont: effectiveBaseFont)
            }

            // Embedded font override
            if let family = run.fontFamily,
               let customFont = UIFont(name: family, size: runFont.pointSize) {
                // Preserve bold/italic traits from the resolved font
                if let desc = customFont.fontDescriptor.withSymbolicTraits(runFont.fontDescriptor.symbolicTraits) {
                    runFont = UIFont(descriptor: desc, size: runFont.pointSize)
                } else {
                    runFont = customFont
                }
            }

            var attrs: [NSAttributedString.Key: Any] = [
                .font: runFont,
                .foregroundColor: textColor,
                .paragraphStyle: paragraphStyle,
                .kern: fontSize * 0.01,   // Subtle kerning
                .ligature: 1              // Standard ligatures
            ]

            // CSS color override (applied after default, before link override)
            // Ensure the color is readable against the current theme background
            if run.textColor != nil {
                attrs[.foregroundColor] = readableColor(for: run.textColor)
            }

            if run.styles.contains(.strikethrough) {
                attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
            }
            if run.styles.contains(.underline) || run.link != nil {
                attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
            }
            if let link = run.link {
                attrs[.link] = link
                attrs[.foregroundColor] = accentColor  // Link color wins over CSS color
            }
            if run.styles.contains(.superscript) {
                attrs[.baselineOffset] = fontSize * 0.3
            }
            if run.styles.contains(.subscript) {
                attrs[.baselineOffset] = -fontSize * 0.15
            }
            if run.styles.contains(.code) {
                attrs[.backgroundColor] = textColor.withAlphaComponent(0.05)
            }
            if run.styles.contains(.footnoteRef) {
                attrs[NSAttributedString.Key("footnoteRef")] = true
                attrs[.baselineOffset] = fontSize * 0.3
            }

            result.append(NSAttributedString(string: displayText, attributes: attrs))
        }
    }

    // MARK: - Color Helpers

    /// Returns the CSS color only if it has sufficient contrast against the theme background.
    /// If the contrast is too low (e.g. dark text on dark background), returns the theme textColor instead.
    private func readableColor(for cssColor: UIColor?) -> UIColor {
        guard let cssColor else { return textColor }
        let contrast = contrastRatio(between: cssColor, and: backgroundColor)
        // WCAG AA large-text minimum is 3:1; use 2.5 as a lenient threshold
        if contrast < 2.5 {
            return textColor
        }
        return cssColor
    }

    /// Computes the WCAG contrast ratio between two colors (1:1 to 21:1).
    private func contrastRatio(between c1: UIColor, and c2: UIColor) -> CGFloat {
        let l1 = relativeLuminance(of: c1)
        let l2 = relativeLuminance(of: c2)
        let lighter = max(l1, l2)
        let darker = min(l1, l2)
        return (lighter + 0.05) / (darker + 0.05)
    }

    /// Relative luminance per WCAG 2.0 (0.0 = black, 1.0 = white).
    private func relativeLuminance(of color: UIColor) -> CGFloat {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        func linearize(_ c: CGFloat) -> CGFloat {
            c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b)
    }

    // MARK: - Font Helpers

    private func fontForRun(_ run: TextRun, baseFont: UIFont) -> UIFont {
        if run.styles.contains(.code) {
            return monoFont
        }

        let isBold = run.styles.contains(.bold)
        let isItalic = run.styles.contains(.italic)
        let isSuperOrSub = run.styles.contains(.superscript) || run.styles.contains(.subscript)

        var result: UIFont
        if isBold && isItalic {
            result = boldItalicFont
        } else if isBold {
            result = boldFont
        } else if isItalic {
            result = italicFont
        } else {
            result = baseFont
        }

        if isSuperOrSub {
            result = result.withSize(result.pointSize * 0.75)
        }

        return result
    }

    private func makeParagraphStyle() -> NSMutableParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.lineHeightMultiple = lineHeight
        style.paragraphSpacing = fontSize * 0.5
        style.alignment = .justified
        style.hyphenationFactor = 0.8
        return style
    }

    private func makeFont(size: CGFloat, bold: Bool = false, italic: Bool = false) -> UIFont {
        var traits: UIFontDescriptor.SymbolicTraits = []
        if bold { traits.insert(.traitBold) }
        if italic { traits.insert(.traitItalic) }

        let baseFont: UIFont
        switch fontFamily {
        case .sansSerif:
            baseFont = .systemFont(ofSize: size, weight: bold ? .bold : .regular)
        default:
            if let font = UIFont(name: fontFamily.previewFontName, size: size) {
                if bold, let desc = font.fontDescriptor.withSymbolicTraits(.traitBold) {
                    baseFont = UIFont(descriptor: desc, size: size)
                } else {
                    baseFont = font
                }
            } else {
                baseFont = .systemFont(ofSize: size, weight: bold ? .bold : .regular)
            }
        }

        if italic, let descriptor = baseFont.fontDescriptor.withSymbolicTraits(
            baseFont.fontDescriptor.symbolicTraits.union(.traitItalic)
        ) {
            return UIFont(descriptor: descriptor, size: size)
        }

        return baseFont
    }
}
