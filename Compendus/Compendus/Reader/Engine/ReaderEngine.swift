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
struct ReaderLocation: Codable, Equatable {
    /// EPUB: chapter file path (e.g. "chapter3.xhtml"); PDF: nil
    let href: String?
    /// PDF: zero-based page index; EPUB: column index within current chapter
    let pageIndex: Int?
    /// 0.0–1.0 progression within the current chapter (EPUB) or entire book (PDF)
    let progression: Double
    /// 0.0–1.0 progression within the entire book
    let totalProgression: Double
    /// Current chapter or section name
    let title: String?
}

/// A single table-of-contents entry
struct TOCItem: Identifiable {
    let id: String
    let title: String
    let location: ReaderLocation
    let level: Int
    let children: [TOCItem]
}

/// Selection from the reader
struct ReaderSelection {
    let text: String
    /// Serialized position data for restoring the selection (format-specific JSON)
    let locationJSON: String
    /// Screen rect for toolbar positioning
    let frame: CGRect?
}

/// A search result within the book
struct ReaderSearchResult: Identifiable {
    let id = UUID()
    let location: ReaderLocation
    /// Text snippet around the match
    let snippet: String
    /// Range of the matched text within the snippet (for highlighting)
    let matchRange: Range<String.Index>
    /// Chapter title or section name
    let chapterTitle: String?
}

// MARK: - Reader Engine Protocol

@MainActor
protocol ReaderEngine: AnyObject, Observable {
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
}

// MARK: - Default Implementations

extension ReaderEngine {
    var isPDF: Bool { false }
    func search(query: String) async -> [ReaderSearchResult] { [] }
}
