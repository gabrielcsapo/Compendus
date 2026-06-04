//
//  TextKit2PaginationEngine.swift
//  Compendus
//
//  TextKit 2 (NSTextLayoutManager) pagination — a drop-in alternative to
//  NativePaginationEngine.paginate that returns the same [PageInfo]. Benchmarks
//  (see docs) showed TextKit 2 paginates chapters ~2–3× faster than the TextKit 1
//  multi-container approach and scales near-linearly.
//
//  Lays the chapter out in a single full-width container (unbounded height), then
//  walks layout fragments accumulating height; a page closes when the next
//  fragment would overflow the page height. Character ranges are resolved via the
//  content manager's offset(from:to:).
//

import UIKit

@available(iOS 15.0, *)
public enum TextKit2PaginationEngine {
    public static func paginate(
        attributedString: NSAttributedString,
        viewportSize: CGSize,
        contentInsets: UIEdgeInsets = NativePaginationEngine.defaultInsets
    ) -> [PageInfo] {
        let total = attributedString.length
        guard total > 0 else { return [PageInfo(range: NSRange(location: 0, length: 0), pageIndex: 0)] }

        let contentStorage = NSTextContentStorage()
        contentStorage.attributedString = attributedString
        let layoutManager = NSTextLayoutManager()
        contentStorage.addTextLayoutManager(layoutManager)

        let width = max(1, viewportSize.width - contentInsets.left - contentInsets.right)
        let pageHeight = max(1, viewportSize.height - contentInsets.top - contentInsets.bottom)
        let container = NSTextContainer(size: CGSize(width: width, height: 0)) // 0 = unbounded
        container.lineFragmentPadding = 0
        layoutManager.textContainer = container
        layoutManager.ensureLayout(for: layoutManager.documentRange)

        let docStart = layoutManager.documentRange.location
        var pages: [PageInfo] = []
        var pageStart = docStart
        var used: CGFloat = 0

        layoutManager.enumerateTextLayoutFragments(from: docStart, options: [.ensuresLayout]) { fragment in
            let h = fragment.layoutFragmentFrame.height
            if used + h > pageHeight && used > 0 {
                let start = contentStorage.offset(from: docStart, to: pageStart)
                let end = contentStorage.offset(from: docStart, to: fragment.rangeInElement.location)
                if end > start { pages.append(PageInfo(range: NSRange(location: start, length: end - start), pageIndex: pages.count)) }
                pageStart = fragment.rangeInElement.location
                used = 0
            }
            used += h
            return true
        }

        // Final page: from pageStart to end of document.
        let start = contentStorage.offset(from: docStart, to: pageStart)
        if start < total {
            pages.append(PageInfo(range: NSRange(location: start, length: total - start), pageIndex: pages.count))
        }
        if pages.isEmpty {
            pages.append(PageInfo(range: NSRange(location: 0, length: total), pageIndex: 0))
        }
        return pages
    }
}
