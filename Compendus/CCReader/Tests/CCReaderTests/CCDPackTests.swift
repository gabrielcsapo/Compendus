import XCTest
@testable import CCReader

/// End-to-end on-device flow that mirrors how the reader actually opens a book:
/// a server-produced CCD pack ZIP → `CCDPack.unpack` → decode `CCDBundle` from the
/// unpacked `manifest.ccd.json` → `CCDContentMapper.nodes` with the SAME resource
/// resolver the engine uses (`resourcesRoot.appendingPathComponent(handle)`) →
/// `extractPlainText` / image nodes.
///
/// The `moby-dick.ccdpack` fixture is a real artifact of the web pipeline
/// (`buildBundleFromEpub` → `buildCcdPack`), so this guards against server↔client
/// format drift, not just our own synthetic JSON. Regenerate it with
/// `pnpm exec tsx scripts/gen-ccd-pack-fixture.mts` if the CCD format changes.
final class CCDPackTests: XCTestCase {
    // MARK: - Fixture + helpers

    /// The committed CCD pack fixture (real server output for moby-dick).
    private func packData() throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: "moby-dick", withExtension: "ccdpack", subdirectory: "Samples"),
            "moby-dick.ccdpack fixture missing from the test bundle"
        )
        return try Data(contentsOf: url)
    }

    /// Unpack the fixture into a throwaway dir and return (manifestURL, resourcesRoot),
    /// matching `DownloadedBook.ccdManifestURL` / `ccdResourcesDir`.
    private func unpackFixture() throws -> (manifest: URL, resources: URL, dir: URL) {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ccdpack-test-\(UUID().uuidString)", isDirectory: true)
        let manifest = try CCDPack.unpack(zipData: try packData(), into: dir)
        return (manifest, dir.appendingPathComponent("resources", isDirectory: true), dir)
    }

    /// The reader's resource resolver, verbatim from `NativeReaderEngine.contentNodes`.
    private func resolver(_ resourcesRoot: URL) -> (String) -> URL? {
        { resource in
            if let u = URL(string: resource), u.scheme != nil, u.scheme != "file" { return u }
            return resourcesRoot.appendingPathComponent(resource)
        }
    }

    /// Recursively collect image URLs from a ContentNode tree.
    private func imageURLs(in nodes: [ContentNode]) -> [URL] {
        var urls: [URL] = []
        for node in nodes {
            switch node {
            case let .image(url, _, _, _, _):
                urls.append(url)
            case let .container(children, _):
                urls.append(contentsOf: imageURLs(in: children))
            case let .blockquote(children):
                urls.append(contentsOf: imageURLs(in: children))
            default:
                break
            }
        }
        return urls
    }

    // MARK: - Tests

    /// The pack unpacks and decodes into a multi-chapter bundle with a manifest on disk.
    func testPackUnpacksAndDecodes() throws {
        let (manifest, _, dir) = try unpackFixture()
        defer { try? FileManager.default.removeItem(at: dir) }

        XCTAssertTrue(FileManager.default.fileExists(atPath: manifest.path), "manifest.ccd.json not written")
        let bundle = try CCDBundle.decode(from: Data(contentsOf: manifest))
        XCTAssertFalse(bundle.ccdVersion.isEmpty)
        XCTAssertGreaterThan(bundle.chapters.count, 50, "moby-dick should yield many chapters")
        XCTAssertNotNil(bundle.chapters.first { $0.spineIndex == bundle.chapters[0].spineIndex })
    }

    /// Mapping a chapter yields real prose through the full CCD → ContentNode path.
    func testPackRendersProse() throws {
        let (manifest, resources, dir) = try unpackFixture()
        defer { try? FileManager.default.removeItem(at: dir) }

        let bundle = try CCDBundle.decode(from: Data(contentsOf: manifest))
        let res = resolver(resources)
        let allText = bundle.chapters
            .map { NativeReaderEngine.extractPlainText(from: CCDContentMapper.nodes(for: $0, resolveResource: res)) }
            .joined(separator: " ")
        XCTAssertFalse(allText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, "no text rendered")
        XCTAssertTrue(
            allText.localizedCaseInsensitiveContains("whale")
                || allText.localizedCaseInsensitiveContains("Ishmael")
                || allText.localizedCaseInsensitiveContains("Ahab"),
            "expected recognizable Moby-Dick prose"
        )
    }

    /// Image blocks resolve, via the real resolver, to files that actually exist in
    /// the unpacked pack — proving resource handles + the `resources/` tree line up.
    func testPackImageResourcesResolveToExistingFiles() throws {
        let (manifest, resources, dir) = try unpackFixture()
        defer { try? FileManager.default.removeItem(at: dir) }

        let bundle = try CCDBundle.decode(from: Data(contentsOf: manifest))
        let res = resolver(resources)
        let urls = bundle.chapters.flatMap { imageURLs(in: CCDContentMapper.nodes(for: $0, resolveResource: res)) }

        XCTAssertFalse(urls.isEmpty, "moby-dick pack should contain at least one image (cover/title page)")
        for url in urls where url.isFileURL {
            XCTAssertTrue(
                FileManager.default.fileExists(atPath: url.path),
                "image handle resolved to a missing file: \(url.path)"
            )
        }
    }

    /// Fixed-layout pages and the resolver contract, on a focused synthetic bundle:
    /// an `image` block becomes an `.image` node when the handle resolves, and is
    /// DROPPED when it can't (the mapper must not emit a broken image node).
    func testFixedLayoutImageBlockMappingAndDropOnMissingResource() throws {
        let json = """
        {"ccdVersion":"1.0.4-draft","bookId":"fxl","sourceFormat":"epub","totalVirtual":1,
         "isFixedLayout":true,
         "readingOrder":[{"id":"p0","spineIndex":0,"virtualStart":0,"virtualLength":1}],
         "toc":[],
         "chapters":[{"id":"p0","spineIndex":0,"virtualStart":0,"virtualLength":1,
           "blocks":[{"t":"image","id":"0:0","resource":"OPS/images/page1.png","alt":"Page 1"}]}]}
        """
        let bundle = try CCDBundle.decode(from: Data(json.utf8))
        XCTAssertEqual(bundle.isFixedLayout, true)

        // Resolves → one image node carrying the resolved URL + alt text.
        let root = URL(fileURLWithPath: "/tmp/pack/resources", isDirectory: true)
        let resolved = CCDContentMapper.nodes(for: bundle.chapters[0]) { root.appendingPathComponent($0) }
        let urls = imageURLs(in: resolved)
        XCTAssertEqual(urls.count, 1)
        XCTAssertEqual(urls.first?.lastPathComponent, "page1.png")

        // Unresolvable handle → the image block is dropped (no node with an invalid URL).
        let dropped = CCDContentMapper.nodes(for: bundle.chapters[0]) { _ in nil }
        XCTAssertTrue(imageURLs(in: dropped).isEmpty, "unresolved image handle must not produce an image node")
    }
}
