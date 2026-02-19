//
//  EPUBParser.swift
//  Compendus
//
//  Lightweight EPUB parser that extracts and parses EPUB files.
//  Replaces Readium's ReadiumShared + ReadiumStreamer packages.
//
//  An EPUB file is a ZIP archive containing:
//  - META-INF/container.xml → points to the OPF file
//  - OPF file (e.g. content.opf) → metadata, manifest, spine
//  - XHTML chapter files, CSS, images, fonts
//  - Navigation document (EPUB 3) or NCX (EPUB 2) for TOC
//

import Foundation
import ZIPFoundation

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

    /// Parse an EPUB file, extracting it to a temporary directory
    static func parse(epubURL: URL) async throws -> EPUBParser {
        guard FileManager.default.fileExists(atPath: epubURL.path) else {
            throw EPUBParserError.fileNotFound
        }

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

// MARK: - Container XML Parser

private func parseContainerXML(_ data: Data) throws -> String {
    let parser = ContainerXMLParser(data: data)
    guard let opfPath = parser.parse() else {
        throw EPUBParserError.invalidEPUB("Could not find rootfile in container.xml")
    }
    return opfPath
}

private class ContainerXMLParser: NSObject, XMLParserDelegate {
    private let data: Data
    private var opfPath: String?

    init(data: Data) {
        self.data = data
    }

    func parse() -> String? {
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.parse()
        return opfPath
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String] = [:]) {
        if elementName == "rootfile" || qName?.hasSuffix(":rootfile") == true
            || elementName.hasSuffix("rootfile") {
            if let path = attributeDict["full-path"] {
                opfPath = path
            }
        }
    }
}

// MARK: - OPF Parser

private func parseOPF(_ data: Data) throws -> (EPUBMetadata, [String: ManifestItem], [SpineItem]) {
    let parser = OPFParser(data: data)
    guard parser.parse() else {
        throw EPUBParserError.parsingFailed("Failed to parse OPF file")
    }
    return (parser.metadata, parser.manifest, parser.spine)
}

private class OPFParser: NSObject, XMLParserDelegate {
    private let data: Data

    var metadata = EPUBMetadata(title: "Untitled", authors: [], language: nil, identifier: nil)
    var manifest: [String: ManifestItem] = [:]
    var spine: [SpineItem] = []

    // Parsing state
    private var currentElement = ""
    private var currentText = ""
    private var inMetadata = false
    private var titleText: String?
    private var authors: [String] = []
    private var language: String?
    private var identifier: String?

    init(data: Data) {
        self.data = data
    }

    func parse() -> Bool {
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.shouldProcessNamespaces = false
        let result = parser.parse()
        metadata = EPUBMetadata(
            title: titleText ?? "Untitled",
            authors: authors,
            language: language,
            identifier: identifier
        )
        return result
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String] = [:]) {
        let localName = elementName.components(separatedBy: ":").last ?? elementName
        currentElement = localName
        currentText = ""

        switch localName {
        case "metadata":
            inMetadata = true

        case "item":
            // Manifest item
            if let id = attributeDict["id"],
               let href = attributeDict["href"],
               let mediaType = attributeDict["media-type"] {
                let decodedHref = href.removingPercentEncoding ?? href
                let item = ManifestItem(
                    id: id,
                    href: decodedHref,
                    mediaType: mediaType,
                    properties: attributeDict["properties"]
                )
                manifest[id] = item
            }

        case "itemref":
            // Spine item
            if let idref = attributeDict["idref"] {
                let linear = attributeDict["linear"] != "no"
                spine.append(SpineItem(idref: idref, linear: linear))
            }

        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        currentText += string
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        let localName = elementName.components(separatedBy: ":").last ?? elementName
        let text = currentText.trimmingCharacters(in: .whitespacesAndNewlines)

        if inMetadata && !text.isEmpty {
            switch localName {
            case "title":
                titleText = text
            case "creator":
                authors.append(text)
            case "language":
                language = text
            case "identifier":
                identifier = text
            default:
                break
            }
        }

        if localName == "metadata" {
            inMetadata = false
        }
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

/// Parses the EPUB 3 nav document (XHTML with <nav epub:type="toc">)
private class NavDocumentParser: NSObject, XMLParserDelegate {
    private let data: Data
    private let basePath: String

    private var items: [EPUBTOCEntry] = []
    private var itemStack: [[EPUBTOCEntry]] = [[]]
    private var inTocNav = false
    private var inLink = false
    private var currentHref = ""
    private var currentTitle = ""
    private var elementStack: [String] = []
    private var depth = 0

    init(data: Data, basePath: String) {
        self.data = data
        self.basePath = basePath
    }

    func parse() -> [EPUBTOCEntry] {
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.shouldProcessNamespaces = false
        parser.parse()
        return itemStack.first ?? []
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String] = [:]) {
        let localName = elementName.components(separatedBy: ":").last ?? elementName
        elementStack.append(localName)

        if localName == "nav" {
            // Check for epub:type="toc" (may appear as type, epub:type, etc.)
            let typeAttr = attributeDict["epub:type"] ?? attributeDict["type"] ?? ""
            if typeAttr.contains("toc") {
                inTocNav = true
            }
        }

        guard inTocNav else { return }

        if localName == "a" {
            inLink = true
            currentTitle = ""
            currentHref = attributeDict["href"] ?? ""
        } else if localName == "ol" {
            depth += 1
            itemStack.append([])
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if inTocNav && inLink {
            currentTitle += string
        }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        let localName = elementName.components(separatedBy: ":").last ?? elementName

        if localName == "nav" && inTocNav {
            inTocNav = false
        }

        guard inTocNav || localName == "nav" else {
            elementStack.removeLast()
            return
        }

        if localName == "a" && inLink {
            inLink = false
        } else if localName == "li" {
            let title = currentTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            if !title.isEmpty {
                // Resolve href relative to the nav document's directory
                let resolvedHref = currentHref.removingPercentEncoding ?? currentHref
                let children = itemStack.count > 1 ? itemStack.removeLast() : []
                if itemStack.isEmpty { itemStack.append([]) }
                let entry = EPUBTOCEntry(title: title, href: resolvedHref, children: children)
                itemStack[itemStack.count - 1].append(entry)
            }
            currentTitle = ""
            currentHref = ""
        } else if localName == "ol" {
            depth -= 1
            if depth < 0 { depth = 0 }
            // Children are gathered when the parent <li> closes
        }

        elementStack.removeLast()
    }
}

// MARK: - NCX Parser (EPUB 2 fallback)

/// Parses the NCX file for EPUB 2 table of contents
private class NCXParser: NSObject, XMLParserDelegate {
    private let data: Data
    private let basePath: String

    private var items: [EPUBTOCEntry] = []
    private var itemStack: [[EPUBTOCEntry]] = [[]]
    private var currentTitle = ""
    private var currentHref = ""
    private var inNavPoint = false
    private var inText = false
    private var currentElement = ""

    init(data: Data, basePath: String) {
        self.data = data
        self.basePath = basePath
    }

    func parse() -> [EPUBTOCEntry] {
        let parser = XMLParser(data: data)
        parser.delegate = self
        parser.parse()
        return itemStack.first ?? []
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?,
                attributes attributeDict: [String: String] = [:]) {
        let localName = elementName.components(separatedBy: ":").last ?? elementName
        currentElement = localName

        switch localName {
        case "navPoint":
            inNavPoint = true
            currentTitle = ""
            currentHref = ""
            itemStack.append([])

        case "text":
            if inNavPoint { inText = true }

        case "content":
            if inNavPoint {
                currentHref = attributeDict["src"] ?? ""
            }

        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if inText {
            currentTitle += string
        }
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String,
                namespaceURI: String?, qualifiedName qName: String?) {
        let localName = elementName.components(separatedBy: ":").last ?? elementName

        switch localName {
        case "text":
            inText = false

        case "navPoint":
            let title = currentTitle.trimmingCharacters(in: .whitespacesAndNewlines)
            let href = currentHref.removingPercentEncoding ?? currentHref
            let children = itemStack.removeLast()
            if itemStack.isEmpty { itemStack.append([]) }
            let entry = EPUBTOCEntry(title: title, href: href, children: children)
            itemStack[itemStack.count - 1].append(entry)
            inNavPoint = !itemStack.isEmpty && itemStack.count > 1
            currentTitle = ""
            currentHref = ""

        default:
            break
        }
    }
}
