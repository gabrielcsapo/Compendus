import XCTest
import UIKit
@testable import CCReader

/// Read-along / TTS alignment over CCD content.
///
/// The read-along highlight pipeline is: CCD chapter → `CCDContentMapper.nodes`
/// → `extractPlainText` (the text that gets sentence-split + spoken) AND
/// `AttributedStringBuilder.build` (the rendered text + a `PlainTextToAttrStringMap`).
/// To highlight the spoken sentence, the service maps a sentence's range in the
/// PLAIN text to a range in the ATTRIBUTED string via `map.attrStringRange(for:)`.
///
/// For that to land on the right words, two things must hold over CCD content:
///  1. the plain-text coordinate system the map uses (`plainTextLength`) must agree
///     with `extractPlainText` (the text the sentence ranges are computed against);
///  2. within prose (paragraphs), a plain-text range must map to the IDENTICAL
///     attributed-string substring.
///
/// These were never exercised after the EPUB→CCD migration; this locks them in.
final class ReadAlongAlignmentTests: XCTestCase {
    /// Prose-heavy chapter: a heading (decorated block) + paragraphs with inline
    /// marks. Distinctive single-occurrence words let us assert exact mapping.
    private let bundleJSON = """
    {"ccdVersion":"1.0.4-draft","bookId":"ra","sourceFormat":"epub","totalVirtual":120,
     "readingOrder":[{"id":"c0","spineIndex":0,"virtualStart":0,"virtualLength":120}],
     "toc":[],
     "chapters":[{"id":"c0","spineIndex":0,"virtualStart":0,"virtualLength":120,
       "blocks":[
         {"t":"heading","id":"0:0","level":1,"inlines":[{"t":"span","text":"Loomings"}]},
         {"t":"paragraph","id":"0:1","inlines":[
           {"t":"span","text":"Call me "},
           {"t":"span","text":"Ishmael","marks":["em"]},
           {"t":"span","text":". Some years ago, never mind how precisely."}
         ]},
         {"t":"paragraph","id":"0:2","inlines":[
           {"t":"span","text":"I thought I would sail about a little and see the watery part of the world."}
         ]}
       ]}]}
    """

    private func makeBuilder() -> AttributedStringBuilder {
        AttributedStringBuilder(theme: .light, fontFamily: .serif, fontSize: 18, lineHeight: 1.4, contentWidth: 320)
    }

    private func chapterNodes() throws -> [ContentNode] {
        let bundle = try CCDBundle.decode(from: Data(bundleJSON.utf8))
        return CCDContentMapper.nodes(for: bundle.chapters[0]) { _ in nil }
    }

    /// (1) The map's plain-text coordinate system agrees with `extractPlainText`:
    /// every entry's plain-text range lies within the extracted text, ranges are
    /// monotonic, and each entry's plain text matches the rendered substring.
    func testPlainTextMapAgreesWithExtractedPlainText() throws {
        let nodes = try chapterNodes()
        let plain = NativeReaderEngine.extractPlainText(from: nodes) as NSString
        let (attr, _, map) = makeBuilder().build(from: nodes)

        XCTAssertFalse(map.entries.isEmpty, "no alignment entries produced for CCD chapter")

        var lastEnd = 0
        for entry in map.entries {
            let pt = entry.plainTextRange
            // Plain-text ranges are within the extracted text and non-overlapping/ordered.
            XCTAssertGreaterThanOrEqual(pt.location, lastEnd, "plain-text ranges must be ordered")
            XCTAssertLessThanOrEqual(pt.location + pt.length, plain.length, "entry runs past extracted plain text")
            // The attributed range is valid.
            XCTAssertLessThanOrEqual(
                entry.attrStringRange.location + entry.attrStringRange.length,
                attr.length,
                "entry runs past attributed string"
            )
            lastEnd = pt.location + pt.length
        }
    }

    /// (2) Within prose, a plain-text word range maps to the IDENTICAL attributed
    /// substring — i.e., a spoken word highlights the correct on-screen word.
    func testProseWordRangesMapToMatchingAttributedText() throws {
        let nodes = try chapterNodes()
        let plain = NativeReaderEngine.extractPlainText(from: nodes) as NSString
        let (attr, _, map) = makeBuilder().build(from: nodes)
        let attrText = attr.string as NSString

        // Distinctive, single-occurrence prose words drawn from the paragraphs.
        for word in ["Ishmael", "watery", "precisely", "sail"] {
            let ptRange = plain.range(of: word)
            XCTAssertNotEqual(ptRange.location, NSNotFound, "‘\(word)’ missing from extracted plain text")

            guard let attrRange = map.attrStringRange(for: ptRange) else {
                XCTFail("no attributed range mapped for ‘\(word)’")
                continue
            }
            XCTAssertLessThanOrEqual(attrRange.location + attrRange.length, attrText.length)
            XCTAssertEqual(
                attrText.substring(with: attrRange),
                word,
                "plain→attr mapping landed on the wrong on-screen text for ‘\(word)’"
            )
        }
    }

    /// (3) Reverse mapping (used to scroll the page to the spoken position) returns
    /// in-bounds plain-text offsets for attributed locations.
    func testReverseMappingReturnsInBoundsOffsets() throws {
        let nodes = try chapterNodes()
        let plain = NativeReaderEngine.extractPlainText(from: nodes) as NSString
        let (attr, _, map) = makeBuilder().build(from: nodes)

        for loc in stride(from: 0, to: attr.length, by: max(1, attr.length / 8)) {
            if let pt = map.plainTextLocation(forAttrStringLocation: loc) {
                XCTAssertGreaterThanOrEqual(pt, 0)
                XCTAssertLessThanOrEqual(pt, plain.length, "reverse-mapped offset out of plain-text bounds")
            }
        }
    }
}
