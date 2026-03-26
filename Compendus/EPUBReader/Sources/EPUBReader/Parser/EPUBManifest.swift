//
//  EPUBManifest.swift
//  Compendus
//
//  Data models for parsed EPUB package structure.
//  An EPUB is a ZIP file containing XHTML chapters, CSS, images,
//  and an OPF manifest describing the reading order.
//

import Foundation
import CoreGraphics

/// EPUB rendition layout mode (reflowable vs pre-paginated)
public enum RenditionLayout: String {
    case reflowable = "reflowable"
    case prePaginated = "pre-paginated"
}

/// EPUB rendition spread mode (how pages are displayed in two-page spreads)
public enum RenditionSpread: String {
    case auto = "auto"
    case landscape = "landscape"
    case portrait = "portrait"
    case both = "both"
    case none = "none"
}

/// Metadata extracted from the EPUB's OPF <metadata> element
public struct EPUBMetadata {
    public let title: String
    public let authors: [String]
    public let language: String?
    public let identifier: String?
    public var renditionLayout: RenditionLayout?
    public var renditionSpread: RenditionSpread?
    /// Viewport dimensions declared in the OPF for fixed-layout EPUBs (e.g. "width=768, height=1024").
    public var renditionViewport: CGSize?
}

/// A single item in the EPUB manifest (file within the EPUB)
public struct ManifestItem {
    /// Unique ID within the manifest
    public let id: String
    /// Relative path within the EPUB (e.g. "Text/chapter1.xhtml")
    public let href: String
    /// MIME type (e.g. "application/xhtml+xml")
    public let mediaType: String
    /// Properties string (e.g. "nav" for the navigation document)
    public let properties: String?
}

/// An entry in the EPUB spine (reading order)
public struct SpineItem {
    /// References a ManifestItem.id
    public let idref: String
    /// Whether this item is part of the linear reading order
    public let linear: Bool
    /// Declared page spread position: "left", "right", "center", or nil
    public let pageSpread: String?
}

/// A table-of-contents entry parsed from the nav document or NCX
public struct EPUBTOCEntry {
    public let title: String
    /// Path relative to the EPUB root (e.g. "OEBPS/Text/chapter1.xhtml")
    public let href: String
    public let children: [EPUBTOCEntry]
}

/// A landmark entry from the EPUB 3 nav document (epub:type="landmarks").
public struct EPUBLandmark: Sendable {
    /// The epub:type value (e.g. "bodymatter", "toc", "cover").
    public let type: String
    public let title: String
    public let href: String
}

/// The fully parsed EPUB package.
/// Conforms to Sendable — all stored properties are either value types (structs/enums)
/// or immutable references (URL). Safe to capture across actor boundaries.
public struct EPUBPackage: Sendable {
    public let metadata: EPUBMetadata
    /// All manifest items keyed by their ID.
    public let manifest: [String: ManifestItem]
    /// The spine (reading order).
    public let spine: [SpineItem]
    /// Root directory path within the EPUB (e.g. "OEBPS" or "").
    public let rootDirectoryPath: String
    /// Parsed table of contents.
    public let tocItems: [EPUBTOCEntry]
    /// Parsed landmarks from the EPUB 3 nav document.
    public let landmarks: [EPUBLandmark]
    /// Extraction directory for this EPUB (needed for runtime URL resolution).
    public let extractedURL: URL
    /// Pre-built O(1) lookup from normalised href (last-path-component, lowercased) → spine index.
    public let hrefToSpineIndex: [String: Int]

    /// Whether this EPUB uses fixed layout (pre-paginated) rendering.
    public var isFixedLayout: Bool {
        metadata.renditionLayout == .prePaginated
    }
}

// MARK: - URL Resolution Helpers

public extension EPUBPackage {
    /// Resolve a manifest item's href to an absolute file URL within the extracted EPUB.
    func resolveURL(for item: ManifestItem) -> URL {
        let path = rootDirectoryPath.isEmpty ? item.href : rootDirectoryPath + "/" + item.href
        return extractedURL.appendingPathComponent(path)
    }

    /// Resolve a spine item at the given index to an absolute file URL.
    func resolveSpineItemURL(at index: Int) -> URL? {
        guard index >= 0, index < spine.count else { return nil }
        guard let item = manifest[spine[index].idref] else { return nil }
        return resolveURL(for: item)
    }

    /// Return the manifest item for a given spine index.
    func manifestItem(forSpineIndex index: Int) -> ManifestItem? {
        guard index >= 0, index < spine.count else { return nil }
        return manifest[spine[index].idref]
    }

    /// Find the spine index for a given href using O(1) lookup.
    /// The href is normalised to last-path-component, lowercased before matching.
    func spineIndex(forHref href: String) -> Int? {
        let base = href.components(separatedBy: "#").first ?? href
        let key = (base as NSString).lastPathComponent.lowercased()
        return hrefToSpineIndex[key]
    }
}

// MARK: - Sendable Conformance for Nested Types

extension EPUBMetadata: Sendable {}
extension ManifestItem: Sendable {}
extension SpineItem: Sendable {}
extension EPUBTOCEntry: Sendable {}
extension RenditionLayout: Sendable {}
extension RenditionSpread: Sendable {}
