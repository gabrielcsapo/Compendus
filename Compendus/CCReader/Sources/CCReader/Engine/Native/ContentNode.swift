//
//  ContentNode.swift
//  Compendus
//
//  AST representation of parsed EPUB XHTML content.
//  Used as an intermediate representation between XHTML parsing and
//  NSAttributedString construction for native rendering.
//

import Foundation
import UIKit

// MARK: - Block Style (CSS-derived)

/// CSS-derived styling for block-level elements (paragraphs, headings, containers).
/// All fields are optional; nil means no CSS override (use defaults).
public struct BlockStyle {
    var textAlign: CSSTextAlign?
    var textIndent: CSSLength?
    var marginTop: CSSLength?
    var marginBottom: CSSLength?
    var marginLeft: CSSLength?
    var marginRight: CSSLength?
    var display: CSSDisplay?
    var listStyleType: CSSListStyleType?
    var backgroundColor: UIColor?
    var writingDirection: NSWritingDirection?
    var paddingTop: CSSLength?
    var paddingBottom: CSSLength?
    var paddingLeft: CSSLength?
    var paddingRight: CSSLength?

    public static let empty = BlockStyle()

    var isEmpty: Bool {
        textAlign == nil && textIndent == nil && marginTop == nil &&
        marginBottom == nil && marginLeft == nil && marginRight == nil &&
        display == nil && listStyleType == nil && backgroundColor == nil &&
        writingDirection == nil && paddingTop == nil && paddingBottom == nil &&
        paddingLeft == nil && paddingRight == nil
    }
}

// MARK: - Media Style (CSS-derived)

/// CSS-derived styling for media elements (images, video, audio).
public struct MediaStyle {
    var cssWidth: CSSLength?
    var cssHeight: CSSLength?
    var cssFloat: CSSFloat?
    /// True when margin-left and margin-right are both auto (centering).
    var isCentered: Bool = false
    var marginLeft: CSSLength?
    var marginRight: CSSLength?
    var marginTop: CSSLength?
    var marginBottom: CSSLength?

    public static let empty = MediaStyle()

    var isEmpty: Bool {
        cssWidth == nil && cssHeight == nil && cssFloat == nil && !isCentered
            && marginLeft == nil && marginRight == nil
            && marginTop == nil && marginBottom == nil
    }
}

// MARK: - Content Node AST

/// A block-level content node from parsed XHTML.
public enum ContentNode {
    /// A paragraph of inline text runs
    case paragraph(runs: [TextRun], blockStyle: BlockStyle = .empty)
    /// A heading (h1-h6) with level and inline text runs
    case heading(level: Int, runs: [TextRun], blockStyle: BlockStyle = .empty)
    /// A standalone image
    case image(url: URL, alt: String?, width: CGFloat?, height: CGFloat?, style: MediaStyle = .empty)
    /// An ordered or unordered list
    case list(ordered: Bool, items: [ListItem], blockStyle: BlockStyle = .empty)
    /// A blockquote containing child blocks
    case blockquote(children: [ContentNode])
    /// A preformatted code block
    case codeBlock(text: String)
    /// A horizontal rule separator
    case horizontalRule
    /// A table with rows and cells
    case table(rows: [TableRow])
    /// A generic container (div, section, article, etc.)
    case container(children: [ContentNode], blockStyle: BlockStyle = .empty)
    /// A video element with source URL and optional poster image
    case video(url: URL, poster: URL?, style: MediaStyle = .empty)
    /// An audio element with source URL
    case audio(url: URL, style: MediaStyle = .empty)
}

// MARK: - Inline Content

/// A run of inline text with styling attributes.
public struct TextRun {
    var text: String
    var styles: Set<TextStyle>
    var link: URL?
    var textColor: UIColor?
    var fontFamily: String?
    /// Relative font size multiplier (e.g. 0.625 for font-size: 0.625em). nil = inherit base size.
    var fontSizeScale: CGFloat?

    init(text: String, styles: Set<TextStyle> = [], link: URL? = nil,
         textColor: UIColor? = nil, fontFamily: String? = nil, fontSizeScale: CGFloat? = nil) {
        self.text = text
        self.styles = styles
        self.link = link
        self.textColor = textColor
        self.fontFamily = fontFamily
        self.fontSizeScale = fontSizeScale
    }
}

/// Inline text styling options.
public enum TextStyle: Hashable {
    case bold
    case italic
    case code
    case superscript
    case `subscript`
    case underline
    case strikethrough
    case smallCaps
    case uppercase
    case footnoteRef
}

// MARK: - Block Substructures

/// A single item in a list, containing child content nodes.
public struct ListItem {
    let children: [ContentNode]
}

/// A single row in a table.
public struct TableRow {
    let cells: [TableCell]
}

/// A single cell in a table row.
public struct TableCell {
    let isHeader: Bool
    let runs: [TextRun]
    var colspan: Int = 1
    var rowspan: Int = 1
}
