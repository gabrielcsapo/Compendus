//
//  XHTMLContentParser.swift
//  Compendus
//
//  Parses EPUB XHTML chapter content into a ContentNode AST.
//  Uses SwiftSoup for HTML5-tolerant DOM parsing.
//  Supports CSS class-based style resolution via an optional CSSStylesheet.
//

import Foundation
import SwiftSoup
import os.log

private let parserLogger = Logger(subsystem: "com.compendus.reader", category: "XHTMLParser")

class XHTMLContentParser {
    private let data: Data
    private let baseURL: URL
    private let stylesheet: CSSStylesheet?

    // Block-level tag names
    private static let blockTags: Set<String> = [
        "p", "div", "section", "article", "main", "aside", "nav",
        "header", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
        "blockquote", "pre", "figure", "figcaption",
        "ul", "ol", "li", "dl", "dt", "dd",
        "table", "thead", "tbody", "tfoot", "tr", "td", "th",
        "hr", "br", "img", "video", "audio", "address",
        "svg"
    ]

    // Inline tag names
    private static let inlineTags: Set<String> = [
        "em", "i", "strong", "b", "a", "span", "code",
        "sup", "sub", "u", "s", "del", "mark", "small",
        "cite", "q", "dfn", "abbr", "time", "var", "kbd", "samp",
        "ruby", "rt", "rp", "bdi", "bdo", "wbr", "data", "output"
    ]

    // Heading level map
    private static let headingLevels: [String: Int] = [
        "h1": 1, "h2": 2, "h3": 3, "h4": 4, "h5": 5, "h6": 6
    ]

    init(data: Data, baseURL: URL, stylesheet: CSSStylesheet? = nil) {
        self.data = data
        self.baseURL = baseURL
        self.stylesheet = stylesheet
    }

    /// Parse XHTML data and return an array of block-level content nodes.
    func parse() -> [ContentNode] {
        // Convert data to string (try UTF-8, fallback to Latin-1)
        let html: String
        if let utf8 = String(data: data, encoding: .utf8) {
            html = utf8
        } else if let latin1 = String(data: data, encoding: .isoLatin1) {
            html = latin1
        } else {
            parserLogger.warning("Could not decode XHTML data")
            return []
        }

        do {
            let document = try SwiftSoup.parse(html)

            // Find <body> element, fallback to document root
            let body: Element
            if let bodyEl = try document.body() {
                body = bodyEl
            } else {
                body = document
            }

            let nodes = processChildren(of: body)
            parserLogger.info("Parsed XHTML: \(nodes.count) top-level nodes from \(self.data.count) bytes")
            if nodes.isEmpty {
                parserLogger.warning("Parser returned ZERO nodes")
            }
            return nodes
        } catch {
            parserLogger.warning("SwiftSoup parse error: \(error.localizedDescription)")
            return []
        }
    }

    // MARK: - DOM Walking

    /// Process all child nodes of an element, returning block-level ContentNodes.
    /// Inline content between blocks is accumulated and flushed as paragraphs.
    private func processChildren(of element: Element) -> [ContentNode] {
        var nodes: [ContentNode] = []
        var pendingRuns: [TextRun] = []

        func flushPendingRuns() {
            let trimmed = trimWhitespaceRuns(pendingRuns)
            if !trimmed.isEmpty {
                nodes.append(.paragraph(runs: trimmed))
            }
            pendingRuns = []
        }

        for child in element.getChildNodes() {
            if let textNode = child as? TextNode {
                let text = collapseWhitespace(textNode.getWholeText())
                if !text.isEmpty && text != " " || !pendingRuns.isEmpty {
                    if !text.isEmpty {
                        pendingRuns.append(TextRun(text: text))
                    }
                }
            } else if let el = child as? Element {
                let tag = el.tagName().lowercased()

                // Skip non-content elements: scripts, styles, form controls,
                // and EPUB-specific namespace elements (epub:trigger, etc.)
                if ["script", "style", "link", "meta",
                    "button", "input", "select", "textarea", "form"].contains(tag)
                    || tag.hasPrefix("epub:") {
                    continue
                }

                if isBlockTag(tag) {
                    flushPendingRuns()
                    if let node = processBlockElement(el) {
                        nodes.append(node)
                    }
                } else {
                    // Inline element — resolve its own styles/link, then collect children
                    let (styles, link) = resolveInlineStyles(for: el, inheritedStyles: [], inheritedLink: nil)
                    let runs = collectInlineRuns(from: el, inheritedStyles: styles, inheritedLink: link)
                    pendingRuns.append(contentsOf: runs)
                }
            }
        }

        flushPendingRuns()
        return nodes
    }

    /// Process a block-level element and return a ContentNode.
    private func processBlockElement(_ el: Element) -> ContentNode? {
        let tag = el.tagName().lowercased()
        let blockStyle = resolveBlockStyle(for: el)

        // Skip display: none
        if blockStyle.display == CSSDisplay.none {
            return nil
        }

        switch tag {
        case "h1", "h2", "h3", "h4", "h5", "h6":
            let level = Self.headingLevels[tag] ?? 1
            var runs = collectInlineRuns(from: el, inheritedStyles: [], inheritedLink: nil)
            // Apply CSS inline styles to heading
            applyBlockCSSInlineStyles(el, to: &runs)
            if runs.isEmpty { runs = [TextRun(text: " ")] }
            return .heading(level: level, runs: runs, blockStyle: blockStyle)

        case "p":
            var runs = collectInlineRuns(from: el, inheritedStyles: [], inheritedLink: nil)
            applyBlockCSSInlineStyles(el, to: &runs)
            // Check if p contains block children (images, etc.) — searches recursively through inline wrappers
            let blockChildren = collectBlockChildNodes(from: el)
            if !blockChildren.isEmpty {
                // Collect alt texts from discovered images so we can filter redundant placeholder runs
                var imageAlts: Set<String> = []
                for child in blockChildren {
                    if case .image(_, let alt, _, _, _) = child, let alt {
                        imageAlts.insert("[\(alt)]")
                    }
                }
                let meaningfulRuns = runs.filter { !imageAlts.contains($0.text.trimmingCharacters(in: .whitespaces)) }
                let trimmedRuns = trimWhitespaceRuns(meaningfulRuns)
                var children = blockChildren
                if !trimmedRuns.isEmpty {
                    children.insert(.paragraph(runs: trimmedRuns, blockStyle: blockStyle), at: 0)
                }
                return children.count == 1 ? children[0] : .container(children: children, blockStyle: blockStyle)
            } else if !runs.isEmpty {
                return .paragraph(runs: runs, blockStyle: blockStyle)
            }
            return .paragraph(runs: [TextRun(text: " ")], blockStyle: blockStyle)

        case "pre":
            let text = getPreformattedText(el)
            return .codeBlock(text: text.isEmpty ? " " : text)

        case "ul":
            return processList(el, ordered: false, blockStyle: blockStyle)
        case "ol":
            return processList(el, ordered: true, blockStyle: blockStyle)

        case "dl":
            return processDefinitionList(el, blockStyle: blockStyle)

        case "blockquote":
            let children = processChildren(of: el)
            return .blockquote(children: children.isEmpty ? [.paragraph(runs: [TextRun(text: " ")])] : children)

        case "table":
            return processTable(el)

        case "hr":
            return .horizontalRule

        case "br":
            return .paragraph(runs: [TextRun(text: "\n")])

        case "img":
            return processImage(el)

        case "svg":
            return processSVG(el)

        case "video":
            return processVideo(el)

        case "audio":
            return processAudio(el)

        case "figure":
            return processFigure(el, blockStyle: blockStyle)

        case "figcaption":
            let runs = collectInlineRuns(from: el, inheritedStyles: [], inheritedLink: nil)
            return .paragraph(runs: runs.isEmpty ? [TextRun(text: " ")] : runs, blockStyle: blockStyle)

        case "li", "dt", "dd":
            // These should normally be handled by their parent (ul/ol/dl),
            // but handle gracefully if encountered standalone
            let children = processChildren(of: el)
            let runs = collectInlineRuns(from: el, inheritedStyles: [], inheritedLink: nil)
            if !children.isEmpty {
                return children.count == 1 ? children[0] : .container(children: children, blockStyle: blockStyle)
            }
            return .paragraph(runs: runs.isEmpty ? [TextRun(text: " ")] : runs, blockStyle: blockStyle)

        case "tr", "td", "th", "thead", "tbody", "tfoot":
            // Should be handled by processTable
            return nil

        case "address":
            let runs = collectInlineRuns(from: el, inheritedStyles: [.italic], inheritedLink: nil)
            return .paragraph(runs: runs.isEmpty ? [TextRun(text: " ")] : runs, blockStyle: blockStyle)

        default:
            // Generic container: div, section, article, nav, aside, header, footer, etc.
            let children = processChildren(of: el)
            if children.isEmpty {
                let runs = collectInlineRuns(from: el, inheritedStyles: [], inheritedLink: nil)
                if runs.isEmpty { return nil }
                return .paragraph(runs: runs, blockStyle: blockStyle)
            }
            return children.count == 1 ? children[0] : .container(children: children, blockStyle: blockStyle)
        }
    }

    // MARK: - Inline Content Collection

    /// Resolve an inline element's tag-based and CSS-based styles and link.
    /// Returns the merged styles and link to pass to child content.
    private func resolveInlineStyles(for el: Element, inheritedStyles: Set<TextStyle>, inheritedLink: URL?) -> (styles: Set<TextStyle>, link: URL?) {
        let tag = el.tagName().lowercased()
        var styles = inheritedStyles
        var link = inheritedLink

        // Tag-based styles
        switch tag {
        case "em", "i", "cite", "dfn":
            styles.insert(.italic)
        case "strong", "b":
            styles.insert(.bold)
        case "code", "var", "kbd", "samp":
            styles.insert(.code)
        case "sup":
            styles.insert(.superscript)
        case "sub":
            styles.insert(.subscript)
        case "u":
            styles.insert(.underline)
        case "s", "del":
            styles.insert(.strikethrough)
        default:
            break
        }

        // CSS-based styles
        let cssProps = resolveCSSProperties(for: el)
        if cssProps.fontStyle == .italic { styles.insert(.italic) }
        if cssProps.fontWeight == .bold { styles.insert(.bold) }
        if cssProps.fontVariant == .smallCaps { styles.insert(.smallCaps) }
        if cssProps.textTransform == .uppercase { styles.insert(.uppercase) }
        if cssProps.textDecoration == .underline { styles.insert(.underline) }
        if cssProps.textDecoration == .lineThrough { styles.insert(.strikethrough) }

        // Link handling
        if tag == "a" {
            if let href = try? el.attr("href"), !href.isEmpty {
                link = URL(string: href, relativeTo: baseURL)
                styles.insert(.underline)
            }
        }

        return (styles, link)
    }

    /// Recursively collect TextRuns from an element's inline content.
    /// If a block element is encountered inside inline context, it gets collected separately.
    private func collectInlineRuns(from element: Element, inheritedStyles: Set<TextStyle>, inheritedLink: URL?) -> [TextRun] {
        var runs: [TextRun] = []

        for child in element.getChildNodes() {
            if let textNode = child as? TextNode {
                let isPreformatted = isPreformattedContext(element)
                let text = isPreformatted ? textNode.getWholeText() : collapseWhitespace(textNode.getWholeText())
                if !text.isEmpty {
                    runs.append(TextRun(text: text, styles: inheritedStyles, link: inheritedLink))
                }
            } else if let el = child as? Element {
                let tag = el.tagName().lowercased()

                // Skip non-content: scripts, styles, form controls, epub: elements
                if ["script", "style", "link", "meta",
                    "button", "input", "select", "textarea", "form"].contains(tag)
                    || tag.hasPrefix("epub:") {
                    continue
                }

                // Handle <br> as newline
                if tag == "br" {
                    runs.append(TextRun(text: "\n", styles: inheritedStyles, link: inheritedLink))
                    continue
                }

                // Handle <img> and SVG <image> inline (fixes bug #2: a > img)
                if tag == "img" || tag == "image" {
                    let alt = try? el.attr("alt")
                    if let alt, !alt.isEmpty {
                        runs.append(TextRun(text: "[\(alt)]", styles: inheritedStyles, link: inheritedLink))
                    }
                    continue
                }

                // If it's a block tag inside inline context, extract inline content
                if isBlockTag(tag) && !Self.inlineTags.contains(tag) {
                    let blockRuns = collectInlineRuns(from: el, inheritedStyles: inheritedStyles, inheritedLink: inheritedLink)
                    runs.append(contentsOf: blockRuns)
                    continue
                }

                // Inline element — resolve styles and link
                let (newStyles, newLink) = resolveInlineStyles(for: el, inheritedStyles: inheritedStyles, inheritedLink: inheritedLink)

                // CSS display: none check
                let cssProps = resolveCSSProperties(for: el)
                if cssProps.display == CSSDisplay.none {
                    continue
                }

                let childRuns = collectInlineRuns(from: el, inheritedStyles: newStyles, inheritedLink: newLink)
                runs.append(contentsOf: childRuns)
            }
        }

        return runs
    }

    /// Check if an element has block-level children, and collect them as ContentNodes.
    /// Recurses through inline wrappers (e.g. <span>, <a>) to find nested block content like <img>.
    private func collectBlockChildNodes(from element: Element) -> [ContentNode] {
        var nodes: [ContentNode] = []
        for child in element.getChildNodes() {
            guard let el = child as? Element else { continue }
            let tag = el.tagName().lowercased()
            if isBlockTag(tag) {
                if let node = processBlockElement(el) {
                    nodes.append(node)
                }
            } else {
                // Recurse into inline wrappers (e.g. <span><img/></span>)
                let nested = collectBlockChildNodes(from: el)
                nodes.append(contentsOf: nested)
            }
        }
        return nodes
    }

    // MARK: - Lists

    private func processList(_ el: Element, ordered: Bool, blockStyle: BlockStyle) -> ContentNode {
        var items: [ListItem] = []

        for child in el.children().array() {
            let tag = child.tagName().lowercased()
            if tag == "li" {
                let children = processListItemContent(child)
                items.append(ListItem(children: children))
            } else if tag == "ul" || tag == "ol" {
                // Nested list outside of li (rare but valid)
                if let nestedList = processBlockElement(child) {
                    items.append(ListItem(children: [nestedList]))
                }
            }
        }

        return .list(ordered: ordered, items: items, blockStyle: blockStyle)
    }

    private func processListItemContent(_ li: Element) -> [ContentNode] {
        var nodes: [ContentNode] = []
        var pendingRuns: [TextRun] = []
        let blockStyle = resolveBlockStyle(for: li)

        func flushRuns() {
            let trimmed = trimWhitespaceRuns(pendingRuns)
            if !trimmed.isEmpty {
                nodes.append(.paragraph(runs: trimmed, blockStyle: blockStyle))
            }
            pendingRuns = []
        }

        for child in li.getChildNodes() {
            if let textNode = child as? TextNode {
                let text = collapseWhitespace(textNode.getWholeText())
                if !text.isEmpty {
                    pendingRuns.append(TextRun(text: text))
                }
            } else if let el = child as? Element {
                let tag = el.tagName().lowercased()
                if isBlockTag(tag) {
                    flushRuns()
                    if let node = processBlockElement(el) {
                        nodes.append(node)
                    }
                } else {
                    // Resolve inline element's own styles/link before recursing
                    let (styles, link) = resolveInlineStyles(for: el, inheritedStyles: [], inheritedLink: nil)
                    let runs = collectInlineRuns(from: el, inheritedStyles: styles, inheritedLink: link)
                    pendingRuns.append(contentsOf: runs)
                }
            }
        }

        flushRuns()

        if nodes.isEmpty {
            nodes.append(.paragraph(runs: [TextRun(text: " ")], blockStyle: blockStyle))
        }

        return nodes
    }

    // MARK: - Definition Lists

    private func processDefinitionList(_ el: Element, blockStyle: BlockStyle) -> ContentNode {
        var items: [ListItem] = []

        for child in el.children().array() {
            let tag = child.tagName().lowercased()
            if tag == "dt" {
                // Definition term — render as bold
                var runs = collectInlineRuns(from: child, inheritedStyles: [.bold], inheritedLink: nil)
                if runs.isEmpty { runs = [TextRun(text: " ", styles: [.bold])] }
                items.append(ListItem(children: [.paragraph(runs: runs)]))
            } else if tag == "dd" {
                // Definition description — render normally, with some indent via container
                let children = processChildren(of: child)
                if children.isEmpty {
                    let runs = collectInlineRuns(from: child, inheritedStyles: [], inheritedLink: nil)
                    items.append(ListItem(children: [.paragraph(runs: runs.isEmpty ? [TextRun(text: " ")] : runs)]))
                } else {
                    items.append(ListItem(children: children))
                }
            }
        }

        return .list(ordered: false, items: items, blockStyle: blockStyle)
    }

    // MARK: - Tables

    private func processTable(_ el: Element) -> ContentNode {
        var rows: [TableRow] = []

        // Collect rows from thead, tbody, tfoot, or direct tr children
        let sections = el.children().array()
        for section in sections {
            let tag = section.tagName().lowercased()
            if tag == "tr" {
                if let row = processTableRow(section) {
                    rows.append(row)
                }
            } else if tag == "thead" || tag == "tbody" || tag == "tfoot" {
                for tr in section.children().array() {
                    if tr.tagName().lowercased() == "tr" {
                        if let row = processTableRow(tr) {
                            rows.append(row)
                        }
                    }
                }
            } else if tag == "caption" {
                // Skip caption for now (could be added as a paragraph above table)
            }
        }

        return .table(rows: rows)
    }

    private func processTableRow(_ tr: Element) -> TableRow? {
        var cells: [TableCell] = []

        for td in tr.children().array() {
            let tag = td.tagName().lowercased()
            if tag == "td" || tag == "th" {
                let runs = collectInlineRuns(from: td, inheritedStyles: tag == "th" ? [.bold] : [], inheritedLink: nil)
                cells.append(TableCell(isHeader: tag == "th", runs: runs))
            }
        }

        return cells.isEmpty ? nil : TableRow(cells: cells)
    }

    // MARK: - Media Elements

    private func processImage(_ el: Element) -> ContentNode? {
        let style = resolveMediaStyle(for: el)
        // Try src, then xlink:href (SVG1), then href (SVG2)
        let src: String? = {
            if let s = try? el.attr("src"), !s.isEmpty { return s }
            if let s = try? el.attr("xlink:href"), !s.isEmpty { return s }
            if let s = try? el.attr("href"), !s.isEmpty { return s }
            return nil
        }()
        guard let src else { return nil }

        let imageURL = resolveURL(src)
        let alt = try? el.attr("alt")
        let width = (try? el.attr("width")).flatMap { Double($0) }.map { CGFloat($0) }
        let height = (try? el.attr("height")).flatMap { Double($0) }.map { CGFloat($0) }
        return .image(url: imageURL, alt: alt, width: width, height: height, style: style)
    }

    private func processVideo(_ el: Element) -> ContentNode? {
        let style = resolveMediaStyle(for: el)
        var sources: [URL] = []
        let poster = (try? el.attr("poster")).flatMap { p -> URL? in
            guard !p.isEmpty else { return nil }
            return resolveURL(p)
        }

        // Check src attribute on video element itself
        if let src = try? el.attr("src"), !src.isEmpty {
            sources.append(resolveURL(src))
        }

        // Check <source> children
        for source in el.children().array() {
            if source.tagName().lowercased() == "source" {
                if let src = try? source.attr("src"), !src.isEmpty {
                    sources.append(resolveURL(src))
                }
            }
        }

        // Prefer MP4 for iOS
        let mp4Source = sources.first { $0.pathExtension.lowercased() == "mp4" }
        if let url = mp4Source ?? sources.first {
            return .video(url: url, poster: poster, style: style)
        }

        return nil
    }

    private func processAudio(_ el: Element) -> ContentNode? {
        let style = resolveMediaStyle(for: el)

        // Check src attribute on audio element itself
        if let src = try? el.attr("src"), !src.isEmpty {
            return .audio(url: resolveURL(src), style: style)
        }

        // Check <source> children
        for source in el.children().array() {
            if source.tagName().lowercased() == "source" {
                if let src = try? source.attr("src"), !src.isEmpty {
                    return .audio(url: resolveURL(src), style: style)
                }
            }
        }

        return nil
    }

    // MARK: - Figure

    private func processFigure(_ el: Element, blockStyle: BlockStyle) -> ContentNode {
        var children: [ContentNode] = []

        for child in el.children().array() {
            let tag = child.tagName().lowercased()
            if tag == "img" {
                if let img = processImage(child) {
                    children.append(img)
                }
            } else if tag == "video" {
                if let video = processVideo(child) {
                    children.append(video)
                }
            } else if tag == "audio" {
                if let audio = processAudio(child) {
                    children.append(audio)
                }
            } else if tag == "figcaption" {
                let runs = collectInlineRuns(from: child, inheritedStyles: [], inheritedLink: nil)
                if !runs.isEmpty {
                    children.append(.paragraph(runs: runs))
                }
            } else if tag == "a" {
                // Handle <figure><a><img></a></figure> pattern (fixes bug #2)
                for grandchild in child.children().array() {
                    let gtag = grandchild.tagName().lowercased()
                    if gtag == "img" {
                        if let img = processImage(grandchild) {
                            children.append(img)
                        }
                    }
                }
            } else if isBlockTag(tag) {
                if let node = processBlockElement(child) {
                    children.append(node)
                }
            }
        }

        if children.isEmpty {
            let runs = collectInlineRuns(from: el, inheritedStyles: [], inheritedLink: nil)
            if !runs.isEmpty {
                return .paragraph(runs: runs, blockStyle: blockStyle)
            }
            return .paragraph(runs: [TextRun(text: " ")], blockStyle: blockStyle)
        }
        return children.count == 1 ? children[0] : .container(children: children, blockStyle: blockStyle)
    }

    // MARK: - SVG

    private func processSVG(_ el: Element) -> ContentNode? {
        // Look for <image> children with xlink:href or href
        for child in el.children().array() {
            let tag = child.tagName().lowercased()
            if tag == "image" {
                return processImage(child)
            }
        }
        // Fallback: check for nested <svg> or <img>
        for child in el.children().array() {
            let tag = child.tagName().lowercased()
            if tag == "svg" {
                return processSVG(child)
            } else if tag == "img" {
                return processImage(child)
            }
        }
        return nil
    }

    // MARK: - CSS Resolution

    private func resolveCSSProperties(for element: Element) -> CSSProperties {
        guard let stylesheet else { return .empty }
        let tag = element.tagName().lowercased()
        let classes = (try? element.className())?.split(separator: " ").map(String.init).filter { !$0.isEmpty } ?? []
        let id = (try? element.attr("id")).flatMap { $0.isEmpty ? nil : $0 }
        return stylesheet.resolve(element: tag, classes: classes, id: id)
    }

    private func resolveMediaStyle(for element: Element) -> MediaStyle {
        let cssProps = resolveCSSProperties(for: element)
        var style = MediaStyle.empty
        style.cssWidth = cssProps.width
        style.cssHeight = cssProps.height
        style.cssFloat = cssProps.cssFloat
        style.marginLeft = cssProps.marginLeft
        style.marginRight = cssProps.marginRight
        style.marginTop = cssProps.marginTop
        style.marginBottom = cssProps.marginBottom
        // Centered when display:block with no float (margin:auto pattern)
        if cssProps.display == .block && (cssProps.cssFloat == nil || cssProps.cssFloat == .none) {
            style.isCentered = true
        }
        return style
    }

    private func resolveBlockStyle(for element: Element) -> BlockStyle {
        let cssProps = resolveCSSProperties(for: element)
        var blockStyle = BlockStyle.empty
        if let align = cssProps.textAlign { blockStyle.textAlign = align }
        if let indent = cssProps.textIndent { blockStyle.textIndent = indent }
        if let mt = cssProps.marginTop { blockStyle.marginTop = mt }
        if let mb = cssProps.marginBottom { blockStyle.marginBottom = mb }
        if let ml = cssProps.marginLeft { blockStyle.marginLeft = ml }
        if let mr = cssProps.marginRight { blockStyle.marginRight = mr }
        if let d = cssProps.display { blockStyle.display = d }
        if let lst = cssProps.listStyleType { blockStyle.listStyleType = lst }
        return blockStyle
    }

    /// Apply CSS inline styles (bold, italic, etc.) from a block element to its runs.
    private func applyBlockCSSInlineStyles(_ el: Element, to runs: inout [TextRun]) {
        let cssProps = resolveCSSProperties(for: el)
        var additionalStyles: Set<TextStyle> = []
        if cssProps.fontStyle == .italic { additionalStyles.insert(.italic) }
        if cssProps.fontWeight == .bold { additionalStyles.insert(.bold) }
        if cssProps.fontVariant == .smallCaps { additionalStyles.insert(.smallCaps) }
        if cssProps.textTransform == .uppercase { additionalStyles.insert(.uppercase) }

        if !additionalStyles.isEmpty {
            runs = runs.map { run in
                var newRun = run
                newRun.styles = newRun.styles.union(additionalStyles)
                return newRun
            }
        }
    }

    // MARK: - Helpers

    private func isBlockTag(_ tag: String) -> Bool {
        Self.blockTags.contains(tag)
    }

    private func isPreformattedContext(_ element: Element) -> Bool {
        var current: Element? = element
        while let el = current {
            if el.tagName().lowercased() == "pre" { return true }
            current = el.parent()
        }
        return false
    }

    private func getPreformattedText(_ element: Element) -> String {
        // For <pre> elements, we want to preserve whitespace
        // Use SwiftSoup's text extraction but with whitespace preserved
        var text = ""
        for child in element.getChildNodes() {
            if let textNode = child as? TextNode {
                text += textNode.getWholeText()
            } else if let el = child as? Element {
                if el.tagName().lowercased() == "br" {
                    text += "\n"
                } else {
                    text += getPreformattedText(el)
                }
            }
        }
        return text
    }

    private func collapseWhitespace(_ text: String) -> String {
        text.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
    }

    private func resolveURL(_ src: String) -> URL {
        if src.hasPrefix("http://") || src.hasPrefix("https://") {
            return URL(string: src) ?? baseURL.appendingPathComponent(src)
        }
        // appendingPathComponent + standardizedFileURL properly resolves ../
        let resolved = baseURL.appendingPathComponent(src).standardizedFileURL
        if !FileManager.default.fileExists(atPath: resolved.path) {
            print("[ResolveURL] NOT FOUND: src='\(src)' base='\(baseURL.path)' resolved='\(resolved.path)'")
        }
        return resolved
    }

    /// Remove leading/trailing whitespace-only runs and trim edge whitespace.
    private func trimWhitespaceRuns(_ runs: [TextRun]) -> [TextRun] {
        guard !runs.isEmpty else { return [] }

        var result = runs

        // Trim leading whitespace from first run
        if let first = result.first {
            let trimmed = first.text.replacingOccurrences(of: "^\\s+", with: "", options: .regularExpression)
            if trimmed.isEmpty {
                result.removeFirst()
            } else if trimmed != first.text {
                result[0] = TextRun(text: trimmed, styles: first.styles, link: first.link)
            }
        }

        // Trim trailing whitespace from last run
        if let last = result.last {
            let trimmed = last.text.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)
            if trimmed.isEmpty {
                result.removeLast()
            } else if trimmed != last.text {
                result[result.count - 1] = TextRun(text: trimmed, styles: last.styles, link: last.link)
            }
        }

        return result
    }
}
