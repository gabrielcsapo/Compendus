//
//  TestHelpers.swift
//  CompendusTests
//
//  Shared test utilities for EPUB rendering pipeline tests.
//

import Foundation
@testable import Compendus

enum TestHelpers {
    /// Returns the URL for a sample EPUB file bundled in the test target.
    static func sampleEPUBURL(named name: String) -> URL? {
        Bundle(for: BundleToken.self).url(forResource: name, withExtension: nil)
            ?? Bundle(for: BundleToken.self).url(forResource: name, withExtension: "epub")
    }

    /// All sample EPUB filenames available in the test bundle.
    static var allSampleEPUBNames: [String] {
        guard let resourcePath = Bundle(for: BundleToken.self).resourcePath else { return [] }
        let contents = (try? FileManager.default.contentsOfDirectory(atPath: resourcePath)) ?? []
        return contents.filter { $0.hasSuffix(".epub") }.sorted()
    }

    /// Build minimal valid XHTML data from body content.
    static func xhtmlData(body: String) -> Data {
        let xhtml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE html>
        <html xmlns="http://www.w3.org/1999/xhtml">
        <head><title>Test</title></head>
        <body>\(body)</body>
        </html>
        """
        return Data(xhtml.utf8)
    }
}

/// Token class for locating the test bundle.
private class BundleToken {}
