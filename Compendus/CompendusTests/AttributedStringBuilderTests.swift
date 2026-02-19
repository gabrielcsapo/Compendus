//
//  AttributedStringBuilderTests.swift
//  CompendusTests
//
//  Tests for ContentNode → NSAttributedString conversion.
//

import XCTest
import UIKit
@testable import Compendus

final class AttributedStringBuilderTests: XCTestCase {

    private func makeBuilder(
        theme: ReaderTheme = .light,
        fontFamily: ReaderFont = .serif,
        fontSize: Double = 18,
        lineHeight: Double = 1.4
    ) -> AttributedStringBuilder {
        AttributedStringBuilder(
            theme: theme,
            fontFamily: fontFamily,
            fontSize: fontSize,
            lineHeight: lineHeight,
            contentWidth: 300
        )
    }

    // MARK: - Basic Tests

    func testEmptyNodes() {
        let builder = makeBuilder()
        let (attrString, offsetMap) = builder.build(from: [])

        XCTAssertEqual(attrString.length, 0, "Empty nodes should produce empty string")
        XCTAssertTrue(offsetMap.entries.isEmpty, "No offset entries for empty content")
    }

    func testParagraphRendering() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "Hello world")])
        ]
        let builder = makeBuilder()
        let (attrString, _) = builder.build(from: nodes)

        XCTAssertGreaterThan(attrString.length, 0)
        XCTAssertTrue(attrString.string.contains("Hello world"))
    }

    func testParagraphHasCorrectFont() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "Test")])
        ]
        let builder = makeBuilder(fontFamily: .serif, fontSize: 20)
        let (attrString, _) = builder.build(from: nodes)

        let attrs = attrString.attributes(at: 0, effectiveRange: nil)
        let font = attrs[.font] as? UIFont
        XCTAssertNotNil(font)
        XCTAssertEqual(Double(font?.pointSize ?? 0), 20, accuracy: 0.1, "Font size should match settings")
    }

    // MARK: - Headings

    func testHeadingScaling() {
        let bodyNodes: [ContentNode] = [.paragraph(runs: [TextRun(text: "Body")])]
        let h1Nodes: [ContentNode] = [.heading(level: 1, runs: [TextRun(text: "Heading")])]

        let builder = makeBuilder(fontSize: 18)
        let (bodyStr, _) = builder.build(from: bodyNodes)
        let (h1Str, _) = builder.build(from: h1Nodes)

        let bodyFont = bodyStr.attributes(at: 0, effectiveRange: nil)[.font] as? UIFont
        let h1Font = h1Str.attributes(at: 0, effectiveRange: nil)[.font] as? UIFont

        XCTAssertNotNil(bodyFont)
        XCTAssertNotNil(h1Font)
        if let bodySize = bodyFont?.pointSize, let h1Size = h1Font?.pointSize {
            XCTAssertGreaterThan(h1Size, bodySize, "H1 should be larger than body text")
        }
    }

    // MARK: - Inline Styles

    func testBoldAttributes() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "bold", styles: [.bold])])
        ]
        let builder = makeBuilder()
        let (attrString, _) = builder.build(from: nodes)

        let attrs = attrString.attributes(at: 0, effectiveRange: nil)
        let font = attrs[.font] as? UIFont
        XCTAssertNotNil(font)
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.traitBold) ?? false,
                      "Font should have bold trait")
    }

    func testItalicAttributes() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "italic", styles: [.italic])])
        ]
        let builder = makeBuilder()
        let (attrString, _) = builder.build(from: nodes)

        let attrs = attrString.attributes(at: 0, effectiveRange: nil)
        let font = attrs[.font] as? UIFont
        XCTAssertNotNil(font)
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.traitItalic) ?? false,
                      "Font should have italic trait")
    }

    // MARK: - Theme Colors

    func testLightThemeTextColor() {
        let nodes: [ContentNode] = [.paragraph(runs: [TextRun(text: "text")])]
        let builder = makeBuilder(theme: .light)
        let (attrString, _) = builder.build(from: nodes)

        let attrs = attrString.attributes(at: 0, effectiveRange: nil)
        let color = attrs[.foregroundColor] as? UIColor
        XCTAssertNotNil(color)
        // Light theme text should be dark
        var white: CGFloat = 0
        color?.getWhite(&white, alpha: nil)
        XCTAssertLessThan(white, 0.5, "Light theme text should be dark colored")
    }

    func testDarkThemeTextColor() {
        let nodes: [ContentNode] = [.paragraph(runs: [TextRun(text: "text")])]
        let builder = makeBuilder(theme: .dark)
        let (attrString, _) = builder.build(from: nodes)

        let attrs = attrString.attributes(at: 0, effectiveRange: nil)
        let color = attrs[.foregroundColor] as? UIColor
        XCTAssertNotNil(color)
        // Dark theme text should be light
        var white: CGFloat = 0
        color?.getWhite(&white, alpha: nil)
        XCTAssertGreaterThan(white, 0.5, "Dark theme text should be light colored")
    }

    // MARK: - Special Elements

    func testImageAttachment() {
        // Use a non-existent image URL — should fall back to alt text
        let nodes: [ContentNode] = [
            .image(url: URL(fileURLWithPath: "/nonexistent.png"), alt: "Alt text", width: nil, height: nil)
        ]
        let builder = makeBuilder()
        let (attrString, _) = builder.build(from: nodes)

        // Should contain alt text since image doesn't exist
        XCTAssertTrue(attrString.string.contains("Alt text"),
                      "Missing image should show alt text")
    }

    func testHorizontalRule() {
        let nodes: [ContentNode] = [.horizontalRule]
        let builder = makeBuilder()
        let (attrString, _) = builder.build(from: nodes)

        XCTAssertGreaterThan(attrString.length, 0, "Horizontal rule should produce content")
        XCTAssertTrue(attrString.string.contains("\u{2014}"), "Should contain em-dash")
    }

    // MARK: - Offset Map

    func testOffsetMapEntries() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "First")]),
            .paragraph(runs: [TextRun(text: "Second")]),
            .paragraph(runs: [TextRun(text: "Third")])
        ]
        let builder = makeBuilder()
        let (_, offsetMap) = builder.build(from: nodes)

        XCTAssertEqual(offsetMap.entries.count, 3, "Should have one entry per node")

        // Verify entries don't overlap
        for i in 0..<offsetMap.entries.count - 1 {
            let current = offsetMap.entries[i]
            let next = offsetMap.entries[i + 1]
            XCTAssertLessThanOrEqual(
                current.range.location + current.range.length,
                next.range.location,
                "Offset map entries should not overlap"
            )
        }
    }
}
