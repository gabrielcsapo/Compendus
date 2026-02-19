//
//  NativePaginationEngine.swift
//  Compendus
//
//  Calculates precise page breaks for attributed strings using Core Text.
//  Uses CTFramesetter to determine how many characters fit in each page.
//

import UIKit
import CoreText

struct PageInfo {
    /// Character range in the full attributed string
    let range: NSRange
    /// Zero-based page index
    let pageIndex: Int
}

class NativePaginationEngine {

    /// Default content insets matching the EPUB CSS padding.
    static let defaultInsets = UIEdgeInsets(top: 24, left: 32, bottom: 24, right: 32)

    /// Calculate pages for the given attributed string within the viewport.
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

        let framesetter = CTFramesetterCreateWithAttributedString(attributedString)
        var pages: [PageInfo] = []
        var currentIndex = 0
        var pageIndex = 0

        while currentIndex < length {
            let remainingRange = CFRangeMake(currentIndex, length - currentIndex)

            // Create a path for this page's content area
            let path = CGPath(rect: CGRect(x: 0, y: 0, width: contentWidth, height: contentHeight), transform: nil)

            // Create a frame to find how much text fits
            let frame = CTFramesetterCreateFrame(framesetter, remainingRange, path, nil)
            let visibleRange = CTFrameGetVisibleStringRange(frame)

            // Determine how many characters fit on this page
            var charsFit = visibleRange.length
            if charsFit <= 0 {
                // Safety: advance at least 1 character to prevent infinite loop
                charsFit = 1
            }

            let pageRange = NSRange(location: currentIndex, length: charsFit)
            pages.append(PageInfo(range: pageRange, pageIndex: pageIndex))

            currentIndex += charsFit
            pageIndex += 1
        }

        // Ensure at least one page
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
