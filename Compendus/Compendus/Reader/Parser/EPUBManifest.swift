//
//  EPUBManifest.swift
//  Compendus
//
//  Data models for parsed EPUB package structure.
//  An EPUB is a ZIP file containing XHTML chapters, CSS, images,
//  and an OPF manifest describing the reading order.
//

import Foundation

/// Metadata extracted from the EPUB's OPF <metadata> element
struct EPUBMetadata {
    let title: String
    let authors: [String]
    let language: String?
    let identifier: String?
}

/// A single item in the EPUB manifest (file within the EPUB)
struct ManifestItem {
    /// Unique ID within the manifest
    let id: String
    /// Relative path within the EPUB (e.g. "Text/chapter1.xhtml")
    let href: String
    /// MIME type (e.g. "application/xhtml+xml")
    let mediaType: String
    /// Properties string (e.g. "nav" for the navigation document)
    let properties: String?
}

/// An entry in the EPUB spine (reading order)
struct SpineItem {
    /// References a ManifestItem.id
    let idref: String
    /// Whether this item is part of the linear reading order
    let linear: Bool
}

/// A table-of-contents entry parsed from the nav document or NCX
struct EPUBTOCEntry {
    let title: String
    /// Path relative to the EPUB root (e.g. "OEBPS/Text/chapter1.xhtml")
    let href: String
    let children: [EPUBTOCEntry]
}

/// The fully parsed EPUB package
struct EPUBPackage {
    let metadata: EPUBMetadata
    /// All manifest items keyed by their ID
    let manifest: [String: ManifestItem]
    /// The spine (reading order)
    let spine: [SpineItem]
    /// Root directory path within the EPUB (e.g. "OEBPS" or "")
    let rootDirectoryPath: String
    /// Parsed table of contents
    let tocItems: [EPUBTOCEntry]
}
