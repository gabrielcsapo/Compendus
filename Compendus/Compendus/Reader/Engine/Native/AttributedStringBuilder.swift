//
//  AttributedStringBuilder.swift
//  Compendus
//
//  Converts ContentNode AST into NSAttributedString for native rendering.
//  Maps reader settings (font, size, color, line height) directly to
//  NSAttributedString attributes — no CSS needed.
//

import UIKit

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

// MARK: - Attributed String Builder

class AttributedStringBuilder {
    // Prevent the compiler from generating an isolated deinit.
    // Without this, the @MainActor init(settings:) causes the compiler to
    // infer @MainActor on the class, which makes deinit hop executors via
    // swift_task_deinitOnExecutorImpl — crashing with a malloc error when
    // the object is released from a non-main-actor context (e.g. tests).
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

    init(settings: ReaderSettings, contentWidth: CGFloat) {
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
    }

    init(theme: ReaderTheme, fontFamily: ReaderFont, fontSize: Double,
         lineHeight: Double, contentWidth: CGFloat) {
        self.fontFamily = fontFamily
        self.fontSize = CGFloat(fontSize)
        self.lineHeight = CGFloat(lineHeight)
        self.textColor = theme.textColor
        self.contentWidth = contentWidth

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
        case .paragraph(let runs):
            appendParagraph(runs: runs, to: result, indent: depth > 0)

        case .heading(let level, let runs):
            appendHeading(level: level, runs: runs, to: result)

        case .image(let url, let alt, let width, let height):
            appendImage(url: url, alt: alt, hintWidth: width, hintHeight: height, to: result)

        case .list(let ordered, let items):
            appendList(ordered: ordered, items: items, to: result, depth: depth)

        case .blockquote(let children):
            appendBlockquote(children: children, to: result, depth: depth)

        case .codeBlock(let text):
            appendCodeBlock(text: text, to: result)

        case .horizontalRule:
            appendHorizontalRule(to: result)

        case .table(let rows):
            appendTable(rows: rows, to: result)

        case .container(let children):
            for child in children {
                appendNode(child, to: result, depth: depth)
            }
        }
    }

    // MARK: - Paragraphs

    private func appendParagraph(runs: [TextRun], to result: NSMutableAttributedString, indent: Bool) {
        let paraStyle = makeParagraphStyle()
        if indent {
            paraStyle.firstLineHeadIndent = fontSize * 1.2
        }

        appendRuns(runs, to: result, baseFont: font, paragraphStyle: paraStyle)
        result.append(NSAttributedString(string: "\n"))
    }

    // MARK: - Headings

    private func appendHeading(level: Int, runs: [TextRun], to result: NSMutableAttributedString) {
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
        paraStyle.paragraphSpacingBefore = headingSize * 0.8
        paraStyle.paragraphSpacing = headingSize * 0.4
        paraStyle.alignment = .natural
        paraStyle.hyphenationFactor = 0

        appendRuns(runs, to: result, baseFont: headingFont, paragraphStyle: paraStyle)
        result.append(NSAttributedString(string: "\n"))
    }

    // MARK: - Images

    private func appendImage(url: URL, alt: String?, hintWidth: CGFloat?,
                             hintHeight: CGFloat?, to result: NSMutableAttributedString) {
        guard url.isFileURL, let image = UIImage(contentsOfFile: url.path) else {
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

        let maxWidth = contentWidth
        let imageWidth = min(image.size.width, maxWidth)
        let scaleFactor = imageWidth / image.size.width
        let imageHeight = image.size.height * scaleFactor

        let attachment = NSTextAttachment()
        attachment.image = image
        attachment.bounds = CGRect(x: 0, y: 0, width: imageWidth, height: imageHeight)

        // Center paragraph style for images
        let paraStyle = NSMutableParagraphStyle()
        paraStyle.alignment = .center
        paraStyle.paragraphSpacingBefore = fontSize * 0.5
        paraStyle.paragraphSpacing = fontSize * 0.5

        let attachString = NSMutableAttributedString(attachment: attachment)
        attachString.addAttribute(.paragraphStyle, value: paraStyle,
                                  range: NSRange(location: 0, length: attachString.length))

        result.append(attachString)
        result.append(NSAttributedString(string: "\n"))

        // Add alt text caption if available
        if let alt = alt, !alt.isEmpty {
            let captionStyle = NSMutableParagraphStyle()
            captionStyle.alignment = .center
            captionStyle.paragraphSpacing = fontSize * 0.5

            let captionAttrs: [NSAttributedString.Key: Any] = [
                .font: italicFont,
                .foregroundColor: textColor.withAlphaComponent(0.6),
                .paragraphStyle: captionStyle
            ]
            result.append(NSAttributedString(string: "\(alt)\n", attributes: captionAttrs))
        }
    }

    // MARK: - Lists

    private func appendList(ordered: Bool, items: [ListItem],
                            to result: NSMutableAttributedString, depth: Int) {
        for (index, item) in items.enumerated() {
            let bullet = ordered ? "\(index + 1).\t" : "\u{2022}\t"
            let indent = CGFloat(depth + 1) * fontSize * 1.5

            let paraStyle = NSMutableParagraphStyle()
            paraStyle.lineHeightMultiple = lineHeight
            paraStyle.paragraphSpacing = fontSize * 0.25
            paraStyle.headIndent = indent
            paraStyle.firstLineHeadIndent = indent - fontSize
            paraStyle.alignment = .natural
            paraStyle.hyphenationFactor = 1.0

            // Add the bullet/number
            let bulletAttrs: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: textColor,
                .paragraphStyle: paraStyle
            ]
            result.append(NSAttributedString(string: bullet, attributes: bulletAttrs))

            // Add list item content
            for (childIndex, child) in item.children.enumerated() {
                switch child {
                case .paragraph(let runs):
                    // Inline the first paragraph with the bullet
                    appendRuns(runs, to: result, baseFont: font, paragraphStyle: paraStyle)
                    result.append(NSAttributedString(string: "\n"))
                default:
                    if childIndex == 0 {
                        result.append(NSAttributedString(string: "\n"))
                    }
                    appendNode(child, to: result, depth: depth + 1)
                }
            }
        }
    }

    // MARK: - Blockquotes

    private func appendBlockquote(children: [ContentNode], to result: NSMutableAttributedString, depth: Int) {
        let indent = fontSize * 1.5

        for child in children {
            switch child {
            case .paragraph(let runs):
                let paraStyle = makeParagraphStyle()
                paraStyle.headIndent = indent
                paraStyle.firstLineHeadIndent = indent

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
        // Simple table rendering: each cell on its own line with tab separation
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
            let runFont = fontForRun(run, baseFont: baseFont)
            var attrs: [NSAttributedString.Key: Any] = [
                .font: runFont,
                .foregroundColor: textColor,
                .paragraphStyle: paragraphStyle
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

            result.append(NSAttributedString(string: run.text, attributes: attrs))
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
        style.hyphenationFactor = 1.0
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
