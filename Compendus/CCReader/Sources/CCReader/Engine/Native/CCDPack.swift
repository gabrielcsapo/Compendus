//
//  CCDPack.swift
//  CCReader
//
//  Helper for unpacking a CCD "pack" ZIP archive (manifest.ccd.json + resources/…)
//  into a stable on-device directory. The reader consumes the unpacked pack —
//  no raw .epub and no on-device EPUB parsing.
//

import Foundation
import ZIPFoundation

public enum CCDPack {
    public enum PackError: LocalizedError {
        case unsafeEntry(String)
        case archiveTooLarge
        case missingManifest
        case missingResource(String)

        public var errorDescription: String? {
            switch self {
            case .unsafeEntry(let path): return "Unsafe path in offline pack: \(path)"
            case .archiveTooLarge: return "Offline pack expands beyond its safe size limit."
            case .missingManifest: return "Offline pack is missing its manifest."
            case .missingResource(let path): return "Offline pack is missing resource: \(path)"
            }
        }
    }

    /// Unzip a downloaded CCD pack archive into `destination`, replacing any
    /// existing contents. The archive contains `manifest.ccd.json` plus a
    /// `resources/<handle>` tree for every referenced image.
    ///
    /// Returns the URL of the unpacked `manifest.ccd.json`.
    @discardableResult
    public static func unpack(zipData: Data, into destination: URL) throws -> URL {
        let fm = FileManager.default
        let tmpZip = fm.temporaryDirectory.appendingPathComponent("ccd-pack-\(UUID().uuidString).zip")
        try zipData.write(to: tmpZip, options: .atomic)
        defer { try? fm.removeItem(at: tmpZip) }
        return try install(zipURL: tmpZip, into: destination)
    }

    /// Transactionally install a pack. The previous verified directory remains
    /// available until the staged replacement has been fully extracted and checked.
    @discardableResult
    public static func install(zipURL: URL, into destination: URL) throws -> URL {
        let fm = FileManager.default
        let parent = destination.deletingLastPathComponent()
        try fm.createDirectory(at: parent, withIntermediateDirectories: true)
        let staging = parent.appendingPathComponent(".\(destination.lastPathComponent)-staging-\(UUID().uuidString)")
        let backup = parent.appendingPathComponent(".\(destination.lastPathComponent)-backup-\(UUID().uuidString)")
        defer {
            try? fm.removeItem(at: staging)
            try? fm.removeItem(at: backup)
        }

        guard let archive = Archive(url: zipURL, accessMode: .read) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let compressedSize = (try? zipURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let expandedLimit = max(Int64(compressedSize) * 6, 128 * 1024 * 1024)
        var expanded: Int64 = 0
        for entry in archive {
            let path = entry.path.replacingOccurrences(of: "\\", with: "/")
            if path.hasPrefix("/") || path.split(separator: "/").contains("..") {
                throw PackError.unsafeEntry(entry.path)
            }
            expanded += Int64(entry.uncompressedSize)
            if expanded > expandedLimit { throw PackError.archiveTooLarge }
        }

        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        try fm.unzipItem(at: zipURL, to: staging)
        try validateInstalledPack(at: staging)

        let hadExisting = fm.fileExists(atPath: destination.path)
        if hadExisting { try fm.moveItem(at: destination, to: backup) }
        do {
            try fm.moveItem(at: staging, to: destination)
            if hadExisting { try? fm.removeItem(at: backup) }
        } catch {
            if hadExisting, !fm.fileExists(atPath: destination.path) {
                try? fm.moveItem(at: backup, to: destination)
            }
            throw error
        }
        return destination.appendingPathComponent("manifest.ccd.json")
    }

    public static func validateInstalledPack(at directory: URL) throws {
        let fm = FileManager.default
        let manifest = directory.appendingPathComponent("manifest.ccd.json")
        guard fm.fileExists(atPath: manifest.path) else { throw PackError.missingManifest }
        let bundle = try CCDBundle.decode(from: Data(contentsOf: manifest))
        let resources = directory.appendingPathComponent("resources", isDirectory: true)
        for handle in resourceHandles(in: bundle) {
            let normalized = handle.replacingOccurrences(of: "\\", with: "/")
            if normalized.hasPrefix("/") || normalized.split(separator: "/").contains("..") {
                throw PackError.unsafeEntry(handle)
            }
            guard fm.fileExists(atPath: resources.appendingPathComponent(normalized).path) else {
                throw PackError.missingResource(handle)
            }
        }
    }

    private static func resourceHandles(in bundle: CCDBundle) -> Set<String> {
        var result = Set<String>()
        func visit(_ blocks: [CCDBlock]) {
            for block in blocks {
                if (block.t == "image" || block.t == "embed"), let resource = block.resource {
                    result.insert(resource)
                }
                if let children = block.children { visit(children) }
                if let items = block.listItems { items.forEach(visit) }
                if let items = block.defItems { items.forEach { visit($0.definition) } }
                if let rows = block.rows { rows.forEach { $0.cells.forEach { visit($0.blocks) } } }
                if let caption = block.caption { visit(caption) }
            }
        }
        bundle.chapters.forEach {
            visit($0.blocks)
            $0.notes?.values.forEach(visit)
        }
        return result
    }

    /// Structural validation for a locally-readable CBZ artifact.
    public static func validateCBZ(at url: URL) throws {
        guard let archive = Archive(url: url, accessMode: .read) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let imageExtensions = Set(["jpg", "jpeg", "png", "gif", "webp", "bmp"])
        var imageCount = 0
        for entry in archive where entry.type == .file {
            let path = entry.path.replacingOccurrences(of: "\\", with: "/")
            if path.hasPrefix("/") || path.split(separator: "/").contains("..") {
                throw PackError.unsafeEntry(entry.path)
            }
            if imageExtensions.contains(URL(fileURLWithPath: path).pathExtension.lowercased()) {
                imageCount += 1
            }
        }
        if imageCount == 0 { throw PackError.missingResource("comic pages") }
    }

    public static func validateEPUB(at url: URL) throws {
        guard let archive = Archive(url: url, accessMode: .read) else {
            throw CocoaError(.fileReadCorruptFile)
        }
        let names = Set(archive.map(\.path))
        guard names.contains("mimetype"), names.contains("META-INF/container.xml") else {
            throw PackError.missingResource("EPUB container metadata")
        }
    }
}
