//
//  ChapterDocument.swift
//  Compendus
//
//  Groups all per-chapter render artifacts into a single value type so
//  the cache in NativeEPUBEngine stays atomically consistent — a chapter
//  is either fully built (all fields present) or absent, never partially
//  populated.
//
//  Note: Parsed ContentNode ASTs are kept in a separate `parsedChapters`
//  cache because they are settings-independent and survive theme/font
//  changes. ChapterDocument only holds the render artifacts that must
//  be rebuilt when visual settings change.
//

import UIKit

/// All render artifacts produced from a single EPUB spine item.
/// @unchecked Sendable because NSAttributedString is not formally Sendable,
/// but construction happens on one background task and consumption always
/// happens on MainActor — there is no concurrent access.
public struct ChapterDocument: @unchecked Sendable {
    /// Spine index this document was built from.
    public let spineIndex: Int
    /// Rendered attributed string for display.
    public let attributedString: NSAttributedString
    /// Page break character ranges within the attributed string.
    public let pages: [PageInfo]
    /// Maps attributed string character ranges to block indices (used for highlight application).
    public let offsetMap: OffsetMap
    /// Maps plain text character offsets to attributed string ranges (used for read-along).
    public let plainTextMap: PlainTextToAttrStringMap
    /// Video/audio attachment positions for inline media player overlays.
    public let mediaAttachments: [MediaAttachment]
    /// CSS float images with exclusion path metadata.
    public let floatingElements: [FloatingElement]
}
