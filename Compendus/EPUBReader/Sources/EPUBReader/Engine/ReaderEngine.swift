//
//  ReaderEngine.swift
//  Compendus
//
//  Protocol defining a unified reader engine interface for all book formats.
//  NativeEPUBEngine and PDFEngine conform to this protocol, enabling a single
//  UnifiedReaderView to work with any format.
//

import SwiftUI

// MARK: - Shared Types

/// Represents a position in any book format
public struct ReaderLocation: Codable, Equatable {
    /// EPUB: chapter file path (e.g. "chapter3.xhtml"); PDF: nil
    public let href: String?
    /// PDF: zero-based page index; EPUB: column index within current chapter
    public let pageIndex: Int?
    /// 0.0–1.0 progression within the current chapter (EPUB) or entire book (PDF)
    public let progression: Double
    /// 0.0–1.0 progression within the entire book
    public let totalProgression: Double
    /// Current chapter or section name
    public let title: String?

    public init(href: String?, pageIndex: Int?, progression: Double, totalProgression: Double, title: String?) {
        self.href = href
        self.pageIndex = pageIndex
        self.progression = progression
        self.totalProgression = totalProgression
        self.title = title
    }
}

/// A single table-of-contents entry
public struct TOCItem: Identifiable {
    public let id: String
    public let title: String
    public let location: ReaderLocation
    public let level: Int
    public let children: [TOCItem]

    public init(id: String, title: String, location: ReaderLocation, level: Int, children: [TOCItem]) {
        self.id = id
        self.title = title
        self.location = location
        self.level = level
        self.children = children
    }
}

/// Selection from the reader
public struct ReaderSelection {
    public let text: String
    /// Serialized position data for restoring the selection (format-specific JSON)
    public let locationJSON: String
    /// Screen rect for toolbar positioning
    public let frame: CGRect?

    public init(text: String, locationJSON: String, frame: CGRect?) {
        self.text = text
        self.locationJSON = locationJSON
        self.frame = frame
    }
}

/// A search result within the book
public struct ReaderSearchResult: Identifiable {
    public let id = UUID()
    public let location: ReaderLocation
    /// Text snippet around the match
    public let snippet: String
    /// Range of the matched text within the snippet (for highlighting)
    public let matchRange: Range<String.Index>
    /// Chapter title or section name
    public let chapterTitle: String?

    public init(location: ReaderLocation, snippet: String, matchRange: Range<String.Index>, chapterTitle: String?) {
        self.location = location
        self.snippet = snippet
        self.matchRange = matchRange
        self.chapterTitle = chapterTitle
    }
}

// MARK: - Reader Engine Protocol

@MainActor
public protocol ReaderEngine: AnyObject, Observable {
    /// Current reading location
    var currentLocation: ReaderLocation? { get }

    /// Total page/position count for display
    var totalPositions: Int { get }

    /// Whether the engine has finished loading content
    var isReady: Bool { get }

    /// Error message if loading failed
    var errorMessage: String? { get }

    /// Whether this format is PDF (used for conditional PDF-specific UI)
    var isPDF: Bool { get }

    /// Whether this format is a comic (used for conditional comic-specific UI)
    var isComic: Bool { get }

    /// The UIViewController to embed in SwiftUI
    func makeViewController() -> UIViewController

    /// Navigate forward one page/column
    func goForward() async

    /// Navigate backward one page/column
    func goBackward() async

    /// Navigate to a specific location
    func go(to location: ReaderLocation) async

    /// Navigate to a total progression value (0.0–1.0)
    func go(toProgression progression: Double) async

    /// Get the table of contents
    func tableOfContents() async -> [TOCItem]

    /// Called when the user selects or deselects text
    var onSelectionChanged: ((ReaderSelection?) -> Void)? { get set }

    /// Called when the user taps an existing highlight
    var onHighlightTapped: ((String) -> Void)? { get set }

    /// Apply highlight decorations to the current view
    func applyHighlights(_ highlights: [BookHighlight])

    /// Clear the current text selection
    func clearSelection()

    /// Apply reader settings (theme, font, size, line height)
    func applySettings(_ settings: ReaderSettings)

    /// Serialize the current location for persistence
    func serializeLocation() -> String?

    /// Search for text in the book, returning matching locations with snippets
    func search(query: String) async -> [ReaderSearchResult]

    /// Render a page at the given offset from the current position to a UIImage.
    /// offset: -1 = previous page, 0 = current, +1 = next, etc.
    /// The engine renders at its own viewport size for pixel-accurate results.
    func snapshotPage(at offset: Int) -> UIImage?
}

// MARK: - Default Implementations

public extension ReaderEngine {
    var isPDF: Bool { false }
    var isComic: Bool { false }
    func search(query: String) async -> [ReaderSearchResult] { [] }
    func snapshotPage(at offset: Int) -> UIImage? { nil }
}
