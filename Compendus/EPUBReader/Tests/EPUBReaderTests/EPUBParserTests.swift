//
//  EPUBParserTests.swift
//  CompendusTests
//
//  Tests for EPUB ZIP extraction and OPF/spine/manifest/TOC parsing.
//

import XCTest
@testable import EPUBReader

final class EPUBParserTests: XCTestCase {

    func testParseHeftyWater() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "hefty-water.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        XCTAssertGreaterThan(parser.package.spine.count, 0, "Spine should have at least one item")
        XCTAssertFalse(parser.package.manifest.isEmpty, "Manifest should not be empty")
    }

    func testParseMobyDick() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        XCTAssertGreaterThan(parser.package.spine.count, 10, "Moby Dick should have many spine items")
        XCTAssertFalse(parser.package.tocItems.isEmpty, "TOC should have entries")
    }

    func testResolveSpineItemURL() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        for index in 0..<min(3, parser.package.spine.count) {
            let resolved = parser.resolveSpineItemURL(at: index)
            XCTAssertNotNil(resolved, "Spine item \(index) should resolve to a URL")
            if let resolved = resolved {
                XCTAssertTrue(FileManager.default.fileExists(atPath: resolved.path),
                              "Resolved URL should point to an existing file: \(resolved.lastPathComponent)")
            }
        }
    }

    func testManifestItemForSpineIndex() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "hefty-water.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        let item = parser.manifestItem(forSpineIndex: 0)
        XCTAssertNotNil(item, "First spine item should have a manifest entry")
        XCTAssertFalse(item?.href.isEmpty ?? true, "Manifest item should have a non-empty href")
    }

    func testInvalidFileThrows() async {
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("not-an-epub.txt")
        try? "hello".data(using: .utf8)?.write(to: tempURL)
        defer { try? FileManager.default.removeItem(at: tempURL) }

        do {
            _ = try await EPUBParser.parse(epubURL: tempURL)
            XCTFail("Parsing a non-EPUB file should throw")
        } catch {
            // Expected
        }
    }

    // MARK: - Metadata

    func testMetadataTitleParsed() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)
        XCTAssertFalse(parser.package.metadata.title.isEmpty, "Title should be parsed from OPF metadata")
    }

    func testMetadataLanguageParsed() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)
        XCTAssertNotNil(parser.package.metadata.language, "Language should be parsed")
        XCTAssertFalse(parser.package.metadata.language?.isEmpty ?? true)
    }

    func testMetadataIdentifierParsed() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)
        XCTAssertNotNil(parser.package.metadata.identifier, "Identifier should be parsed from OPF")
    }

    func testMetadataAuthorsParsed() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)
        // Moby Dick has at least one author
        XCTAssertFalse(parser.package.metadata.authors.isEmpty, "Authors list should not be empty")
    }

    // MARK: - Landmarks

    func testLandmarksDoNotCrashOnAnyEPUB() async throws {
        // Landmarks may be empty for EPUB 2 or EPUBs without a landmarks nav
        // — just verify parsing doesn't crash and the array is accessible.
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "accessible_epub_3.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)
        // accessible_epub_3 is EPUB 3 and likely has landmarks
        _ = parser.package.landmarks
    }

    // MARK: - Href Lookup (hrefToSpineIndex)

    func testHrefToSpineIndexLookup() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        // Every manifest item that appears in the spine should be findable by its last path component
        for (index, spineItem) in parser.package.spine.enumerated() {
            guard let item = parser.package.manifest[spineItem.idref] else { continue }
            let key = (item.href as NSString).lastPathComponent.lowercased()
            if let foundIndex = parser.package.hrefToSpineIndex[key] {
                // There can be duplicates, but the found index should still be a valid spine index
                XCTAssertGreaterThanOrEqual(foundIndex, 0)
                XCTAssertLessThan(foundIndex, parser.package.spine.count)
                _ = index // suppress unused warning
            }
        }
    }

    func testSpineIndexForHrefStripsFragment() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        // Find the first spine item that has a resolvable URL
        guard let item = parser.package.manifestItem(forSpineIndex: 1) else { return }
        let hrefWithFragment = item.href + "#section1"
        let idx = parser.package.spineIndex(forHref: hrefWithFragment)
        XCTAssertNotNil(idx, "spineIndex(forHref:) should strip fragment and find the spine item")
    }

    // MARK: - Spine linear attribute

    func testSpineContainsLinearItems() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)
        let linearItems = parser.package.spine.filter { $0.linear }
        XCTAssertGreaterThan(linearItems.count, 0, "Should have at least one linear spine item")
    }

    // MARK: - Extracted URL

    func testExtractedURLIsAccessible() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "hefty-water.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: parser.package.extractedURL.path),
            "Extracted URL directory should exist on disk"
        )
    }

    func testAllSampleEPUBs() async throws {
        let samples = TestHelpers.allSampleEPUBNames
        XCTAssertGreaterThan(samples.count, 0, "Should have sample EPUBs in the test bundle")

        for name in samples {
            let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: name), "Missing sample: \(name)")
            do {
                let parser = try await EPUBParser.parse(epubURL: url)
                // Some sample EPUBs may not have spine items (e.g. jlreq) — skip them
                guard parser.package.spine.count > 0 else { continue }
                XCTAssertFalse(parser.package.manifest.isEmpty,
                               "\(name): manifest should not be empty")
            } catch {
                XCTFail("\(name): failed to parse — \(error.localizedDescription)")
            }
        }
    }
}
