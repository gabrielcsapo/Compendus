//
//  NativePaginationEngine.swift
//  Compendus
//
//  Calculates precise page breaks for attributed strings using TextKit 1.
//  Uses NSLayoutManager with multiple text containers so pagination matches
//  UITextView's rendering exactly — no text is lost between pages.
//

import UIKit

public struct PageInfo {
    /// Character range in the full attributed string
    public let range: NSRange
    /// Zero-based page index
    public let pageIndex: Int

    public init(range: NSRange, pageIndex: Int) {
        self.range = range
        self.pageIndex = pageIndex
    }
}

public class NativePaginationEngine {

    /// Default content insets matching the EPUB CSS padding.
    public static let defaultInsets = UIEdgeInsets(top: 24, left: 32, bottom: 24, right: 32)

    /// Responsive insets based on viewport width (phone vs tablet).
    public static func insets(for viewportWidth: CGFloat, isTwoPageMode: Bool = false) -> UIEdgeInsets {
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
    public static func paginate(
        attributedString: NSAttributedString,
        viewportSize: CGSize,
        contentInsets: UIEdgeInsets = defaultInsets
    ) -> [PageInfo] {
        // Build a TextKit 1 stack identical to what UITextView uses.
        // NSLayoutManager flows text across multiple text containers,
        // each representing one page.
        let layoutManager = NSLayoutManager()
        return paginateWith(layoutManager,
                            attributedString: attributedString,
                            viewportSize: viewportSize,
                            contentInsets: contentInsets)
    }

    /// Async variant of `paginate` that borrows a layout manager from `pool` instead of
    /// allocating a new one. Useful when paginating many chapters in parallel.
    public static func paginate(
        attributedString: NSAttributedString,
        viewportSize: CGSize,
        contentInsets: UIEdgeInsets = defaultInsets,
        pool: LayoutManagerPool
    ) async -> [PageInfo] {
        let lm = await pool.acquire()
        let pages = paginateWith(lm, attributedString: attributedString, viewportSize: viewportSize, contentInsets: contentInsets)
        await pool.release(lm)
        return pages
    }

    /// Core pagination logic shared by both the sync and pooled variants.
    private static func paginateWith(
        _ layoutManager: NSLayoutManager,
        attributedString: NSAttributedString,
        viewportSize: CGSize,
        contentInsets: UIEdgeInsets
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
        let textStorage = NSTextStorage(attributedString: attributedString)
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

            let charRange = layoutManager.characterRange(forGlyphRange: glyphRange, actualGlyphRange: nil)
            pages.append(PageInfo(range: charRange, pageIndex: pageIndex))
            pageIndex += 1

            if charRange.location + charRange.length >= length { break }
        }

        if pages.isEmpty {
            pages.append(PageInfo(range: NSRange(location: 0, length: length), pageIndex: 0))
        }

        return pages
    }

    /// Quick estimation of page count without storing full page data.
    public static func estimatePageCount(
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
