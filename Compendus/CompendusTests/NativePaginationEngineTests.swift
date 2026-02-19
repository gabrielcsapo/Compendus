//
//  NativePaginationEngineTests.swift
//  CompendusTests
//
//  Tests for Core Text-based page break calculation.
//

import XCTest
import UIKit
@testable import Compendus

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
