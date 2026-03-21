//
//  XHTMLContentParserTests.swift
//  CompendusTests
//
//  Tests for XHTML → ContentNode AST parsing.
//

import XCTest
@testable import EPUBReader

final class XHTMLContentParserTests: XCTestCase {

    private func parse(_ body: String) -> [ContentNode] {
        let data = TestHelpers.xhtmlData(body: body)
        let parser = XHTMLContentParser(data: data, baseURL: URL(fileURLWithPath: "/tmp"))
        return parser.parse()
    }

    // MARK: - Basic Elements

    func testBasicParagraph() {
        let nodes = parse("<p>Hello world</p>")

        XCTAssertEqual(nodes.count, 1)
        if case .paragraph(let runs, _) = nodes.first {
            XCTAssertEqual(runs.count, 1)
            XCTAssertTrue(runs[0].text.contains("Hello world"))
        } else {
            XCTFail("Expected a paragraph node")
        }
    }

    func testHeadingLevels() {
        let nodes = parse("<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>")

        XCTAssertGreaterThanOrEqual(nodes.count, 3)

        if case .heading(let level, let runs, _) = nodes[0] {
            XCTAssertEqual(level, 1)
            XCTAssertTrue(runs[0].text.contains("Title"))
        } else {
            XCTFail("Expected h1 heading")
        }

        if case .heading(let level, _, _) = nodes[1] {
            XCTAssertEqual(level, 2)
        } else {
            XCTFail("Expected h2 heading")
        }

        if case .heading(let level, _, _) = nodes[2] {
            XCTAssertEqual(level, 3)
        } else {
            XCTFail("Expected h3 heading")
        }
    }

    // MARK: - Inline Styles

    func testBoldStyle() {
        let nodes = parse("<p><strong>bold text</strong></p>")

        if case .paragraph(let runs, _) = nodes.first {
            XCTAssertTrue(runs.contains { $0.styles.contains(.bold) },
                          "Should have a bold run")
        } else {
            XCTFail("Expected paragraph")
        }
    }

    func testItalicStyle() {
        let nodes = parse("<p><em>italic text</em></p>")

        if case .paragraph(let runs, _) = nodes.first {
            XCTAssertTrue(runs.contains { $0.styles.contains(.italic) },
                          "Should have an italic run")
        } else {
            XCTFail("Expected paragraph")
        }
    }

    func testCodeStyle() {
        let nodes = parse("<p><code>code text</code></p>")

        if case .paragraph(let runs, _) = nodes.first {
            XCTAssertTrue(runs.contains { $0.styles.contains(.code) },
                          "Should have a code-styled run")
        } else {
            XCTFail("Expected paragraph")
        }
    }

    func testNestedBoldItalic() {
        let nodes = parse("<p><strong><em>bold italic</em></strong></p>")

        if case .paragraph(let runs, _) = nodes.first {
            let combined = runs.filter { $0.styles.contains(.bold) && $0.styles.contains(.italic) }
            XCTAssertFalse(combined.isEmpty, "Should have a run with both bold and italic")
        } else {
            XCTFail("Expected paragraph")
        }
    }

    // MARK: - Block Elements

    func testImageElement() {
        let nodes = parse("<img src=\"image.png\" alt=\"A picture\" />")

        let imageNodes = nodes.filter {
            if case .image = $0 { return true }
            return false
        }
        XCTAssertFalse(imageNodes.isEmpty, "Should have an image node")
    }

    func testListParsing() {
        let nodes = parse("<ul><li>Item 1</li><li>Item 2</li></ul>")

        let listNodes = nodes.filter {
            if case .list = $0 { return true }
            return false
        }
        XCTAssertFalse(listNodes.isEmpty, "Should have a list node")

        if case .list(let ordered, let items, _) = listNodes.first {
            XCTAssertFalse(ordered, "Should be unordered")
            XCTAssertEqual(items.count, 2, "Should have 2 list items")
        }
    }

    func testHorizontalRule() {
        let nodes = parse("<p>Before</p><hr/><p>After</p>")

        let hrNodes = nodes.filter {
            if case .horizontalRule = $0 { return true }
            return false
        }
        XCTAssertFalse(hrNodes.isEmpty, "Should have a horizontal rule")
    }

    // MARK: - Document Structure

    func testBodyContentExtraction() {
        // Full XHTML with head styles — only body content should be returned
        let xhtml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
            <title>Test Title</title>
            <style>body { color: red; }</style>
            <link rel="stylesheet" href="style.css"/>
        </head>
        <body>
            <h1>Chapter One</h1>
            <p>The first paragraph.</p>
        </body>
        </html>
        """
        let data = Data(xhtml.utf8)
        let parser = XHTMLContentParser(data: data, baseURL: URL(fileURLWithPath: "/tmp"))
        let nodes = parser.parse()

        XCTAssertGreaterThanOrEqual(nodes.count, 2, "Should parse heading and paragraph from body")

        // Verify no style/title text leaked into content
        let allText = extractAllText(from: nodes)
        XCTAssertFalse(allText.contains("body { color: red; }"), "CSS should not appear in content")
        XCTAssertTrue(allText.contains("Chapter One"), "Heading text should be present")
        XCTAssertTrue(allText.contains("The first paragraph"), "Paragraph text should be present")
    }

    func testSampleChapter() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        // Parse the first actual chapter (skip cover/title pages if present)
        let chapterIndex = min(2, parser.package.spine.count - 1)
        let chapterURL = try XCTUnwrap(parser.resolveSpineItemURL(at: chapterIndex))
        let data = try Data(contentsOf: chapterURL)

        let baseURL = chapterURL.deletingLastPathComponent()
        let contentParser = XHTMLContentParser(data: data, baseURL: baseURL)
        let nodes = contentParser.parse()

        XCTAssertGreaterThan(nodes.count, 0, "Chapter should produce content nodes")
    }

    // MARK: - Sample EPUB Content Loss Detection

    /// Parses every chapter of every sample EPUB and verifies no text content is silently lost.
    /// Compares the plain text extracted from the XHTML (tag-stripped) against the parsed AST output.
    /// Add new .epub files to the Samples folder to automatically include them in this test.
    func testAllSampleEPUBsNoContentLoss() async throws {
        let samples = TestHelpers.allSampleEPUBNames
        XCTAssertGreaterThan(samples.count, 0, "Should have sample EPUBs in the test bundle")

        var failures: [(book: String, chapter: Int, ratio: Double)] = []

        for name in samples {
            guard let url = TestHelpers.sampleEPUBURL(named: name),
                  let epub = try? await EPUBParser.parse(epubURL: url) else { continue }

            let stylesheet = loadStylesheet(from: epub)

            for spineIndex in 0..<epub.package.spine.count {
                guard let chapterURL = epub.resolveSpineItemURL(at: spineIndex) else { continue }

                // Skip non-XHTML spine items (images, SVG-only pages, etc.)
                if let item = epub.manifestItem(forSpineIndex: spineIndex) {
                    let mt = item.mediaType.lowercased()
                    if !mt.contains("xhtml") && !mt.contains("html") { continue }
                }

                guard let data = try? Data(contentsOf: chapterURL) else { continue }

                // Extract expected visible text by stripping HTML tags and decoding entities
                let expectedText = normalizeForComparison(stripHTMLTags(from: data))

                // Skip chapters with very little visible text (cover pages, images-only, etc.)
                guard expectedText.count > 50 else { continue }

                // Parse through our pipeline
                let baseURL = chapterURL.deletingLastPathComponent()
                let contentParser = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet)
                let nodes = contentParser.parse()
                let parsedText = normalizeForComparison(
                    NativeEPUBEngine.extractPlainText(from: nodes)
                )

                // Compare character counts — the parsed output should capture most of the text.
                // We use a generous threshold because:
                // - HTML entity-encoded code examples inflate the expected count
                // - Some elements (video fallback text, metadata) are legitimately excluded
                let ratio = expectedText.isEmpty ? 1.0 : Double(parsedText.count) / Double(expectedText.count)

                // Flag if we captured less than 40% of the expected text length
                if ratio < 0.40 {
                    failures.append((book: name, chapter: spineIndex, ratio: ratio))
                }
            }
        }

        XCTAssertTrue(failures.isEmpty,
                      "Chapters with significant content loss:\n" +
                      failures.map { "  \($0.book) ch.\($0.chapter): only \(Int($0.ratio * 100))% of text captured" }
                          .joined(separator: "\n"))
    }

    /// Verify that every XHTML chapter produces at least one content node (no silent full-chapter drops).
    func testAllSampleEPUBsProduceNodes() async throws {
        let samples = TestHelpers.allSampleEPUBNames
        var emptyChapters: [(book: String, chapter: Int)] = []

        for name in samples {
            guard let url = TestHelpers.sampleEPUBURL(named: name),
                  let epub = try? await EPUBParser.parse(epubURL: url) else { continue }

            let stylesheet = loadStylesheet(from: epub)

            for spineIndex in 0..<epub.package.spine.count {
                guard let chapterURL = epub.resolveSpineItemURL(at: spineIndex) else { continue }

                if let item = epub.manifestItem(forSpineIndex: spineIndex) {
                    let mt = item.mediaType.lowercased()
                    if !mt.contains("xhtml") && !mt.contains("html") { continue }
                }

                guard let data = try? Data(contentsOf: chapterURL) else { continue }

                // Skip files with very little content (empty wrapper pages, etc.)
                let visibleText = normalizeForComparison(stripHTMLTags(from: data))
                guard visibleText.count > 20 else { continue }

                let baseURL = chapterURL.deletingLastPathComponent()
                let contentParser = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet)
                let nodes = contentParser.parse()

                if nodes.isEmpty {
                    emptyChapters.append((book: name, chapter: spineIndex))
                }
            }
        }

        XCTAssertTrue(emptyChapters.isEmpty,
                      "Chapters produced zero nodes: \(emptyChapters.map { "\($0.book) ch.\($0.chapter)" }.joined(separator: ", "))")
    }

    // MARK: - Content Loss Helpers

    /// Load combined CSS stylesheet from an EPUB's manifest.
    private func loadStylesheet(from epub: EPUBParser) -> CSSStylesheet? {
        var stylesheet = CSSStylesheet()
        var found = false
        for (_, item) in epub.package.manifest {
            guard item.mediaType == "text/css" else { continue }
            let cssURL = epub.resolveURL(for: item)
            guard let cssData = try? Data(contentsOf: cssURL),
                  let cssText = String(data: cssData, encoding: .utf8) else { continue }
            let parsed = CSSParser.parse(cssText)
            stylesheet.merge(with: parsed)
            found = true
        }
        return found ? stylesheet : nil
    }

    /// Strip HTML tags to extract visible text from raw XHTML data.
    private func stripHTMLTags(from data: Data) -> String {
        guard let html = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1) else { return "" }

        var result = ""
        var inTag = false
        var inScript = false
        var inStyle = false
        var inHead = false
        var tagBuffer = ""

        for char in html {
            if char == "<" {
                inTag = true
                tagBuffer = ""
            } else if char == ">" && inTag {
                inTag = false
                let lower = tagBuffer.lowercased().trimmingCharacters(in: .whitespaces)
                if lower.hasPrefix("script") { inScript = true }
                else if lower.hasPrefix("/script") { inScript = false }
                else if lower.hasPrefix("style") { inStyle = true }
                else if lower.hasPrefix("/style") { inStyle = false }
                else if lower.hasPrefix("head") { inHead = true }
                else if lower.hasPrefix("/head") { inHead = false }
            } else if inTag {
                tagBuffer.append(char)
            } else if !inScript && !inStyle && !inHead {
                result.append(char)
            }
        }

        return result
    }

    /// Decode common HTML entities and collapse whitespace for comparison.
    private func normalizeForComparison(_ text: String) -> String {
        var s = text
        // Decode common HTML entities
        s = s.replacingOccurrences(of: "&amp;", with: "&")
        s = s.replacingOccurrences(of: "&lt;", with: "<")
        s = s.replacingOccurrences(of: "&gt;", with: ">")
        s = s.replacingOccurrences(of: "&quot;", with: "\"")
        s = s.replacingOccurrences(of: "&apos;", with: "'")
        s = s.replacingOccurrences(of: "&nbsp;", with: " ")
        // Decode numeric entities (&#160; &#8211; etc.)
        s = s.replacingOccurrences(of: "&#\\d+;", with: " ", options: .regularExpression)
        // Collapse whitespace
        s = s.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        return s.trimmingCharacters(in: .whitespaces)
    }

    // MARK: - Content Loss Prevention

    func testTableCellsOutsideTablePreserveText() {
        let nodes = parse("<div><tr><td>Cell content</td></tr></div>")
        let allText = extractAllText(from: nodes)
        XCTAssertTrue(allText.contains("Cell content"),
                      "Table cells outside <table> should render as plain text, not be dropped")
    }

    func testStandaloneTableRowPreservesText() {
        let nodes = parse("<td>Orphaned cell</td>")
        let allText = extractAllText(from: nodes)
        XCTAssertTrue(allText.contains("Orphaned cell"),
                      "Standalone <td> should preserve its text content")
    }

    func testFormElementsPreserveText() {
        let nodes = parse("<p>Before</p><form><button>Submit</button></form><p>After</p>")
        let allText = extractAllText(from: nodes)
        XCTAssertTrue(allText.contains("Submit"),
                      "Button text inside form should be rendered as plain text")
        XCTAssertTrue(allText.contains("Before"))
        XCTAssertTrue(allText.contains("After"))
    }

    func testButtonTextPreserved() {
        let nodes = parse("<p>Click <button>here</button> to continue</p>")
        let allText = extractAllText(from: nodes)
        XCTAssertTrue(allText.contains("here"),
                      "Button text should be preserved as plain text")
    }

    func testEPUBNamespaceElementsPreserveText() {
        let nodes = parse("""
        <p>Some <epub:span>important text</epub:span> here</p>
        """)
        let allText = extractAllText(from: nodes)
        XCTAssertTrue(allText.contains("important text"),
                      "EPUB namespace elements should render text content instead of being dropped")
    }

    func testSVGWithTextContent() {
        let nodes = parse("""
        <svg viewBox="0 0 100 100">
            <text x="10" y="20">Diagram Label</text>
            <circle cx="50" cy="50" r="40"/>
        </svg>
        """)
        let allText = extractAllText(from: nodes)
        XCTAssertTrue(allText.contains("Diagram Label"),
                      "SVG text content should be extracted as plain text fallback")
    }

    func testSVGWithNestedTextSpan() {
        let nodes = parse("""
        <svg><text><tspan>Line 1</tspan><tspan>Line 2</tspan></text></svg>
        """)
        let allText = extractAllText(from: nodes)
        XCTAssertTrue(allText.contains("Line 1"), "SVG tspan text should be preserved")
        XCTAssertTrue(allText.contains("Line 2"), "SVG tspan text should be preserved")
    }

    func testFigcaptionWithBlockChildren() {
        let nodes = parse("""
        <figure>
            <img src="img.png" alt="test"/>
            <figcaption>
                <p>First caption paragraph</p>
                <p>Second caption paragraph</p>
            </figcaption>
        </figure>
        """)
        let allText = extractAllText(from: nodes)
        XCTAssertTrue(allText.contains("First caption paragraph"),
                      "First figcaption paragraph should be preserved")
        XCTAssertTrue(allText.contains("Second caption paragraph"),
                      "Second figcaption paragraph should not be lost")
    }

    func testFormElementsInInlineContext() {
        let nodes = parse("<p>Enter <input type=\"text\" value=\"name\"/> and <select><option>Option A</option></select></p>")
        let allText = extractAllText(from: nodes)
        XCTAssertTrue(allText.contains("Option A"),
                      "Select option text should be preserved as plain text")
    }

    func testScriptAndStyleStillSkipped() {
        let nodes = parse("<p>Visible</p><script>var x = 1;</script><style>.foo{}</style><p>Also visible</p>")
        let allText = extractAllText(from: nodes)
        XCTAssertFalse(allText.contains("var x = 1"), "Script content should still be skipped")
        XCTAssertFalse(allText.contains(".foo"), "Style content should still be skipped")
        XCTAssertTrue(allText.contains("Visible"))
        XCTAssertTrue(allText.contains("Also visible"))
    }

    func testUnknownBlockElementPreservesChildren() {
        // Unknown block elements should recurse into children, not drop content
        let nodes = parse("<div><p>Content inside div</p></div>")
        let allText = extractAllText(from: nodes)
        XCTAssertTrue(allText.contains("Content inside div"))
    }

    // MARK: - Helpers

    private func extractAllText(from nodes: [ContentNode]) -> String {
        var text = ""
        for node in nodes {
            extractText(from: node, into: &text)
        }
        return text
    }

    private func extractText(from node: ContentNode, into text: inout String) {
        switch node {
        case .paragraph(let runs, _), .heading(_, let runs, _):
            text += runs.map(\.text).joined()
        case .codeBlock(let code):
            text += code
        case .container(let children, _), .blockquote(let children):
            for child in children { extractText(from: child, into: &text) }
        case .list(_, let items, _):
            for item in items {
                for child in item.children { extractText(from: child, into: &text) }
            }
        default:
            break
        }
    }
}
