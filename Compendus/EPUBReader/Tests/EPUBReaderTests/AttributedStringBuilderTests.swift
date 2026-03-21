//
//  AttributedStringBuilderTests.swift
//  CompendusTests
//
//  Tests for ContentNode → NSAttributedString conversion.
//

import XCTest
import UIKit
@testable import EPUBReader

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
        let (attrString, offsetMap, _) = builder.build(from: [])

        XCTAssertEqual(attrString.length, 0, "Empty nodes should produce empty string")
        XCTAssertTrue(offsetMap.entries.isEmpty, "No offset entries for empty content")
    }

    func testParagraphRendering() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "Hello world")])
        ]
        let builder = makeBuilder()
        let (attrString, _, _) = builder.build(from: nodes)

        XCTAssertGreaterThan(attrString.length, 0)
        XCTAssertTrue(attrString.string.contains("Hello world"))
    }

    func testParagraphHasCorrectFont() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "Test")])
        ]
        let builder = makeBuilder(fontFamily: .serif, fontSize: 20)
        let (attrString, _, _) = builder.build(from: nodes)

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
        let (bodyStr, _, _) = builder.build(from: bodyNodes)
        let (h1Str, _, _) = builder.build(from: h1Nodes)

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
        let (attrString, _, _) = builder.build(from: nodes)

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
        let (attrString, _, _) = builder.build(from: nodes)

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
        let (attrString, _, _) = builder.build(from: nodes)

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
        let (attrString, _, _) = builder.build(from: nodes)

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
            .image(url: URL(fileURLWithPath: "/nonexistent.png"), alt: "Alt text", width: nil, height: nil, style: .empty)
        ]
        let builder = makeBuilder()
        let (attrString, _, _) = builder.build(from: nodes)

        // Should contain alt text since image doesn't exist
        XCTAssertTrue(attrString.string.contains("Alt text"),
                      "Missing image should show alt text")
    }

    func testHorizontalRule() {
        let nodes: [ContentNode] = [.horizontalRule]
        let builder = makeBuilder()
        let (attrString, _, _) = builder.build(from: nodes)

        XCTAssertGreaterThan(attrString.length, 0, "Horizontal rule should produce content")
        XCTAssertTrue(attrString.string.contains("\u{2014}"), "Should contain em-dash")
    }

    // MARK: - Inline Styles (additional)

    func testUnderlineAttribute() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "link", styles: [.underline])])
        ]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        let attrs = attrString.attributes(at: 0, effectiveRange: nil)
        let underline = attrs[.underlineStyle] as? Int
        XCTAssertNotNil(underline, "Underline style should be set")
        XCTAssertNotEqual(underline, 0)
    }

    func testStrikethroughAttribute() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "struck", styles: [.strikethrough])])
        ]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        let attrs = attrString.attributes(at: 0, effectiveRange: nil)
        let strike = attrs[.strikethroughStyle] as? Int
        XCTAssertNotNil(strike, "Strikethrough style should be set")
        XCTAssertNotEqual(strike, 0)
    }

    func testBoldItalicCombined() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "bolditalic", styles: [.bold, .italic])])
        ]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        let font = attrString.attributes(at: 0, effectiveRange: nil)[.font] as? UIFont
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.traitBold) ?? false)
        XCTAssertTrue(font?.fontDescriptor.symbolicTraits.contains(.traitItalic) ?? false)
    }

    func testLinkAttribute() {
        let url = URL(string: "https://example.com")!
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "click", link: url)])
        ]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        let link = attrString.attributes(at: 0, effectiveRange: nil)[.link]
        XCTAssertNotNil(link, "Link attribute should be set for runs with a URL")
    }

    // MARK: - Headings (all levels)

    func testAllHeadingLevelsScaleDescending() {
        let builder = makeBuilder(fontSize: 18)
        var sizes: [CGFloat] = []
        for level in 1...6 {
            let nodes: [ContentNode] = [.heading(level: level, runs: [TextRun(text: "H\(level)")])]
            let (str, _, _) = builder.build(from: nodes)
            let size = (str.attributes(at: 0, effectiveRange: nil)[.font] as? UIFont)?.pointSize ?? 0
            sizes.append(size)
        }
        for i in 0..<sizes.count - 1 {
            XCTAssertGreaterThanOrEqual(sizes[i], sizes[i + 1],
                "H\(i+1) (\(sizes[i])pt) should be >= H\(i+2) (\(sizes[i+1])pt)")
        }
    }

    // MARK: - Lists

    func testUnorderedListContainsBullet() {
        let item = ListItem(children: [.paragraph(runs: [TextRun(text: "item")])])
        let nodes: [ContentNode] = [.list(ordered: false, items: [item])]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        XCTAssertTrue(attrString.string.contains("item"), "List item text should be present")
        // Bullet is prepended as a Unicode character directly in the string.
        let bullets: [Character] = ["\u{2022}", "\u{25E6}", "\u{25AA}"]
        let hasBullet = attrString.string.contains { bullets.contains($0) }
        XCTAssertTrue(hasBullet, "Unordered list should contain a bullet character")
    }

    func testOrderedListContainsNumber() {
        let item = ListItem(children: [.paragraph(runs: [TextRun(text: "first")])])
        let nodes: [ContentNode] = [.list(ordered: true, items: [item])]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        XCTAssertTrue(attrString.string.contains("first"))
        // Number marker (e.g. "1.") is prepended directly into the string.
        XCTAssertTrue(attrString.string.contains("1."), "Ordered list should contain '1.' marker")
    }

    func testMultipleListItemsAreAllPresent() {
        let items = (1...3).map { i in
            ListItem(children: [.paragraph(runs: [TextRun(text: "item \(i)")])])
        }
        let nodes: [ContentNode] = [.list(ordered: false, items: items)]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        for i in 1...3 {
            XCTAssertTrue(attrString.string.contains("item \(i)"))
        }
    }

    // MARK: - Blockquote

    func testBlockquoteChildrenRendered() {
        let nodes: [ContentNode] = [
            .blockquote(children: [.paragraph(runs: [TextRun(text: "quoted text")])])
        ]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        XCTAssertTrue(attrString.string.contains("quoted text"))
    }

    // MARK: - Code Block

    func testCodeBlockText() {
        let nodes: [ContentNode] = [.codeBlock(text: "let x = 42")]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        XCTAssertTrue(attrString.string.contains("let x = 42"))
    }

    func testCodeBlockUsesMonospacedFont() {
        let nodes: [ContentNode] = [.codeBlock(text: "code")]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        let font = attrString.attributes(at: 0, effectiveRange: nil)[.font] as? UIFont
        XCTAssertNotNil(font)
        // Monospaced fonts have the "Mono" or "Courier" descriptor in their family name
        let isMonospaced = font?.fontDescriptor.symbolicTraits.contains(.traitMonoSpace) ?? false
        let nameIsMonospaced = font?.familyName.lowercased().contains("mono") ?? false
            || font?.familyName.lowercased().contains("courier") ?? false
        XCTAssertTrue(isMonospaced || nameIsMonospaced, "Code block should use a monospaced font")
    }

    // MARK: - Table

    func testTableCellsAreRendered() {
        let row = TableRow(cells: [
            TableCell(isHeader: false, runs: [TextRun(text: "col A")]),
            TableCell(isHeader: false, runs: [TextRun(text: "col B")])
        ])
        let nodes: [ContentNode] = [.table(rows: [row])]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        XCTAssertTrue(attrString.string.contains("col A"))
        XCTAssertTrue(attrString.string.contains("col B"))
    }

    func testTableHeaderCellsAreRendered() {
        let row = TableRow(cells: [
            TableCell(isHeader: true, runs: [TextRun(text: "Header")])
        ])
        let nodes: [ContentNode] = [.table(rows: [row])]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        XCTAssertTrue(attrString.string.contains("Header"))
    }

    // MARK: - Theme Variants

    func testSepiaTheme() {
        let nodes: [ContentNode] = [.paragraph(runs: [TextRun(text: "sepia")])]
        let (attrString, _, _) = makeBuilder(theme: .sepia).build(from: nodes)
        let color = attrString.attributes(at: 0, effectiveRange: nil)[.foregroundColor] as? UIColor
        XCTAssertNotNil(color)
        // Sepia theme should have a dark-ish text color (not pure white or transparent)
        var alpha: CGFloat = 0
        color?.getWhite(nil, alpha: &alpha)
        XCTAssertGreaterThan(alpha, 0, "Text color should not be transparent")
    }

    // MARK: - Font Families

    func testSansSerifFontFamily() {
        let nodes: [ContentNode] = [.paragraph(runs: [TextRun(text: "sans")])]
        let (attrString, _, _) = makeBuilder(fontFamily: .sansSerif).build(from: nodes)
        let font = attrString.attributes(at: 0, effectiveRange: nil)[.font] as? UIFont
        XCTAssertNotNil(font)
    }

    func testMonospaceFontFamily() {
        let nodes: [ContentNode] = [.paragraph(runs: [TextRun(text: "mono")])]
        let (attrString, _, _) = makeBuilder(fontFamily: .dejaVuSansMono).build(from: nodes)
        let font = attrString.attributes(at: 0, effectiveRange: nil)[.font] as? UIFont
        XCTAssertNotNil(font)
    }

    // MARK: - Multiple Paragraphs

    func testMultipleParagraphsAllRendered() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "First paragraph")]),
            .paragraph(runs: [TextRun(text: "Second paragraph")]),
            .paragraph(runs: [TextRun(text: "Third paragraph")])
        ]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        XCTAssertTrue(attrString.string.contains("First paragraph"))
        XCTAssertTrue(attrString.string.contains("Second paragraph"))
        XCTAssertTrue(attrString.string.contains("Third paragraph"))
    }

    func testMultipleParagraphsHaveNewlines() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "Para1")]),
            .paragraph(runs: [TextRun(text: "Para2")])
        ]
        let (attrString, _, _) = makeBuilder().build(from: nodes)
        XCTAssertTrue(attrString.string.contains("\n"), "Paragraphs should be separated by newlines")
    }

    // MARK: - PlainTextToAttrStringMap

    func testPlainTextMapCoversFullString() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "hello world")])
        ]
        let (attrString, _, plainTextMap) = makeBuilder().build(from: nodes)
        XCTAssertFalse(plainTextMap.entries.isEmpty, "Plain text map should not be empty")
        // Each entry's attributed string range should be within bounds
        for entry in plainTextMap.entries {
            XCTAssertLessThanOrEqual(
                entry.attrStringRange.location + entry.attrStringRange.length,
                attrString.length + 1
            )
        }
    }

    // MARK: - Offset Map

    func testOffsetMapEntries() {
        let nodes: [ContentNode] = [
            .paragraph(runs: [TextRun(text: "First")]),
            .paragraph(runs: [TextRun(text: "Second")]),
            .paragraph(runs: [TextRun(text: "Third")])
        ]
        let builder = makeBuilder()
        let (_, offsetMap, _) = builder.build(from: nodes)

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
