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

// MARK: - Content Node AST

/// A block-level content node from parsed XHTML.
enum ContentNode {
    /// A paragraph of inline text runs
    case paragraph(runs: [TextRun])
    /// A heading (h1-h6) with level and inline text runs
    case heading(level: Int, runs: [TextRun])
    /// A standalone image
    case image(url: URL, alt: String?, width: CGFloat?, height: CGFloat?)
    /// An ordered or unordered list
    case list(ordered: Bool, items: [ListItem])
    /// A blockquote containing child blocks
    case blockquote(children: [ContentNode])
    /// A preformatted code block
    case codeBlock(text: String)
    /// A horizontal rule separator
    case horizontalRule
    /// A table with rows and cells
    case table(rows: [TableRow])
    /// A generic container (div, section, article, etc.)
    case container(children: [ContentNode])
}

// MARK: - Inline Content

/// A run of inline text with styling attributes.
struct TextRun {
    let text: String
    var styles: Set<TextStyle>
    var link: URL?

    init(text: String, styles: Set<TextStyle> = [], link: URL? = nil) {
        self.text = text
        self.styles = styles
        self.link = link
    }
}

/// Inline text styling options.
enum TextStyle: Hashable {
    case bold
    case italic
    case code
    case superscript
    case `subscript`
    case underline
    case strikethrough
}

// MARK: - Block Substructures

/// A single item in a list, containing child content nodes.
struct ListItem {
    let children: [ContentNode]
}

/// A single row in a table.
struct TableRow {
    let cells: [TableCell]
}

/// A single cell in a table row.
struct TableCell {
    let isHeader: Bool
    let runs: [TextRun]
}
