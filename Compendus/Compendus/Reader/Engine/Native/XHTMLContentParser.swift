//
//  XHTMLContentParser.swift
//  Compendus
//
//  Parses EPUB XHTML chapter content into a ContentNode AST.
//  Uses Foundation's XMLParser (same pattern as EPUBParser.swift).
//

import Foundation
import os.log

private let parserLogger = Logger(subsystem: "com.compendus.reader", category: "XHTMLParser")

class XHTMLContentParser: NSObject, XMLParserDelegate {
    private let data: Data
    private let baseURL: URL

    private var result: [ContentNode] = []

    // Element stack for nesting context
    private struct ElementContext {
        let name: String
        var children: [ContentNode]
        var runs: [TextRun]
        var styles: Set<TextStyle>
        var link: URL?
        var isPreformatted: Bool
        var listOrdered: Bool?
        var listItems: [ListItem]
        var tableRows: [TableRow]
        var tableCells: [TableCell]
        var isCellHeader: Bool
    }

    private var stack: [ElementContext] = []
    private var currentText = ""

    // Block elements that create their own ContentNode
    private static let blockElements: Set<String> = [
        "p", "div", "section", "article", "main", "aside", "nav",
        "header", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
        "blockquote", "pre", "figure", "figcaption",
        "ul", "ol", "li", "table", "tr", "td", "th",
        "hr", "br", "img"
    ]

    // Inline elements that contribute to text runs with styles
    private static let inlineElements: Set<String> = [
        "em", "i", "strong", "b", "a", "span", "code",
        "sup", "sub", "u", "s", "del", "mark", "small",
        "cite", "q", "dfn", "abbr", "time", "var", "kbd", "samp"
    ]

    // Container elements treated as generic wrappers
    private static let containerElements: Set<String> = [
        "div", "section", "article", "main", "aside", "nav",
        "header", "footer", "figure", "figcaption"
    ]

    // Heading levels
    private static let headingLevels: [String: Int] = [
        "h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6
    ]

    init(data: Data, baseURL: URL) {
        self.data = data
        self.baseURL = baseURL
    }

    /// Parse XHTML data and return an array of block-level content nodes.
    func parse() -> [ContentNode] {
        result = []
        stack = []
        currentText = ""

        // Push root context
        stack.append(ElementContext(
            name: "root",
            children: [],
            runs: [],
            styles: [],
            link: nil,
            isPreformatted: false,
            listOrdered: nil,
            listItems: [],
            tableRows: [],
            tableCells: [],
            isCellHeader: false
        ))

        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.shouldProcessNamespaces = false
        parser.shouldReportNamespacePrefixes = false
        parser.parse()

        // Flush any remaining text
        flushText()

        let children = stack.last?.children ?? result
        parserLogger.info("Parsed XHTML: \(children.count) top-level nodes from \(self.data.count) bytes")
        if children.isEmpty {
            parserLogger.warning("Parser returned ZERO nodes — stack depth: \(self.stack.count)")
        }
        return children
    }

    // MARK: - XMLParserDelegate

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String] = [:]) {
        let name = localName(elementName)

        // Handle self-closing block elements first
        if name == "br" {
            currentText += "\n"
            return
        }

        if name == "hr" {
            flushText()
            appendToParent(.horizontalRule)
            return
        }

        if name == "img" {
            flushText()
            handleImage(attributeDict)
            return
        }

        // Skip non-content elements
        if name == "html" || name == "head" || name == "title" ||
           name == "meta" || name == "link" || name == "style" ||
           name == "script" {
            // Push a skip context
            stack.append(makeContext(name: name))
            return
        }

        if name == "body" {
            stack.append(makeContext(name: name))
            return
        }

        // Determine inherited styles and preformatted state
        let parentStyles = stack.last?.styles ?? []
        let parentLink = stack.last?.link
        let parentPre = stack.last?.isPreformatted ?? false

        // Inline elements: accumulate styles
        if Self.inlineElements.contains(name) && !Self.blockElements.contains(name) {
            var newStyles = parentStyles
            switch name {
            case "em", "i", "cite", "dfn":
                newStyles.insert(.italic)
            case "strong", "b":
                newStyles.insert(.bold)
            case "code", "var", "kbd", "samp":
                newStyles.insert(.code)
            case "sup":
                newStyles.insert(.superscript)
            case "sub":
                newStyles.insert(.subscript)
            case "u":
                newStyles.insert(.underline)
            case "s", "del":
                newStyles.insert(.strikethrough)
            default:
                break
            }

            var link = parentLink
            if name == "a", let href = attributeDict["href"] {
                link = URL(string: href, relativeTo: baseURL)
                newStyles.insert(.underline)
            }

            stack.append(makeContext(name: name, styles: newStyles, link: link, pre: parentPre))
            return
        }

        // Block elements: flush current text to parent, push new context
        flushText()

        var ctx = makeContext(name: name, styles: [], link: nil, pre: parentPre || name == "pre")

        if name == "ol" {
            ctx.listOrdered = true
        } else if name == "ul" {
            ctx.listOrdered = false
        } else if name == "td" || name == "th" {
            ctx.isCellHeader = (name == "th")
        }

        stack.append(ctx)
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        // Skip content inside <head>, <style>, <script>
        if let top = stack.last, ["head", "style", "script", "title", "meta", "link"].contains(top.name) {
            return
        }
        currentText += string
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        let name = localName(elementName)

        // Self-closing elements don't push context
        if name == "br" || name == "hr" || name == "img" { return }

        flushText()

        guard stack.count > 1 else { return }
        let ctx = stack.removeLast()

        // Skip elements that have no renderable content
        if ["head", "title", "meta", "link", "style", "script"].contains(ctx.name) {
            return
        }

        // Transparent wrappers: move children up to parent
        if ctx.name == "html" || ctx.name == "body" {
            if var parent = stack.last {
                parent.children.append(contentsOf: ctx.children)
                stack[stack.count - 1] = parent
            }
            return
        }

        // Inline elements: transfer their runs up to the parent context
        if Self.inlineElements.contains(ctx.name) && !Self.blockElements.contains(ctx.name) {
            if !ctx.runs.isEmpty, stack.count > 0 {
                stack[stack.count - 1].runs.append(contentsOf: ctx.runs)
            }
            return
        }

        // Build the ContentNode for this block element
        let node = buildNode(from: ctx)
        appendToParent(node)
    }

    func parser(_ parser: XMLParser, parseErrorOccurred parseError: Error) {
        parserLogger.warning("XML parse error: \(parseError.localizedDescription)")
    }

    // MARK: - Node Building

    private func buildNode(from ctx: ElementContext) -> ContentNode {
        let name = ctx.name
        let runs = ctx.runs.isEmpty ? consolidateChildRuns(ctx.children) : ctx.runs

        // Headings
        if let level = Self.headingLevels[name] {
            let headingRuns = runs.isEmpty ? [TextRun(text: " ")] : runs
            return .heading(level: level, runs: headingRuns)
        }

        // Paragraphs
        if name == "p" {
            if runs.isEmpty && ctx.children.isEmpty {
                return .paragraph(runs: [TextRun(text: " ")])
            }
            if !runs.isEmpty {
                return .paragraph(runs: runs)
            }
            // If only children (nested blocks), wrap in container
            return ctx.children.count == 1 ? ctx.children[0] : .container(children: ctx.children)
        }

        // Preformatted / code blocks
        if name == "pre" {
            let text = runs.map(\.text).joined()
            return .codeBlock(text: text.isEmpty ? " " : text)
        }

        // Lists
        if name == "ul" || name == "ol" {
            return .list(ordered: ctx.listOrdered ?? false, items: ctx.listItems)
        }

        // List items
        if name == "li" {
            // Collect content as child nodes
            var children = ctx.children
            if !runs.isEmpty {
                children.insert(.paragraph(runs: runs), at: 0)
            }
            // This gets collected by the parent list element
            return .container(children: children)
        }

        // Tables
        if name == "table" {
            return .table(rows: ctx.tableRows)
        }
        if name == "tr" {
            return .container(children: []) // Handled by table context
        }
        if name == "td" || name == "th" {
            return .container(children: []) // Handled by row context
        }

        // Blockquotes
        if name == "blockquote" {
            var children = ctx.children
            if !runs.isEmpty {
                children.insert(.paragraph(runs: runs), at: 0)
            }
            return .blockquote(children: children.isEmpty ? [.paragraph(runs: [TextRun(text: " ")])] : children)
        }

        // Figcaption
        if name == "figcaption" {
            return .paragraph(runs: runs.isEmpty ? [TextRun(text: " ")] : runs)
        }

        // Generic containers (div, section, article, figure, etc.)
        var children = ctx.children
        if !runs.isEmpty {
            children.insert(.paragraph(runs: runs), at: 0)
        }
        if children.isEmpty {
            return .paragraph(runs: [TextRun(text: " ")])
        }
        return children.count == 1 ? children[0] : .container(children: children)
    }

    // MARK: - Text Flushing

    private func flushText() {
        guard !currentText.isEmpty else { return }
        guard stack.count > 0 else {
            currentText = ""
            return
        }

        let isPre = stack.last?.isPreformatted ?? false
        let processed: String

        if isPre {
            processed = currentText
        } else {
            // Collapse whitespace: replace runs of whitespace with single space
            processed = currentText
                .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        }

        // Don't add empty runs (but allow single space in pre mode)
        if processed.isEmpty || (!isPre && processed == " " && (stack.last?.runs.isEmpty ?? true)) {
            currentText = ""
            return
        }

        let styles = stack.last?.styles ?? []
        let link = stack.last?.link
        let run = TextRun(text: processed, styles: styles, link: link)

        stack[stack.count - 1].runs.append(run)
        currentText = ""
    }

    // MARK: - Helpers

    private func localName(_ elementName: String) -> String {
        elementName.components(separatedBy: ":").last ?? elementName
    }

    private func makeContext(name: String, styles: Set<TextStyle> = [],
                             link: URL? = nil, pre: Bool = false) -> ElementContext {
        ElementContext(
            name: name,
            children: [],
            runs: [],
            styles: styles,
            link: link,
            isPreformatted: pre,
            listOrdered: nil,
            listItems: [],
            tableRows: [],
            tableCells: [],
            isCellHeader: false
        )
    }

    private func appendToParent(_ node: ContentNode) {
        guard stack.count > 0 else { return }

        let parentName = stack[stack.count - 1].name

        // Special handling for list items → parent list
        if parentName == "ul" || parentName == "ol" {
            if case .container(let children) = node {
                stack[stack.count - 1].listItems.append(ListItem(children: children))
            } else {
                stack[stack.count - 1].listItems.append(ListItem(children: [node]))
            }
            return
        }

        // Special handling for table cells → parent row
        if parentName == "tr" {
            if case .container(_) = node {
                // td/th was processed - get runs from the original context
                // The runs are already captured in the node
            }
            // Cells are added differently - handled in didEndElement
            stack[stack.count - 1].children.append(node)
            return
        }

        // Special handling for table rows → parent table
        if parentName == "table" || parentName == "thead" || parentName == "tbody" || parentName == "tfoot" {
            // Collect table rows
            if case .container(_) = node {
                // This was a <tr> - build TableRow from its cells
            }
            stack[stack.count - 1].children.append(node)
            return
        }

        stack[stack.count - 1].children.append(node)
    }

    private func handleImage(_ attributes: [String: String]) {
        guard let src = attributes["src"] ?? attributes["xlink:href"] else { return }

        let imageURL: URL
        if src.hasPrefix("http://") || src.hasPrefix("https://") {
            guard let url = URL(string: src) else { return }
            imageURL = url
        } else {
            imageURL = baseURL.appendingPathComponent(src)
        }

        let alt = attributes["alt"]
        let width = attributes["width"].flatMap { Double($0) }.map { CGFloat($0) }
        let height = attributes["height"].flatMap { Double($0) }.map { CGFloat($0) }

        appendToParent(.image(url: imageURL, alt: alt, width: width, height: height))
    }

    /// Extract text runs from a list of child nodes (for elements that contain
    /// only inline content but got parsed as children).
    private func consolidateChildRuns(_ children: [ContentNode]) -> [TextRun] {
        var runs: [TextRun] = []
        for child in children {
            switch child {
            case .paragraph(let childRuns):
                runs.append(contentsOf: childRuns)
            case .heading(_, let childRuns):
                runs.append(contentsOf: childRuns)
            default:
                break
            }
        }
        return runs
    }
}
