//
//  NativePaginationEngine.swift
//  Compendus
//
//  Calculates precise page breaks for attributed strings using TextKit 1.
//  Uses NSLayoutManager with multiple text containers so pagination matches
//  UITextView's rendering exactly — no text is lost between pages.
//

import UIKit

struct PageInfo {
    /// Character range in the full attributed string
    let range: NSRange
    /// Zero-based page index
    let pageIndex: Int
}

class NativePaginationEngine {

    /// Default content insets matching the EPUB CSS padding.
    static let defaultInsets = UIEdgeInsets(top: 24, left: 32, bottom: 24, right: 32)

    /// Responsive insets based on viewport width (phone vs tablet).
    static func insets(for viewportWidth: CGFloat, isTwoPageMode: Bool = false) -> UIEdgeInsets {
        if isTwoPageMode {
            // Each page is already half-width; use moderate insets
            return UIEdgeInsets(top: 24, left: 24, bottom: 24, right: 24)
        }
        let horizontal: CGFloat = viewportWidth < 500 ? 20 : 40
        return UIEdgeInsets(top: 24, left: horizontal, bottom: 24, right: horizontal)
    }

    /// Calculate pages for the given attributed string within the viewport.
    ///
    /// Uses TextKit 1 (NSLayoutManager) with multiple text containers to determine
    /// page breaks. This matches UITextView's internal layout engine exactly,
    /// preventing text from being lost between pages due to Core Text vs TextKit
    /// measurement differences.
    static func paginate(
        attributedString: NSAttributedString,
        viewportSize: CGSize,
        contentInsets: UIEdgeInsets = defaultInsets
    ) -> [PageInfo] {
        let length = attributedString.length
        guard length > 0 else {
            return [PageInfo(range: NSRange(location: 0, length: 0), pageIndex: 0)]
        }

        let contentWidth = viewportSize.width - contentInsets.left - contentInsets.right
        let contentHeight = viewportSize.height - contentInsets.top - contentInsets.bottom

        guard contentWidth > 0, contentHeight > 0 else {
            return [PageInfo(range: NSRange(location: 0, length: length), pageIndex: 0)]
        }

        let containerSize = CGSize(width: contentWidth, height: contentHeight)

        // Build a TextKit 1 stack identical to what UITextView uses.
        // NSLayoutManager flows text across multiple text containers,
        // each representing one page.
        let textStorage = NSTextStorage(attributedString: attributedString)
        let layoutManager = NSLayoutManager()
        textStorage.addLayoutManager(layoutManager)

        var pages: [PageInfo] = []
        var pageIndex = 0

        while true {
            let textContainer = NSTextContainer(size: containerSize)
            textContainer.lineFragmentPadding = 0
            layoutManager.addTextContainer(textContainer)

            layoutManager.ensureLayout(for: textContainer)

            let glyphRange = layoutManager.glyphRange(for: textContainer)
            guard glyphRange.length > 0 else { break }

            let charRange = layoutManager.characterRange(
                forGlyphRange: glyphRange, actualGlyphRange: nil
            )
            pages.append(PageInfo(range: charRange, pageIndex: pageIndex))
            pageIndex += 1

            // All text consumed
            if charRange.location + charRange.length >= length { break }
        }

        if pages.isEmpty {
            pages.append(PageInfo(range: NSRange(location: 0, length: length), pageIndex: 0))
        }

        return pages
    }

    /// Quick estimation of page count without storing full page data.
    static func estimatePageCount(
        attributedString: NSAttributedString,
        viewportSize: CGSize,
        contentInsets: UIEdgeInsets = defaultInsets
    ) -> Int {
        paginate(
            attributedString: attributedString,
            viewportSize: viewportSize,
            contentInsets: contentInsets
        ).count
    }
}
