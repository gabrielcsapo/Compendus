//
//  EPUBParserTests.swift
//  CompendusTests
//
//  Tests for EPUB ZIP extraction and OPF/spine/manifest/TOC parsing.
//

import XCTest
@testable import Compendus

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

    func testAllSampleEPUBs() async throws {
        let samples = TestHelpers.allSampleEPUBNames
        XCTAssertGreaterThan(samples.count, 0, "Should have sample EPUBs in the test bundle")

        for name in samples {
            let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: name), "Missing sample: \(name)")
            do {
                let parser = try await EPUBParser.parse(epubURL: url)
                XCTAssertGreaterThan(parser.package.spine.count, 0,
                                     "\(name): spine should have at least one item")
                XCTAssertFalse(parser.package.manifest.isEmpty,
                               "\(name): manifest should not be empty")
            } catch {
                XCTFail("\(name): failed to parse — \(error.localizedDescription)")
            }
        }
    }
}
