//
//  XHTMLContentParserTests.swift
//  CompendusTests
//
//  Tests for XHTML → ContentNode AST parsing.
//

import XCTest
@testable import Compendus

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
        if case .paragraph(let runs) = nodes.first {
            XCTAssertEqual(runs.count, 1)
            XCTAssertTrue(runs[0].text.contains("Hello world"))
        } else {
            XCTFail("Expected a paragraph node")
        }
    }

    func testHeadingLevels() {
        let nodes = parse("<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>")

        XCTAssertGreaterThanOrEqual(nodes.count, 3)

        if case .heading(let level, let runs) = nodes[0] {
            XCTAssertEqual(level, 1)
            XCTAssertTrue(runs[0].text.contains("Title"))
        } else {
            XCTFail("Expected h1 heading")
        }

        if case .heading(let level, _) = nodes[1] {
            XCTAssertEqual(level, 2)
        } else {
            XCTFail("Expected h2 heading")
        }

        if case .heading(let level, _) = nodes[2] {
            XCTAssertEqual(level, 3)
        } else {
            XCTFail("Expected h3 heading")
        }
    }

    // MARK: - Inline Styles

    func testBoldStyle() {
        let nodes = parse("<p><strong>bold text</strong></p>")

        if case .paragraph(let runs) = nodes.first {
            XCTAssertTrue(runs.contains { $0.styles.contains(.bold) },
                          "Should have a bold run")
        } else {
            XCTFail("Expected paragraph")
        }
    }

    func testItalicStyle() {
        let nodes = parse("<p><em>italic text</em></p>")

        if case .paragraph(let runs) = nodes.first {
            XCTAssertTrue(runs.contains { $0.styles.contains(.italic) },
                          "Should have an italic run")
        } else {
            XCTFail("Expected paragraph")
        }
    }

    func testCodeStyle() {
        let nodes = parse("<p><code>code text</code></p>")

        if case .paragraph(let runs) = nodes.first {
            XCTAssertTrue(runs.contains { $0.styles.contains(.code) },
                          "Should have a code-styled run")
        } else {
            XCTFail("Expected paragraph")
        }
    }

    func testNestedBoldItalic() {
        let nodes = parse("<p><strong><em>bold italic</em></strong></p>")

        if case .paragraph(let runs) = nodes.first {
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

        if case .list(let ordered, let items) = listNodes.first {
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
        case .paragraph(let runs), .heading(_, let runs):
            text += runs.map(\.text).joined()
        case .codeBlock(let code):
            text += code
        case .container(let children), .blockquote(let children):
            for child in children { extractText(from: child, into: &text) }
        case .list(_, let items):
            for item in items {
                for child in item.children { extractText(from: child, into: &text) }
            }
        default:
            break
        }
    }
}
