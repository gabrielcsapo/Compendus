import XCTest
@testable import CCReader

/// CCD render-pipeline tests. The on-device XHTML parser was removed (single CCD
/// path), so these exercise CCD JSON → decode → ContentNode mapping → plain text.
/// Guards the "empty attributed string" regression by proving the mapper preserves
/// text (headings, body, marks, nested containers) from a canonical bundle.
final class NativeReaderEngineTests: XCTestCase {
    private let sampleBundle = """
    {"ccdVersion":"1.0.1-draft","bookId":"t","sourceFormat":"epub","totalVirtual":24,
     "readingOrder":[{"id":"c0","spineIndex":0,"virtualStart":0,"virtualLength":24}],
     "toc":[],
     "chapters":[{"id":"c0","spineIndex":0,"virtualStart":0,"virtualLength":24,
       "blocks":[
         {"t":"container","id":"0:0","children":[
           {"t":"heading","id":"0:1","level":1,"inlines":[{"t":"span","text":"Chapter One"}]},
           {"t":"paragraph","id":"0:2","inlines":[
             {"t":"span","text":"Hello "},
             {"t":"span","text":"world","marks":["strong"]},
             {"t":"span","text":"."}
           ]}
         ]}
       ]}]}
    """

    func testCCDBundleDecodes() throws {
        let bundle = try CCDBundle.decode(from: Data(sampleBundle.utf8))
        XCTAssertEqual(bundle.ccdVersion, "1.0.1-draft")
        XCTAssertEqual(bundle.chapters.count, 1)
        XCTAssertEqual(bundle.chapters[0].spineIndex, 0)
        XCTAssertEqual(bundle.chapters[0].blocks.count, 1) // the container
    }

    func testCCDMapperPreservesText() throws {
        let bundle = try CCDBundle.decode(from: Data(sampleBundle.utf8))
        let nodes = CCDContentMapper.nodes(for: bundle.chapters[0]) { _ in nil }
        XCTAssertFalse(nodes.isEmpty, "mapper produced no nodes")
        let text = NativeReaderEngine.extractPlainText(from: nodes)
        XCTAssertTrue(text.contains("Chapter One"), "heading text lost — got: \(text)")
        XCTAssertTrue(text.contains("Hello world"), "body text lost — got: \(text)")
    }

    /// Chapter lookup by spineIndex must work for the value the reader navigates to.
    func testChapterLookupBySpineIndex() throws {
        let bundle = try CCDBundle.decode(from: Data(sampleBundle.utf8))
        XCTAssertNotNil(bundle.chapters.first { $0.spineIndex == 0 })
        XCTAssertNil(bundle.chapters.first { $0.spineIndex == 99 })
    }
}
