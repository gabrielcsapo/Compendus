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
    /// Unzip a downloaded CCD pack archive into `destination`, replacing any
    /// existing contents. The archive contains `manifest.ccd.json` plus a
    /// `resources/<handle>` tree for every referenced image.
    ///
    /// Returns the URL of the unpacked `manifest.ccd.json`.
    @discardableResult
    public static func unpack(zipData: Data, into destination: URL) throws -> URL {
        let fm = FileManager.default

        // Fresh extraction: remove any stale contents so partial/old packs don't linger.
        if fm.fileExists(atPath: destination.path) {
            try fm.removeItem(at: destination)
        }
        try fm.createDirectory(at: destination, withIntermediateDirectories: true)

        // Write the zip to a temp file, then extract via ZIPFoundation.
        let tmpZip = fm.temporaryDirectory.appendingPathComponent("ccd-pack-\(UUID().uuidString).zip")
        try zipData.write(to: tmpZip, options: .atomic)
        defer { try? fm.removeItem(at: tmpZip) }

        try fm.unzipItem(at: tmpZip, to: destination)

        return destination.appendingPathComponent("manifest.ccd.json")
    }
}
