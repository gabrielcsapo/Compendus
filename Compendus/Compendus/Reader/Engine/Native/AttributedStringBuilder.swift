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
struct OffsetMap {
    struct Entry {
        let range: NSRange
        let blockIndex: Int
    }
    var entries: [Entry] = []

    /// Find the entry containing a character offset.
    func entry(at offset: Int) -> Entry? {
        entries.first { NSLocationInRange(offset, $0.range) }
    }
}

// MARK: - Media Attachment Info

/// Tracks media attachments (video/audio) embedded in the attributed string
/// so that taps on them can be routed to playback.
struct MediaAttachment {
    enum Kind { case video, audio }
    let kind: Kind
    let url: URL
    let range: NSRange
}

/// Describes a CSS-floated image that should be rendered as a subview with
/// an exclusion path so text wraps around it.
struct FloatingElement {
    let image: UIImage
    let size: CGSize
    let floatSide: CSSFloat       // .left or .right
    let marginInline: CGFloat     // margin between image and wrapping text
    let marginTop: CGFloat
    let marginBottom: CGFloat
    let markerIndex: Int          // character index in full attributed string
    let alt: String?
}

// MARK: - Attributed String Builder

class AttributedStringBuilder {
    // Prevent the compiler from generating an isolated deinit.
    nonisolated deinit {}

    private let font: UIFont
    private let boldFont: UIFont
    private let italicFont: UIFont
    private let boldItalicFont: UIFont
    private let monoFont: UIFont
    private let textColor: UIColor
    private let fontSize: CGFloat
    private let lineHeight: CGFloat
    private let fontFamily: ReaderFont
    let contentWidth: CGFloat
    let contentHeight: CGFloat

    /// Media attachments found during build (video/audio placeholders).
    private(set) var mediaAttachments: [MediaAttachment] = []

    /// Floating elements (CSS float:left/right images) found during build.
    private(set) var floatingElements: [FloatingElement] = []

    init(settings: ReaderSettings, contentWidth: CGFloat, contentHeight: CGFloat = .greatestFiniteMagnitude) {
        self.font = settings.nativeFont
        self.boldFont = settings.nativeBoldFont
        self.italicFont = settings.nativeItalicFont
        self.boldItalicFont = settings.nativeBoldItalicFont
        self.monoFont = settings.nativeMonoFont
        self.textColor = settings.theme.textColor
        self.fontSize = CGFloat(settings.fontSize)
        self.lineHeight = CGFloat(settings.lineHeight)
        self.fontFamily = settings.fontFamily
        self.contentWidth = contentWidth
        self.contentHeight = contentHeight
    }

    init(theme: ReaderTheme, fontFamily: ReaderFont, fontSize: Double,
         lineHeight: Double, contentWidth: CGFloat, contentHeight: CGFloat = .greatestFiniteMagnitude) {
        self.fontFamily = fontFamily
        self.fontSize = CGFloat(fontSize)
        self.lineHeight = CGFloat(lineHeight)
        self.textColor = theme.textColor
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
    /// Returns the string and an offset map for highlight mapping.
    func build(from nodes: [ContentNode]) -> (NSAttributedString, OffsetMap) {
        let result = NSMutableAttributedString()
        var offsetMap = OffsetMap()
        mediaAttachments = []
        floatingElements = []

        for (index, node) in nodes.enumerated() {
            let startIndex = result.length
            appendNode(node, to: result, depth: 0)
            let range = NSRange(location: startIndex, length: result.length - startIndex)
            if range.length > 0 {
                offsetMap.entries.append(OffsetMap.Entry(range: range, blockIndex: index))
            }
        }

        // Remove trailing newline if present
        if result.length > 0 && result.string.hasSuffix("\n") {
            result.deleteCharacters(in: NSRange(location: result.length - 1, length: 1))
        }

        return (result, offsetMap)
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
        if let align = blockStyle.textAlign {
            switch align {
            case .center: paraStyle.alignment = .center
            case .right: paraStyle.alignment = .right
            case .left: paraStyle.alignment = .left
            case .justify: paraStyle.alignment = .justified
            }
        }

        if let indent = blockStyle.textIndent {
            paraStyle.firstLineHeadIndent = indent.resolve(relativeTo: fontSize)
        } else if depth > 0 {
            paraStyle.firstLineHeadIndent = fontSize * 1.2
        }

        if let marginTop = blockStyle.marginTop {
            paraStyle.paragraphSpacingBefore = marginTop.resolve(relativeTo: fontSize)
        }
        if let marginBottom = blockStyle.marginBottom {
            paraStyle.paragraphSpacing = marginBottom.resolve(relativeTo: fontSize)
        }

        if let marginLeft = blockStyle.marginLeft {
            let leftIndent = marginLeft.resolve(relativeTo: fontSize)
            paraStyle.headIndent = leftIndent
            // Offset firstLineHeadIndent by the left margin if text-indent was also set
            if let indent = blockStyle.textIndent {
                paraStyle.firstLineHeadIndent = leftIndent + indent.resolve(relativeTo: fontSize)
            } else if depth == 0 {
                paraStyle.firstLineHeadIndent = leftIndent
            }
        }

        appendRuns(runs, to: result, baseFont: font, paragraphStyle: paraStyle)
        result.append(NSAttributedString(string: "\n"))
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

        // Apply CSS alignment (e.g. centered chapter titles)
        if let align = blockStyle.textAlign {
            switch align {
            case .center: paraStyle.alignment = .center
            case .right: paraStyle.alignment = .right
            case .left: paraStyle.alignment = .left
            case .justify: paraStyle.alignment = .justified
            }
        } else {
            paraStyle.alignment = .natural
        }

        if let marginTop = blockStyle.marginTop {
            paraStyle.paragraphSpacingBefore = marginTop.resolve(relativeTo: fontSize)
        }
        if let marginBottom = blockStyle.marginBottom {
            paraStyle.paragraphSpacing = marginBottom.resolve(relativeTo: fontSize)
        }

        appendRuns(runs, to: result, baseFont: headingFont, paragraphStyle: paraStyle)
        result.append(NSAttributedString(string: "\n"))
    }

    // MARK: - Images

    private func appendImage(url: URL, alt: String?, hintWidth: CGFloat?,
                             hintHeight: CGFloat?, style: MediaStyle,
                             to result: NSMutableAttributedString) {
        guard url.isFileURL else {
            print("[Image] URL is not a file URL: \(url.absoluteString)")
            return
        }

        guard let image = UIImage(contentsOfFile: url.path) else {
            let exists = FileManager.default.fileExists(atPath: url.path)
            print("[Image] FAILED to load: \(url.path)")
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

        let scaleFactor = imageWidth / image.size.width
        var imageHeight: CGFloat
        if let cssH = style.cssHeight {
            imageHeight = min(cssH.resolve(relativeTo: maxHeight), maxHeight)
        } else {
            imageHeight = image.size.height * scaleFactor
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
                image: image,
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

        // Non-floated image: inline attachment
        let attachment = NSTextAttachment()
        attachment.image = image
        attachment.bounds = CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight)

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
            baseImage = UIImage(contentsOfFile: posterURL.path)
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
                UIColor.secondarySystemBackground.setFill()
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
            UIColor.secondarySystemBackground.setFill()
            bgPath.fill()

            // Play button circle on the left
            let circleSize: CGFloat = height * 0.6
            let circleX: CGFloat = 12
            let circleY: CGFloat = (height - circleSize) / 2
            let circleRect = CGRect(x: circleX, y: circleY, width: circleSize, height: circleSize)
            UIColor.systemBlue.setFill()
            UIBezierPath(ovalIn: circleRect).fill()

            // Play triangle
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
            UIColor.white.setFill()
            triPath.fill()

            // Progress track
            let trackLeft = circleX + circleSize + 12
            let trackRight = width - 12
            let trackY = height / 2
            let trackHeight: CGFloat = 4
            let trackRect = CGRect(x: trackLeft, y: trackY - trackHeight / 2,
                                   width: trackRight - trackLeft, height: trackHeight)
            let trackPath = UIBezierPath(roundedRect: trackRect, cornerRadius: 2)
            UIColor.systemGray4.setFill()
            trackPath.fill()

            // Time label "0:00" at bottom-right of track
            let timeStr = "0:00" as NSString
            let timeAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.monospacedDigitSystemFont(ofSize: max(10, height * 0.25), weight: .medium),
                .foregroundColor: UIColor.secondaryLabel
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
        let suppressBullets = blockStyle.listStyleType == .none

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
                case .paragraph(let runs, _):
                    appendRuns(runs, to: result, baseFont: font, paragraphStyle: paraStyle)
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
        let paraStyle = NSMutableParagraphStyle()
        paraStyle.lineHeightMultiple = lineHeight
        paraStyle.paragraphSpacing = fontSize * 0.25

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

        // Add a separator after the table
        result.append(NSAttributedString(string: "\n"))
    }

    // MARK: - Text Run Rendering

    private func appendRuns(_ runs: [TextRun], to result: NSMutableAttributedString,
                            baseFont: UIFont, paragraphStyle: NSParagraphStyle) {
        for run in runs {
            var displayText = run.text
            let runFont: UIFont

            // Handle small-caps: uppercase text + smaller font
            if run.styles.contains(.smallCaps) {
                displayText = displayText.uppercased()
                let smallCapSize = baseFont.pointSize * 0.8
                let smallCapBase = baseFont.withSize(smallCapSize)
                runFont = fontForRun(run, baseFont: smallCapBase)
            } else if run.styles.contains(.uppercase) {
                displayText = displayText.uppercased()
                runFont = fontForRun(run, baseFont: baseFont)
            } else {
                runFont = fontForRun(run, baseFont: baseFont)
            }

            var attrs: [NSAttributedString.Key: Any] = [
                .font: runFont,
                .foregroundColor: textColor,
                .paragraphStyle: paragraphStyle,
                .kern: fontSize * 0.01,   // Subtle kerning
                .ligature: 1              // Standard ligatures
            ]

            if run.styles.contains(.strikethrough) {
                attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
            }
            if run.styles.contains(.underline) || run.link != nil {
                attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
            }
            if let link = run.link {
                attrs[.link] = link
                attrs[.foregroundColor] = UIColor.systemBlue
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

            result.append(NSAttributedString(string: displayText, attributes: attrs))
        }
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
