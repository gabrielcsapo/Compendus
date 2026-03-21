//
//  NativePaginationEngineTests.swift
//  CompendusTests
//
//  Tests for Core Text-based page break calculation.
//

import XCTest
import UIKit
@testable import EPUBReader

final class NativePaginationEngineTests: XCTestCase {

    private let standardViewport = CGSize(width: 390, height: 844) // iPhone 15 size

    private func makeAttributedString(_ text: String, fontSize: CGFloat = 18) -> NSAttributedString {
        let font = UIFont(name: "Georgia", size: fontSize) ?? .systemFont(ofSize: fontSize)
        let style = NSMutableParagraphStyle()
        style.lineHeightMultiple = 1.4
        return NSAttributedString(string: text, attributes: [
            .font: font,
            .paragraphStyle: style
        ])
    }

    // MARK: - Basic Tests

    func testSinglePageContent() {
        let short = makeAttributedString("Hello world. A short paragraph.")
        let pages = NativePaginationEngine.paginate(
            attributedString: short,
            viewportSize: standardViewport
        )

        XCTAssertEqual(pages.count, 1, "Short text should fit on one page")
        XCTAssertEqual(pages[0].range.location, 0)
        XCTAssertEqual(pages[0].range.length, short.length)
    }

    func testMultiPageContent() {
        // Generate text long enough to span multiple pages
        let longText = String(repeating: "This is a line of text that forms a paragraph. ", count: 200)
        let attrString = makeAttributedString(longText)
        let pages = NativePaginationEngine.paginate(
            attributedString: attrString,
            viewportSize: standardViewport
        )

        XCTAssertGreaterThan(pages.count, 1, "Long text should span multiple pages")

        // Verify pages don't overlap
        for i in 0..<pages.count - 1 {
            let current = pages[i]
            let next = pages[i + 1]
            XCTAssertEqual(
                current.range.location + current.range.length,
                next.range.location,
                "Page \(i) end should equal page \(i+1) start"
            )
        }
    }

    func testPageRangesCoverEntireString() {
        let text = String(repeating: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ", count: 100)
        let attrString = makeAttributedString(text)
        let pages = NativePaginationEngine.paginate(
            attributedString: attrString,
            viewportSize: standardViewport
        )

        let totalChars = pages.reduce(0) { $0 + $1.range.length }
        XCTAssertEqual(totalChars, attrString.length,
                       "Sum of page range lengths should equal total string length")
    }

    func testEmptyString() {
        let empty = NSAttributedString(string: "")
        let pages = NativePaginationEngine.paginate(
            attributedString: empty,
            viewportSize: standardViewport
        )

        XCTAssertEqual(pages.count, 1, "Empty string should produce exactly one page")
        XCTAssertEqual(pages[0].range.length, 0)
    }

    func testZeroViewportFallback() {
        let text = makeAttributedString("Some text")
        let pages = NativePaginationEngine.paginate(
            attributedString: text,
            viewportSize: .zero
        )

        // Should not crash and should return at least one page
        XCTAssertGreaterThanOrEqual(pages.count, 1, "Should handle zero viewport gracefully")
    }

    // MARK: - Viewport Sizes

    func testSmallViewportProducesMorePages() {
        let text = String(repeating: "A line of text. ", count: 150)
        let attrString = makeAttributedString(text)
        let smallViewport = CGSize(width: 320, height: 480)
        let largeViewport = CGSize(width: 768, height: 1024)

        let smallPages = NativePaginationEngine.paginate(attributedString: attrString, viewportSize: smallViewport)
        let largePages = NativePaginationEngine.paginate(attributedString: attrString, viewportSize: largeViewport)

        XCTAssertGreaterThan(smallPages.count, largePages.count,
                             "Smaller viewport should produce more pages")
    }

    func testIPadViewportFewPages() {
        let text = String(repeating: "Word. ", count: 50)
        let attrString = makeAttributedString(text, fontSize: 18)
        let ipadViewport = CGSize(width: 768, height: 1024)
        let pages = NativePaginationEngine.paginate(attributedString: attrString, viewportSize: ipadViewport)
        XCTAssertGreaterThanOrEqual(pages.count, 1)
        // All content should be covered
        let covered = pages.reduce(0) { $0 + $1.range.length }
        XCTAssertEqual(covered, attrString.length)
    }

    // MARK: - Styled Attributed Strings

    func testLargeFontSizeProducesMorePages() {
        let text = String(repeating: "Text paragraph. ", count: 100)
        let smallFont = makeAttributedString(text, fontSize: 12)
        let largeFont = makeAttributedString(text, fontSize: 32)

        let smallPages = NativePaginationEngine.paginate(attributedString: smallFont, viewportSize: standardViewport)
        let largePages = NativePaginationEngine.paginate(attributedString: largeFont, viewportSize: standardViewport)

        XCTAssertGreaterThan(largePages.count, smallPages.count,
                             "Larger font should require more pages")
    }

    func testMixedBoldAndNormalText() {
        let mutable = NSMutableAttributedString()
        let boldFont = UIFont.boldSystemFont(ofSize: 18)
        let normalFont = UIFont.systemFont(ofSize: 18)
        for i in 0..<40 {
            let font = i.isMultiple(of: 2) ? boldFont : normalFont
            mutable.append(NSAttributedString(string: "Word\(i) ", attributes: [.font: font]))
        }
        let pages = NativePaginationEngine.paginate(attributedString: mutable, viewportSize: standardViewport)
        XCTAssertGreaterThanOrEqual(pages.count, 1)
        let covered = pages.reduce(0) { $0 + $1.range.length }
        XCTAssertEqual(covered, mutable.length, "All mixed-style content should be paginated")
    }

    func testMultipleParagraphStyles() {
        let mutable = NSMutableAttributedString()
        let font = UIFont.systemFont(ofSize: 18)
        for alignment: NSTextAlignment in [.left, .center, .right, .justified] {
            let style = NSMutableParagraphStyle()
            style.alignment = alignment
            style.lineHeightMultiple = 1.4
            let chunk = String(repeating: "Paragraph text. ", count: 20)
            mutable.append(NSAttributedString(string: chunk, attributes: [.font: font, .paragraphStyle: style]))
        }
        let pages = NativePaginationEngine.paginate(attributedString: mutable, viewportSize: standardViewport)
        XCTAssertGreaterThanOrEqual(pages.count, 1)
        let covered = pages.reduce(0) { $0 + $1.range.length }
        XCTAssertEqual(covered, mutable.length)
    }

    func testHeadingAndBodyMixedContent() {
        // Simulate a chapter with a heading then body text — as AttributedStringBuilder would produce
        let builder = AttributedStringBuilder(
            theme: .light, fontFamily: .serif, fontSize: 18, lineHeight: 1.4, contentWidth: 390
        )
        let nodes: [ContentNode] = [
            .heading(level: 1, runs: [TextRun(text: "Chapter One")]),
            .paragraph(runs: [TextRun(text: String(repeating: "Body text paragraph. ", count: 80))])
        ]
        let (attrString, _, _) = builder.build(from: nodes)
        let pages = NativePaginationEngine.paginate(attributedString: attrString, viewportSize: standardViewport)

        XCTAssertGreaterThanOrEqual(pages.count, 1)
        let covered = pages.reduce(0) { $0 + $1.range.length }
        XCTAssertEqual(covered, attrString.length, "All heading+body content should be paginated")
    }

    // MARK: - Page Ranges

    func testFirstPageStartsAtZero() {
        let attrString = makeAttributedString(String(repeating: "x", count: 1000))
        let pages = NativePaginationEngine.paginate(attributedString: attrString, viewportSize: standardViewport)
        XCTAssertEqual(pages.first?.range.location, 0, "First page must start at index 0")
    }

    func testLastPageEndsAtStringLength() {
        let text = String(repeating: "Word. ", count: 200)
        let attrString = makeAttributedString(text)
        let pages = NativePaginationEngine.paginate(attributedString: attrString, viewportSize: standardViewport)
        let last = pages.last
        XCTAssertEqual((last?.range.location ?? 0) + (last?.range.length ?? 0), attrString.length,
                       "Last page should end exactly at string length")
    }

    func testNoGapsBetweenPages() {
        let text = String(repeating: "Paragraph text. ", count: 200)
        let attrString = makeAttributedString(text)
        let pages = NativePaginationEngine.paginate(attributedString: attrString, viewportSize: standardViewport)
        for i in 1..<pages.count {
            let prev = pages[i - 1]
            let curr = pages[i]
            XCTAssertEqual(prev.range.location + prev.range.length, curr.range.location,
                           "Gap found between pages \(i-1) and \(i)")
        }
    }

    // MARK: - Page Indices

    func testPageIndicesAreSequential() {
        let text = String(repeating: "A paragraph of text. ", count: 150)
        let attrString = makeAttributedString(text)
        let pages = NativePaginationEngine.paginate(
            attributedString: attrString,
            viewportSize: standardViewport
        )

        for (i, page) in pages.enumerated() {
            XCTAssertEqual(page.pageIndex, i, "Page index should match array position")
        }
    }
}
