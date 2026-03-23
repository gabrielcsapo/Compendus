//
//  NativeEPUBEngineTests.swift
//  CompendusTests
//
//  Integration tests loading real sample EPUBs through the full native pipeline.
//

import XCTest
@testable import EPUBReader

@MainActor
final class NativeEPUBEngineTests: XCTestCase {

    /// Helper: parse an EPUB, build attributed string for first chapter, paginate it.
    /// Returns (parser, nodes, attributedString, pages).
    private func loadChapterPipeline(named name: String, spineIndex: Int = 0) async throws -> (
        parser: EPUBParser,
        nodes: [ContentNode],
        attributedString: NSAttributedString,
        pages: [PageInfo]
    ) {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: name))
        let parser = try await EPUBParser.parse(epubURL: url)

        let chapterURL = try XCTUnwrap(parser.resolveSpineItemURL(at: spineIndex))
        let data = try Data(contentsOf: chapterURL)
        let baseURL = chapterURL.deletingLastPathComponent()

        let contentParser = XHTMLContentParser(data: data, baseURL: baseURL)
        let nodes = contentParser.parse()

        let settings = ReaderSettings()
        let contentWidth: CGFloat = 326 // 390 - 32*2 insets
        let builder = AttributedStringBuilder(settings: settings, contentWidth: contentWidth)
        let (attrString, _, _) = builder.build(from: nodes)

        let viewport = CGSize(width: 390, height: 844)
        let pages = NativePaginationEngine.paginate(
            attributedString: attrString,
            viewportSize: viewport
        )

        return (parser, nodes, attrString, pages)
    }

    // MARK: - Pipeline Tests

    func testHeftyWaterPipeline() async throws {
        let (parser, nodes, attrString, pages) = try await loadChapterPipeline(named: "hefty-water.epub")

        XCTAssertGreaterThan(parser.package.spine.count, 0)
        XCTAssertGreaterThan(nodes.count, 0, "Should have content nodes")
        XCTAssertGreaterThan(attrString.length, 0, "Should produce attributed string")
        XCTAssertGreaterThan(pages.count, 0, "Should have at least one page")
    }

    func testMobyDickPipeline() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        // Find a content chapter (not cover/title)
        let chapterIndex = min(3, parser.package.spine.count - 1)
        let (_, nodes, attrString, pages) = try await loadChapterPipeline(
            named: "moby-dick.epub",
            spineIndex: chapterIndex
        )

        XCTAssertGreaterThan(nodes.count, 0, "Content chapter should have nodes")
        XCTAssertGreaterThan(attrString.length, 0, "Should produce attributed string")
        XCTAssertGreaterThanOrEqual(pages.count, 1, "Should have pages")
    }

    // MARK: - Search Tests

    func testSearchFindsText() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let engine = NativeEPUBEngine(bookURL: url)
        await engine.load()

        let results = await engine.search(query: "whale")
        XCTAssertGreaterThan(results.count, 0, "Should find 'whale' in Moby Dick")

        // Verify results have valid data
        for result in results.prefix(5) {
            XCTAssertFalse(result.snippet.isEmpty, "Snippet should not be empty")
            XCTAssertNotNil(result.location.href, "Result should have an href")
        }
    }

    func testSearchCaseInsensitive() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let engine = NativeEPUBEngine(bookURL: url)
        await engine.load()

        let lower = await engine.search(query: "whale")
        let upper = await engine.search(query: "WHALE")

        // Both should find results (case insensitive)
        XCTAssertGreaterThan(lower.count, 0)
        XCTAssertGreaterThan(upper.count, 0)
        // They should find the same number of matches
        XCTAssertEqual(lower.count, upper.count,
                       "Case-insensitive search should find same results")
    }

    func testSearchEmptyQuery() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let engine = NativeEPUBEngine(bookURL: url)
        await engine.load()

        let results = await engine.search(query: "")
        XCTAssertTrue(results.isEmpty, "Empty query should return no results")
    }

    func testSearchNoResults() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "hefty-water.epub"))
        let engine = NativeEPUBEngine(bookURL: url)
        await engine.load()

        let results = await engine.search(query: "xyznonexistentterm123")
        XCTAssertTrue(results.isEmpty, "Nonsense query should return no results")
    }

    // MARK: - Table of Contents

    func testTableOfContents() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "moby-dick.epub"))
        let engine = NativeEPUBEngine(bookURL: url)
        await engine.load()

        let toc = await engine.tableOfContents()
        XCTAssertGreaterThan(toc.count, 0, "Moby Dick should have TOC entries")

        for item in toc.prefix(5) {
            XCTAssertFalse(item.title.isEmpty, "TOC item should have a title")
        }
    }

    // MARK: - CSS Pipeline Tests

    /// Helper: load CSS stylesheets from an EPUB parser, same as NativeEPUBEngine does.
    private func loadStylesheets(from parser: EPUBParser) -> CSSStylesheet {
        var combined = CSSStylesheet()
        for (_, item) in parser.package.manifest {
            guard item.mediaType == "text/css" else { continue }
            let cssURL = parser.resolveURL(for: item)
            guard let cssData = try? Data(contentsOf: cssURL),
                  let cssText = String(data: cssData, encoding: .utf8) else { continue }
            let parsed = CSSParser.parse(cssText)
            combined.merge(with: parsed)
        }
        return combined
    }

    func testAccessibleEPUB3WithCSS() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "accessible_epub_3.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        // Load CSS the same way NativeEPUBEngine does
        let stylesheet = loadStylesheets(from: parser)

        // Test the chapter 1 content (index may vary, find a content chapter)
        for spineIndex in 0..<min(5, parser.package.spine.count) {
            guard let chapterURL = parser.resolveSpineItemURL(at: spineIndex),
                  let data = try? Data(contentsOf: chapterURL) else { continue }

            let baseURL = chapterURL.deletingLastPathComponent()

            // Parse WITHOUT CSS (baseline)
            let parserNoCSS = XHTMLContentParser(data: data, baseURL: baseURL)
            let nodesNoCSS = parserNoCSS.parse()

            // Parse WITH CSS (the new code path)
            let parserWithCSS = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet)
            let nodesWithCSS = parserWithCSS.parse()

            let settings = ReaderSettings()
            let contentWidth: CGFloat = 326

            // Build WITHOUT CSS
            let builderNoCSS = AttributedStringBuilder(settings: settings, contentWidth: contentWidth)
            let (attrNoCSS, _, _) = builderNoCSS.build(from: nodesNoCSS)

            // Build WITH CSS
            let builderWithCSS = AttributedStringBuilder(settings: settings, contentWidth: contentWidth)
            let (attrWithCSS, _, _) = builderWithCSS.build(from: nodesWithCSS)

            let spineItem = parser.package.spine[spineIndex]
            let href = parser.package.manifest[spineItem.idref]?.href ?? "unknown"

            XCTAssertGreaterThan(nodesNoCSS.count, 0,
                "\(href): should have nodes without CSS")
            XCTAssertGreaterThan(nodesWithCSS.count, 0,
                "\(href): should have nodes with CSS")
            XCTAssertGreaterThan(attrNoCSS.length, 0,
                "\(href): should produce content without CSS")
            XCTAssertGreaterThan(attrWithCSS.length, 0,
                "\(href): should produce content WITH CSS (regression!)")

            // The CSS version shouldn't produce dramatically less content
            if attrNoCSS.length > 10 {
                let ratio = Double(attrWithCSS.length) / Double(attrNoCSS.length)
                XCTAssertGreaterThan(ratio, 0.5,
                    "\(href): CSS version has \(attrWithCSS.length) chars vs \(attrNoCSS.length) without CSS — too much content lost")
            }
        }
    }

    func testCSSDoesNotSetDisplayNoneOnCommonElements() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "accessible_epub_3.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)
        let stylesheet = loadStylesheets(from: parser)

        // Check that common elements don't resolve to display: none
        let commonElements = ["p", "h1", "h2", "h3", "section", "div", "body", "nav", "ol", "ul", "li"]
        for element in commonElements {
            let props = stylesheet.resolve(element: element, classes: [])
            XCTAssertNotEqual(props.display, CSSDisplay.none,
                "Element '\(element)' should NOT have display: none")
        }

        // Check common classes too
        let commonClasses = [["chapter"], ["title"], ["sect1"], ["preface"], ["itemizedlist"], ["listitem"]]
        for classes in commonClasses {
            let propsSection = stylesheet.resolve(element: "section", classes: classes)
            XCTAssertNotEqual(propsSection.display, CSSDisplay.none,
                "section.\(classes.joined(separator: ".")) should NOT have display: none")
            let propsDiv = stylesheet.resolve(element: "div", classes: classes)
            XCTAssertNotEqual(propsDiv.display, CSSDisplay.none,
                "div.\(classes.joined(separator: ".")) should NOT have display: none")
        }
    }

    // MARK: - Full-Spine Pipeline (all samples × all chapters)

    /// Runs the complete pipeline — CSS load, XHTML parse, attributed string build, paginate —
    /// on every spine item of every sample EPUB. Collects all failures and reports them together.
    func testAllSamplesFullSpinePipeline() async throws {
        let samples = TestHelpers.allSampleEPUBNames
        XCTAssertGreaterThan(samples.count, 0, "Should have sample EPUBs")

        struct Failure {
            let book: String
            let spineIndex: Int
            let reason: String
        }
        var failures: [Failure] = []

        let settings = ReaderSettings()
        let contentWidth: CGFloat = 326
        let viewport = CGSize(width: 390, height: 844)

        for name in samples {
            guard let url = TestHelpers.sampleEPUBURL(named: name) else {
                failures.append(Failure(book: name, spineIndex: -1, reason: "sample URL not found"))
                continue
            }

            let parser: EPUBParser
            do {
                parser = try await EPUBParser.parse(epubURL: url)
            } catch {
                failures.append(Failure(book: name, spineIndex: -1, reason: "parse failed: \(error.localizedDescription)"))
                continue
            }

            guard parser.package.spine.count > 0 else { continue }

            let stylesheet = loadStylesheets(from: parser)

            for spineIndex in 0..<parser.package.spine.count {
                // Skip non-XHTML spine items (images, SVG-in-spine, etc.)
                if let item = parser.package.manifestItem(forSpineIndex: spineIndex) {
                    let mt = item.mediaType.lowercased()
                    guard mt.contains("xhtml") || mt.contains("html") else { continue }
                }

                guard let chapterURL = parser.resolveSpineItemURL(at: spineIndex),
                      let data = try? Data(contentsOf: chapterURL) else {
                    failures.append(Failure(book: name, spineIndex: spineIndex, reason: "could not read chapter file"))
                    continue
                }

                let baseURL = chapterURL.deletingLastPathComponent()
                let nodes = XHTMLContentParser(data: data, baseURL: baseURL, stylesheet: stylesheet).parse()

                let builder = AttributedStringBuilder(settings: settings, contentWidth: contentWidth)
                let (attrString, offsetMap, _) = builder.build(from: nodes)

                let pages = NativePaginationEngine.paginate(attributedString: attrString, viewportSize: viewport)

                if pages.isEmpty {
                    failures.append(Failure(book: name, spineIndex: spineIndex, reason: "produced zero pages"))
                    continue
                }

                // Page ranges must be contiguous and cover the full string
                var cursor = 0
                for (i, page) in pages.enumerated() {
                    if page.range.location != cursor {
                        failures.append(Failure(book: name, spineIndex: spineIndex,
                            reason: "gap before page \(i): expected loc \(cursor), got \(page.range.location)"))
                        break
                    }
                    cursor += page.range.length
                }
                if cursor != attrString.length {
                    failures.append(Failure(book: name, spineIndex: spineIndex,
                        reason: "pages cover \(cursor) chars but attributed string has \(attrString.length)"))
                }

                // Offset map entries must not exceed string bounds
                for entry in offsetMap.entries {
                    let end = entry.range.location + entry.range.length
                    if end > attrString.length {
                        failures.append(Failure(book: name, spineIndex: spineIndex,
                            reason: "offsetMap entry out of bounds: \(entry.range) > length \(attrString.length)"))
                        break
                    }
                }
            }
        }

        XCTAssertTrue(failures.isEmpty,
            "Pipeline failures across \(samples.count) EPUBs:\n" +
            failures.map { "  \($0.book) spine[\($0.spineIndex)]: \($0.reason)" }.joined(separator: "\n"))
    }

    // MARK: - FXL SVG Rendering Tests

    /// For each spine item in sous-le-vent.epub, verify that SVG extraction succeeds
    /// and the rendered image fits within the expected viewport without clipping.
    func testSousLeVentSVGRenderingAllPages() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "sous-le-vent.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        let viewport = CGSize(width: 390, height: 844)
        var failures: [(spine: Int, href: String, reason: String)] = []

        for spineIndex in 0..<parser.package.spine.count {
            let manifestItem = parser.package.manifestItem(forSpineIndex: spineIndex)
            guard let href = manifestItem?.href else { continue }

            // Only test pages declared as SVG content
            let isSVG = manifestItem?.properties?.contains("svg") == true
                     || manifestItem?.mediaType == "image/svg+xml"
            guard isSVG else { continue }

            guard let chapterURL = parser.resolveSpineItemURL(at: spineIndex),
                  let data = try? Data(contentsOf: chapterURL),
                  let html = String(data: data, encoding: .utf8) else {
                failures.append((spineIndex, href, "Could not load file"))
                continue
            }

            // Extract SVG (same logic as NativeEPUBEngine.extractAndRenderSVG)
            guard let svgStart = html.range(of: "<svg", options: .caseInsensitive),
                  let svgEnd   = html.range(of: "</svg>", options: [.caseInsensitive, .backwards]),
                  svgEnd.lowerBound > svgStart.lowerBound else {
                failures.append((spineIndex, href, "No <svg>...</svg> found in file"))
                continue
            }
            let svgString = String(html[svgStart.lowerBound..<svgEnd.upperBound])

            // Parse the SVG and check canvas size
            guard let doc = SVGDocument(Data(svgString.utf8)) else {
                failures.append((spineIndex, href, "SVGDocument init failed (nil)"))
                continue
            }

            let canvas = doc.canvasSize
            if canvas == .zero || canvas.width <= 0 || canvas.height <= 0 {
                failures.append((spineIndex, href, "SVGDocument canvasSize is \(canvas)"))
                continue
            }

            // Render and verify the image is the correct size
            guard let image = doc.image(size: viewport) else {
                failures.append((spineIndex, href,
                    "image(size:) returned nil (canvas=\(canvas))"))
                continue
            }

            // The rendered image should exactly match the requested viewport
            let imgSize = image.size
            if imgSize != viewport {
                failures.append((spineIndex, href,
                    "image size \(imgSize) ≠ viewport \(viewport) (canvas=\(canvas))"))
            }

            // Verify scale produces no overflow: scaled content must fit in viewport
            let scale = min(viewport.width / canvas.width, viewport.height / canvas.height)
            let scaledW = canvas.width * scale
            let scaledH = canvas.height * scale
            if scaledW > viewport.width + 1 || scaledH > viewport.height + 1 {
                failures.append((spineIndex, href,
                    "Scaled content \(scaledW)×\(scaledH) overflows viewport \(viewport) " +
                    "(canvas=\(canvas), scale=\(scale))"))
            }
        }

        if !failures.isEmpty {
            let detail = failures.map { "  spine[\($0.spine)] \($0.href): \($0.reason)" }
                                  .joined(separator: "\n")
            XCTFail("SVG rendering issues in sous-le-vent:\n\(detail)")
        }
    }

    /// Full pipeline diagnostic: for each sous-le-vent page, verify SVG detection,
    /// full extractAndRenderSVG (including image inlining), and what XHTML parsing
    /// would produce if SVG detection incorrectly falls through.
    ///
    /// This test replicates the exact logic inside loadFXLChapter so any discrepancy
    /// between the test and the running app is immediately visible.
    func testSousLeVentFullPipelineDiagnostic() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "sous-le-vent.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)
        let viewport = CGSize(width: 390, height: 844)

        struct PageResult {
            let spineIndex: Int
            let href: String
            let isSVGDetected: Bool
            let svgRenderResult: String  // "ok", "nil-image", "svg-not-found", "svg-doc-nil"
            let xhtmlNodeCount: Int
            let xhtmlTextPreview: String
        }

        var results: [PageResult] = []
        var svgFailures: [(Int, String, String)] = []

        for spineIndex in 0..<parser.package.spine.count {
            let manifestItem = parser.package.manifestItem(forSpineIndex: spineIndex)
            let href = manifestItem?.href ?? "(nil)"

            // Replicate isSVGSpineItem check from loadFXLChapter
            let isSVG = manifestItem?.properties?.contains("svg") == true
                     || manifestItem?.mediaType == "image/svg+xml"

            // Always test full extractAndRenderSVG path (includes inlineImageHrefs)
            guard let chapterURL = parser.resolveSpineItemURL(at: spineIndex) else {
                results.append(PageResult(spineIndex: spineIndex, href: href,
                    isSVGDetected: isSVG, svgRenderResult: "url-nil",
                    xhtmlNodeCount: 0, xhtmlTextPreview: ""))
                continue
            }

            // Test SVG rendering via full engine path
            let svgImage = await NativeEPUBEngine.extractAndRenderSVG(from: chapterURL, size: viewport)
            let svgResult: String
            if let img = svgImage {
                svgResult = "ok(\(Int(img.size.width))×\(Int(img.size.height)))"
            } else {
                // Dig into why it failed
                if let data = try? Data(contentsOf: chapterURL),
                   let html = String(data: data, encoding: .utf8) {
                    if let svgStart = html.range(of: "<svg", options: .caseInsensitive),
                       let svgEnd = html.range(of: "</svg>", options: [.caseInsensitive, .backwards]),
                       svgEnd.lowerBound > svgStart.lowerBound {
                        let svgString = String(html[svgStart.lowerBound..<svgEnd.upperBound])
                        if SVGDocument(Data(svgString.utf8)) != nil {
                            svgResult = "nil-image(doc-ok)"
                        } else {
                            svgResult = "nil-image(doc-nil)"
                        }
                    } else {
                        svgResult = "svg-tag-not-found"
                    }
                } else {
                    svgResult = "file-unreadable"
                }
            }

            // Also test what XHTML parsing produces for this page
            // (this is what gets stored in chapterDocuments by paginateAllChapters/prefetch)
            let xhtmlNodes: [ContentNode]
            if let data = try? Data(contentsOf: chapterURL) {
                let baseURL = chapterURL.deletingLastPathComponent()
                let xhtmlParser = XHTMLContentParser(data: data, baseURL: baseURL)
                xhtmlNodes = xhtmlParser.parse()
            } else {
                xhtmlNodes = []
            }
            let settings = ReaderSettings()
            let builder = AttributedStringBuilder(settings: settings, contentWidth: 326)
            let (xhtmlAttr, _, _) = builder.build(from: xhtmlNodes)
            let preview = String(xhtmlAttr.string.prefix(80))
                .replacingOccurrences(of: "\n", with: "↵")

            let result = PageResult(
                spineIndex: spineIndex, href: href,
                isSVGDetected: isSVG, svgRenderResult: svgResult,
                xhtmlNodeCount: xhtmlNodes.count,
                xhtmlTextPreview: preview
            )
            results.append(result)

            if svgImage == nil {
                svgFailures.append((spineIndex, href, svgResult))
            }
            if !isSVG {
                svgFailures.append((spineIndex, href, "NOT detected as SVG — would display XHTML text: '\(preview)'"))
            }
        }

        // Print per-page summary so the test output is readable
        for r in results {
            let svgFlag = r.isSVGDetected ? "SVG✓" : "SVG✗"
            print("  spine[\(r.spineIndex)] \(r.href): \(svgFlag) render=\(r.svgRenderResult) xhtml_nodes=\(r.xhtmlNodeCount) xhtml='\(r.xhtmlTextPreview)'")
        }

        if !svgFailures.isEmpty {
            let detail = svgFailures.map { "  spine[\($0.0)] \($0.1): \($0.2)" }.joined(separator: "\n")
            XCTFail("Pages that would display incorrectly:\n\(detail)")
        }
    }

    /// Same test for the bare-SVG-in-spine variant.
    func testSousLeVentSVGInSpineAllPages() async throws {
        let url = try XCTUnwrap(TestHelpers.sampleEPUBURL(named: "sous-le-vent_svg-in-spine.epub"))
        let parser = try await EPUBParser.parse(epubURL: url)

        let viewport = CGSize(width: 390, height: 844)
        var failures: [(spine: Int, href: String, reason: String)] = []

        for spineIndex in 0..<parser.package.spine.count {
            let manifestItem = parser.package.manifestItem(forSpineIndex: spineIndex)
            guard let href = manifestItem?.href else { continue }

            let isSVG = manifestItem?.properties?.contains("svg") == true
                     || manifestItem?.mediaType == "image/svg+xml"
            guard isSVG else { continue }

            guard let chapterURL = parser.resolveSpineItemURL(at: spineIndex),
                  let data = try? Data(contentsOf: chapterURL),
                  let html = String(data: data, encoding: .utf8) else {
                failures.append((spineIndex, href, "Could not load file"))
                continue
            }

            guard let svgStart = html.range(of: "<svg", options: .caseInsensitive),
                  let svgEnd   = html.range(of: "</svg>", options: [.caseInsensitive, .backwards]),
                  svgEnd.lowerBound > svgStart.lowerBound else {
                failures.append((spineIndex, href, "No <svg>...</svg> found in file"))
                continue
            }
            let svgString = String(html[svgStart.lowerBound..<svgEnd.upperBound])

            guard let doc = SVGDocument(Data(svgString.utf8)) else {
                failures.append((spineIndex, href, "SVGDocument init failed (nil)"))
                continue
            }

            let canvas = doc.canvasSize
            if canvas == .zero || canvas.width <= 0 || canvas.height <= 0 {
                failures.append((spineIndex, href, "SVGDocument canvasSize is \(canvas)"))
                continue
            }

            guard doc.image(size: viewport) != nil else {
                failures.append((spineIndex, href,
                    "image(size:) returned nil (canvas=\(canvas))"))
                continue
            }
        }

        if !failures.isEmpty {
            let detail = failures.map { "  spine[\($0.spine)] \($0.href): \($0.reason)" }
                                  .joined(separator: "\n")
            XCTFail("SVG rendering issues in sous-le-vent_svg-in-spine:\n\(detail)")
        }
    }

}
