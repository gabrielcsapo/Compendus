//
//  EPUBParser.swift
//  Compendus
//
//  Lightweight EPUB parser that extracts and parses EPUB files.
//
//  An EPUB file is a ZIP archive containing:
//  - META-INF/container.xml → points to the OPF file
//  - OPF file (e.g. content.opf) → metadata, manifest, spine
//  - XHTML chapter files, CSS, images, fonts
//  - Navigation document (EPUB 3) or NCX (EPUB 2) for TOC
//

import Foundation
import ZIPFoundation
import SwiftSoup

// MARK: - Errors

enum EPUBParserError: Error, LocalizedError {
    case fileNotFound
    case invalidEPUB(String)
    case parsingFailed(String)

    var errorDescription: String? {
        switch self {
        case .fileNotFound: return "EPUB file not found"
        case .invalidEPUB(let msg): return "Invalid EPUB: \(msg)"
        case .parsingFailed(let msg): return "Parsing failed: \(msg)"
        }
    }
}

// MARK: - EPUB Parser

class EPUBParser {
    /// URL of the directory where the EPUB was extracted
    let extractedURL: URL
    /// The parsed package data
    let package: EPUBPackage

    private init(extractedURL: URL, package: EPUBPackage) {
        self.extractedURL = extractedURL
        self.package = package
    }

    deinit {
        // Clean up extracted files
        try? FileManager.default.removeItem(at: extractedURL)
    }

    /// Parse an EPUB file, extracting it to a temporary directory.
    /// All heavy I/O (ZIP extraction, XML parsing) runs on a background thread.
    static func parse(epubURL: URL) async throws -> EPUBParser {
        guard FileManager.default.fileExists(atPath: epubURL.path) else {
            throw EPUBParserError.fileNotFound
        }

        // Run all heavy I/O on a background thread to guarantee we never block the main thread
        return try await Task.detached(priority: .userInitiated) {
            // 1. Create extraction directory
            let extractDir = FileManager.default.temporaryDirectory
                .appendingPathComponent("epub-\(UUID().uuidString)")
            try FileManager.default.createDirectory(at: extractDir, withIntermediateDirectories: true)

            do {
                // 2. Unzip EPUB
                try FileManager.default.unzipItem(at: epubURL, to: extractDir)

                // 3. Parse container.xml to find OPF path
                let containerURL = extractDir
                    .appendingPathComponent("META-INF")
                    .appendingPathComponent("container.xml")
                guard FileManager.default.fileExists(atPath: containerURL.path) else {
                    throw EPUBParserError.invalidEPUB("Missing META-INF/container.xml")
                }
                let containerData = try Data(contentsOf: containerURL)
                let opfPath = try parseContainerXML(containerData)

                // 4. Parse OPF file
                let opfURL = extractDir.appendingPathComponent(opfPath)
                guard FileManager.default.fileExists(atPath: opfURL.path) else {
                    throw EPUBParserError.invalidEPUB("OPF file not found at \(opfPath)")
                }
                let opfData = try Data(contentsOf: opfURL)
                let rootDir = (opfPath as NSString).deletingLastPathComponent
                let (metadata, manifest, spine) = try parseOPF(opfData)

                // 5. Parse TOC
                let tocItems = parseTOC(manifest: manifest, rootDir: rootDir, extractDir: extractDir)

                let package = EPUBPackage(
                    metadata: metadata,
                    manifest: manifest,
                    spine: spine,
                    rootDirectoryPath: rootDir,
                    tocItems: tocItems
                )

                return EPUBParser(extractedURL: extractDir, package: package)

            } catch let error as EPUBParserError {
                try? FileManager.default.removeItem(at: extractDir)
                throw error
            } catch {
                try? FileManager.default.removeItem(at: extractDir)
                throw EPUBParserError.parsingFailed(error.localizedDescription)
            }
        }.value
    }

    /// Resolve a manifest item's href to a full file URL
    func resolveURL(for item: ManifestItem) -> URL {
        let rootDir = package.rootDirectoryPath
        let path = rootDir.isEmpty ? item.href : rootDir + "/" + item.href
        return extractedURL.appendingPathComponent(path)
    }

    /// Resolve a spine item to a full file URL
    func resolveSpineItemURL(at index: Int) -> URL? {
        guard index >= 0, index < package.spine.count else { return nil }
        let spineItem = package.spine[index]
        guard let manifest = package.manifest[spineItem.idref] else { return nil }
        return resolveURL(for: manifest)
    }

    /// Get the manifest item for a spine index
    func manifestItem(forSpineIndex index: Int) -> ManifestItem? {
        guard index >= 0, index < package.spine.count else { return nil }
        return package.manifest[package.spine[index].idref]
    }
}

// MARK: - Container XML Parser (SwiftSoup)

private func parseContainerXML(_ data: Data) throws -> String {
    guard let xml = String(data: data, encoding: .utf8)
            ?? String(data: data, encoding: .isoLatin1) else {
        throw EPUBParserError.invalidEPUB("Could not decode container.xml")
    }

    do {
        let doc = try SwiftSoup.parse(xml, "", Parser.xmlParser())
        guard let rootfile = try doc.select("rootfile").first(),
              let fullPath = try? rootfile.attr("full-path"),
              !fullPath.isEmpty else {
            throw EPUBParserError.invalidEPUB("Could not find rootfile in container.xml")
        }
        return fullPath
    } catch let error as EPUBParserError {
        throw error
    } catch {
        throw EPUBParserError.invalidEPUB("Could not find rootfile in container.xml")
    }
}

// MARK: - OPF Parser (SwiftSoup)

private func parseOPF(_ data: Data) throws -> (EPUBMetadata, [String: ManifestItem], [SpineItem]) {
    guard let xml = String(data: data, encoding: .utf8)
            ?? String(data: data, encoding: .isoLatin1) else {
        throw EPUBParserError.parsingFailed("Could not decode OPF file")
    }

    do {
        let doc = try SwiftSoup.parse(xml, "", Parser.xmlParser())

        // Parse metadata
        var title = "Untitled"
        var authors: [String] = []
        var language: String?
        var identifier: String?
        var renditionLayout: RenditionLayout?
        var renditionSpread: RenditionSpread?

        if let metadataEl = try doc.select("metadata").first() {
            // Title — getElementsByTag handles namespaced tags like dc:title
            if let titleEl = try metadataEl.getElementsByTag("dc:title").first()
                ?? metadataEl.getElementsByTag("title").first() {
                let t = try titleEl.text().trimmingCharacters(in: .whitespacesAndNewlines)
                if !t.isEmpty { title = t }
            }

            // Authors — dc:creator
            let creators = try metadataEl.getElementsByTag("dc:creator")
            for creator in creators.array() {
                let name = try creator.text().trimmingCharacters(in: .whitespacesAndNewlines)
                if !name.isEmpty { authors.append(name) }
            }
            // Fallback: try plain "creator"
            if authors.isEmpty {
                for creator in try metadataEl.getElementsByTag("creator").array() {
                    let name = try creator.text().trimmingCharacters(in: .whitespacesAndNewlines)
                    if !name.isEmpty { authors.append(name) }
                }
            }

            // Language
            if let langEl = try metadataEl.getElementsByTag("dc:language").first()
                ?? metadataEl.getElementsByTag("language").first() {
                language = try langEl.text().trimmingCharacters(in: .whitespacesAndNewlines)
            }

            // Identifier
            if let idEl = try metadataEl.getElementsByTag("dc:identifier").first()
                ?? metadataEl.getElementsByTag("identifier").first() {
                identifier = try idEl.text().trimmingCharacters(in: .whitespacesAndNewlines)
            }

            // Rendition properties (EPUB 3 <meta property="..."> form)
            for meta in try metadataEl.getElementsByTag("meta").array() {
                let property = (try? meta.attr("property")) ?? ""
                let content = try meta.text().trimmingCharacters(in: .whitespacesAndNewlines)
                if property == "rendition:layout", let layout = RenditionLayout(rawValue: content) {
                    renditionLayout = layout
                } else if property == "rendition:spread", let spread = RenditionSpread(rawValue: content) {
                    renditionSpread = spread
                }
                // EPUB 2 compat: <meta name="..." content="..."> form
                let name = (try? meta.attr("name")) ?? ""
                let value = (try? meta.attr("content")) ?? ""
                if name == "rendition:layout", let layout = RenditionLayout(rawValue: value) {
                    renditionLayout = layout
                } else if name == "rendition:spread", let spread = RenditionSpread(rawValue: value) {
                    renditionSpread = spread
                }
            }
        }

        var metadata = EPUBMetadata(title: title, authors: authors,
                                     language: language, identifier: identifier)
        metadata.renditionLayout = renditionLayout
        metadata.renditionSpread = renditionSpread

        // Parse manifest
        var manifest: [String: ManifestItem] = [:]
        for item in try doc.select("manifest item").array() {
            guard let id = try? item.attr("id"), !id.isEmpty,
                  let href = try? item.attr("href"), !href.isEmpty,
                  let mediaType = try? item.attr("media-type"), !mediaType.isEmpty else {
                continue
            }
            let decodedHref = href.removingPercentEncoding ?? href
            let properties = try? item.attr("properties")
            manifest[id] = ManifestItem(
                id: id,
                href: decodedHref,
                mediaType: mediaType,
                properties: properties?.isEmpty == true ? nil : properties
            )
        }

        // Parse spine
        var spine: [SpineItem] = []
        for itemref in try doc.select("spine itemref").array() {
            guard let idref = try? itemref.attr("idref"), !idref.isEmpty else { continue }
            let linear = (try? itemref.attr("linear")) != "no"
            spine.append(SpineItem(idref: idref, linear: linear))
        }

        return (metadata, manifest, spine)
    } catch {
        throw EPUBParserError.parsingFailed("Failed to parse OPF file: \(error)")
    }
}

// MARK: - TOC Parser

private func parseTOC(manifest: [String: ManifestItem], rootDir: String, extractDir: URL) -> [EPUBTOCEntry] {
    // Try EPUB 3 navigation document first (item with properties="nav")
    if let navItem = manifest.values.first(where: { $0.properties?.contains("nav") == true }) {
        let navPath = rootDir.isEmpty ? navItem.href : rootDir + "/" + navItem.href
        let navURL = extractDir.appendingPathComponent(navPath)
        if let navData = try? Data(contentsOf: navURL) {
            let parser = NavDocumentParser(data: navData, basePath: rootDir)
            let items = parser.parse()
            if !items.isEmpty { return items }
        }
    }

    // Fall back to NCX (EPUB 2)
    if let ncxItem = manifest.values.first(where: { $0.mediaType == "application/x-dtbncx+xml" }) {
        let ncxPath = rootDir.isEmpty ? ncxItem.href : rootDir + "/" + ncxItem.href
        let ncxURL = extractDir.appendingPathComponent(ncxPath)
        if let ncxData = try? Data(contentsOf: ncxURL) {
            let parser = NCXParser(data: ncxData, basePath: rootDir)
            return parser.parse()
        }
    }

    return []
}

// MARK: - EPUB 3 Navigation Document Parser

/// Parses the EPUB 3 nav document (XHTML with <nav epub:type="toc">) using SwiftSoup
/// for HTML5 tolerance.
private class NavDocumentParser {
    private let data: Data
    private let basePath: String

    init(data: Data, basePath: String) {
        self.data = data
        self.basePath = basePath
    }

    func parse() -> [EPUBTOCEntry] {
        guard let html = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1) else {
            return []
        }

        do {
            let doc = try SwiftSoup.parse(html)

            // Find <nav epub:type="toc"> or <nav role="doc-toc">
            var tocNav: Element?
            for nav in try doc.select("nav").array() {
                let epubType = try nav.attr("epub:type")
                let role = try nav.attr("role")
                if epubType.contains("toc") || role == "doc-toc" {
                    tocNav = nav
                    break
                }
            }

            guard let nav = tocNav else { return [] }

            // Find the top-level <ol> inside the nav
            guard let rootOL = try nav.select("> ol").first()
                    ?? nav.getElementsByTag("ol").first() else {
                return []
            }

            return parseOL(rootOL)
        } catch {
            return []
        }
    }

    private func parseOL(_ ol: Element) -> [EPUBTOCEntry] {
        var entries: [EPUBTOCEntry] = []

        for li in ol.children().array() {
            guard li.tagName() == "li" else { continue }

            // Find the <a> link in this <li>
            guard let link = try? li.select("> a").first()
                    ?? li.getElementsByTag("a").first() else { continue }

            // Extract title: prefer <span class="toc-label">, else collect
            // text from children excluding description spans
            let title: String
            if let labelSpan = try? link.select("span.toc-label").first() {
                title = (try? labelSpan.text()) ?? ""
            } else {
                // Get text from all children except toc-desc spans
                var parts: [String] = []
                for node in link.getChildNodes() {
                    if let textNode = node as? TextNode {
                        let t = textNode.getWholeText().trimmingCharacters(in: .whitespacesAndNewlines)
                        if !t.isEmpty { parts.append(t) }
                    } else if let el = node as? Element {
                        let cls = (try? el.className()) ?? ""
                        if !cls.contains("toc-desc") {
                            if let t = try? el.text(), !t.isEmpty { parts.append(t) }
                        }
                    }
                }
                title = parts.joined(separator: " ")
            }

            let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmedTitle.isEmpty else { continue }

            let href = (try? link.attr("href")) ?? ""
            let resolvedHref = href.removingPercentEncoding ?? href

            // Parse nested <ol> for children
            var children: [EPUBTOCEntry] = []
            if let nestedOL = try? li.select("> ol").first() {
                children = parseOL(nestedOL)
            }

            entries.append(EPUBTOCEntry(
                title: trimmedTitle,
                href: resolvedHref,
                children: children
            ))
        }

        return entries
    }
}

// MARK: - NCX Parser (EPUB 2 fallback, SwiftSoup)

/// Parses the NCX file for EPUB 2 table of contents using SwiftSoup XML parser
private class NCXParser {
    private let data: Data
    private let basePath: String

    init(data: Data, basePath: String) {
        self.data = data
        self.basePath = basePath
    }

    func parse() -> [EPUBTOCEntry] {
        guard let xml = String(data: data, encoding: .utf8)
                ?? String(data: data, encoding: .isoLatin1) else {
            return []
        }

        do {
            let doc = try SwiftSoup.parse(xml, "", Parser.xmlParser())

            // Find the navMap element
            guard let navMap = try doc.select("navMap").first() else { return [] }

            // Parse top-level navPoints
            return parseNavPoints(in: navMap)
        } catch {
            return []
        }
    }

    private func parseNavPoints(in parent: Element) -> [EPUBTOCEntry] {
        var entries: [EPUBTOCEntry] = []

        for navPoint in parent.children().array() {
            guard navPoint.tagName().lowercased() == "navpoint" else { continue }

            // Get title from navLabel > text
            let title: String
            if let textEl = try? navPoint.select("navLabel text").first() {
                title = (try? textEl.text())?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            } else {
                title = ""
            }

            // Get href from content[@src]
            let href: String
            if let contentEl = try? navPoint.select("content").first(),
               let src = try? contentEl.attr("src"), !src.isEmpty {
                href = src.removingPercentEncoding ?? src
            } else {
                href = ""
            }

            // Parse nested navPoints for children
            let children = parseNavPoints(in: navPoint)

            entries.append(EPUBTOCEntry(title: title, href: href, children: children))
        }

        return entries
    }
}
