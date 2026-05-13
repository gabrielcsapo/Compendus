//
//  PanelDetector.swift
//  Compendus
//
//  Generic comic panel detection via gutter analysis. Finds horizontal strips
//  of uniformly light pixels (the "gutters" between rows of panels), then
//  within each strip finds vertical light gutters that split rows into panels.
//
//  Handles:
//    - Standard 2×2 / 2×3 / 3×3 grids
//    - Splash pages (single full-page panel)
//    - Panoramic strips (full-width single-row panels)
//    - Mixed layouts with variable panel sizes within a page
//
//  Returns panels in reading order (top-to-bottom rows, left-to-right within).
//  Coordinates are normalized to 0..1 against the image.
//

import UIKit
import CoreGraphics

enum PanelDetector {
    /// Returns detected panel rects in 0..1 normalized image coordinates, in
    /// reading order. Returns an empty array if detection fails or the page
    /// has no detectable gutters (caller should fall back to a heuristic).
    static func detectPanels(in image: UIImage) async -> [CGRect] {
        await Task.detached(priority: .userInitiated) {
            detectPanelsSync(in: image)
        }.value
    }

    // MARK: - Implementation

    /// Maximum dimension we resample to before scanning. Higher resolution
    /// preserves thin horizontal gutters in comics like Y: The Last Man, at
    /// the cost of a few extra ms of detection time.
    private static let maxDimension: CGFloat = 480

    /// A pixel is considered "light" (gutter material) if its luminance is
    /// at or above this byte value (out of 255). 228 sits above light-blue
    /// pastel sky (~210-225, including white highlights mixed in) so rows
    /// inside a panel's sky background don't get mistaken for gutters,
    /// while still below normal scanned-page gutter rows (~240-250).
    private static let lightThreshold: UInt8 = 228

    /// Mirror threshold for dark gutters — touching panel borders (no white
    /// gap between panels) form thin DARK rows that we treat as separators.
    private static let darkThreshold: UInt8 = 60

    /// A row/column is considered a gutter if at least this fraction of its
    /// pixels meet the relevant (light or dark) threshold. Loosened from 0.92
    /// because some scanned pages have small stray dark pixels in otherwise-
    /// blank gutter rows (compression noise, page-edge artifacts).
    private static let coverageThreshold: Double = 0.85

    /// Reject any detected "panel" smaller than this fraction of the page
    /// area — these are usually noise (page borders, registration marks).
    private static let minAreaFraction: Double = 0.02

    /// A "thin" dark gutter (e.g., a panel border line) is at most this many
    /// rows tall. Beyond this we treat the dark band as content (a panel
    /// with a dark background like a title card). 12 rows ≈ 1.7% of a 720-
    /// row resampled page — covers the thicker black borders between rows
    /// without misclassifying full title-card panels.
    private static let maxDarkGutterRows: Int = 12

    /// Aspect ratio (width/height) above which a panel is considered "too
    /// wide" to read comfortably at fit-to-screen zoom on a portrait phone.
    /// Such panels get split into horizontal sub-panels so each chunk uses
    /// more of the device's screen.
    private static let maxPanelAspect: CGFloat = 1.8

    /// Target aspect ratio for sub-panels after splitting. Slightly wider
    /// than tall keeps comic flow natural while filling more of the screen
    /// than the parent panel would.
    private static let targetSubPanelAspect: CGFloat = 1.4

    private static func detectPanelsSync(in image: UIImage) -> [CGRect] {
        guard let cg = image.cgImage else { return [] }

        // 1. Resample to a working size that's fast to scan.
        let scale = min(maxDimension / image.size.width, maxDimension / image.size.height, 1.0)
        let target = CGSize(
            width: max(64, image.size.width * scale).rounded(),
            height: max(64, image.size.height * scale).rounded()
        )
        guard let small = resample(cg, to: target),
              let gray = grayscalePixels(from: small) else { return [] }

        let w = small.width
        let h = small.height

        // 2. Horizontal-gutter mask. A row is a gutter when either:
        //    - Its MEAN luminance is light (the normal white inter-panel gap;
        //      using mean instead of coverage tolerates a few overhanging
        //      speech-bubble outline pixels in the gutter row), or
        //    - It's a THIN dark band (a black panel-border line, possibly
        //      between two panels that share their borders).
        var rowIsLight = [Bool](repeating: false, count: h)
        var rowIsDark = [Bool](repeating: false, count: h)
        for y in 0..<h {
            var sum = 0
            var darkCount = 0
            let base = y * w
            for x in 0..<w {
                let v = gray[base + x]
                sum += Int(v)
                if v <= darkThreshold { darkCount += 1 }
            }
            let mean = sum / w
            rowIsLight[y] = mean >= Int(lightThreshold)
            rowIsDark[y] = Double(darkCount) / Double(w) >= coverageThreshold
        }

        // Thin clusters of dark rows are panel-separator border lines; thick
        // clusters are dark content (e.g., a black title card).
        var rowIsGutter = rowIsLight
        let darkRuns = contiguousRuns(of: true, in: rowIsDark, minLength: 1)
        for run in darkRuns where (run.end - run.start + 1) <= maxDarkGutterRows {
            for y in run.start...run.end { rowIsGutter[y] = true }
        }

        // 3. Group consecutive NON-gutter rows into horizontal strips.
        let minStripLength = max(6, h / 50)  // panels must be ≥ ~2% of dim
        let rowStrips = contiguousRuns(of: false, in: rowIsGutter, minLength: minStripLength)

        // 4. For each strip, find vertical gutters and split into panels.
        var panels: [CGRect] = []
        for strip in rowStrips {
            let stripHeight = strip.end - strip.start + 1

            var colIsLight = [Bool](repeating: false, count: w)
            var colIsDark = [Bool](repeating: false, count: w)
            var totalDark = 0
            for x in 0..<w {
                var lightCount = 0
                var darkCount = 0
                for y in strip.start...strip.end {
                    let v = gray[y * w + x]
                    if v >= lightThreshold { lightCount += 1 }
                    else if v <= darkThreshold { darkCount += 1 }
                }
                colIsLight[x] = Double(lightCount) / Double(stripHeight) >= coverageThreshold
                colIsDark[x] = Double(darkCount) / Double(stripHeight) >= coverageThreshold
                totalDark += darkCount
            }
            // If the strip is predominantly dark (a title card / banner like
            // the "NOW" panel in Y: The Last Man), don't split it on inter-
            // letter dark columns — treat the whole strip as one panel.
            let totalPixels = stripHeight * w
            let darkFraction = Double(totalDark) / Double(totalPixels)
            let isDarkBanner = darkFraction > 0.55

            var colIsGutter = colIsLight
            if !isDarkBanner {
                let darkColRuns = contiguousRuns(of: true, in: colIsDark, minLength: 1)
                for run in darkColRuns where (run.end - run.start + 1) <= maxDarkGutterRows {
                    for x in run.start...run.end { colIsGutter[x] = true }
                }
            }

            let minColLength = max(6, w / 50)
            let colStrips = contiguousRuns(of: false, in: colIsGutter, minLength: minColLength)

            for col in colStrips {
                // Tight rect from gutter analysis (panel border to border).
                let rawPxRect = (
                    x0: col.start,
                    y0: strip.start,
                    x1: col.end,
                    y1: strip.end
                )
                // Trim residual all-light rows/columns from each edge — many
                // panels have internal background that's the same color as
                // the gutter; the user wants the highlight on the visible art
                // not the panel's rectangular footprint.
                guard let trimmed = trimToContent(rawPxRect, gray: gray, w: w, h: h) else { continue }

                let rect = CGRect(
                    x: Double(trimmed.x0) / Double(w),
                    y: Double(trimmed.y0) / Double(h),
                    width: Double(trimmed.x1 - trimmed.x0 + 1) / Double(w),
                    height: Double(trimmed.y1 - trimmed.y0 + 1) / Double(h)
                )
                if rect.width * rect.height >= minAreaFraction {
                    panels.append(rect)
                }
            }
        }

        // 5. If the page contains a single full-bleed image with no detectable
        //    gutters, fall back to one panel covering the whole image.
        if panels.isEmpty {
            return [CGRect(x: 0, y: 0, width: 1, height: 1)]
        }

        // 6. Return raw panels. Wide-panel splitting happens at render time
        //    via `splitWidePanels(_:)` so the rendering layer can opt out
        //    when the device orientation already accommodates wide panels
        //    (e.g. landscape).
        return panels
    }

    /// Apply wide-panel splitting to a set of normalized panel rects. Used
    /// by the view controller in portrait orientation where wide panels
    /// don't fit comfortably at a single zoom.
    static func splitWidePanels(_ panels: [CGRect]) -> [CGRect] {
        panels.flatMap(splitWidePanel)
    }

    /// Returns either the panel as-is or N horizontal slices when it's wider
    /// than `maxPanelAspect`. Slices have a small overlap on each side so the
    /// reader sees a visual cue carried between sub-panels.
    private static func splitWidePanel(_ panel: CGRect) -> [CGRect] {
        let aspect = panel.width / panel.height
        guard aspect > maxPanelAspect else { return [panel] }

        let n = max(2, Int((aspect / targetSubPanelAspect).rounded(.up)))
        let baseWidth = panel.width / CGFloat(n)
        // 8% overlap on each interior edge so the eye carries between slices.
        let overlap: CGFloat = baseWidth * 0.08

        return (0..<n).map { i in
            let leftPad = i == 0 ? 0 : overlap
            let rightPad = i == n - 1 ? 0 : overlap
            let x = panel.minX + CGFloat(i) * baseWidth - leftPad
            let w = baseWidth + leftPad + rightPad
            return CGRect(x: x, y: panel.minY, width: w, height: panel.height)
        }
    }

    // MARK: - Helpers

    /// Shrink a rect inward, row-by-row and column-by-column, removing any
    /// edge bands that are entirely "light" (i.e. blank background). What
    /// remains is the visible content bounding box.
    ///
    /// IMPORTANT: when checking whether a row/col is blank, we ignore the
    /// outer ~5% of pixels on each side. Comic panels have thin BLACK borders
    /// running their full perimeter — without skipping the border columns,
    /// every row of "blank background" inside the panel still contains a few
    /// dark pixels at the edges and fails the blank-coverage test, so trim
    /// never advances.
    /// Returns nil if the entire region is light (an effectively empty panel).
    private static func trimToContent(
        _ rect: (x0: Int, y0: Int, x1: Int, y1: Int),
        gray: [UInt8],
        w: Int,
        h: Int
    ) -> (x0: Int, y0: Int, x1: Int, y1: Int)? {
        var x0 = rect.x0
        var x1 = rect.x1
        var y0 = rect.y0
        var y1 = rect.y1

        // A row/col qualifies as "blank background" when its mean luminance
        // is at or above this value. High enough that pastel panel content
        // (like sky / light-blue backgrounds) isn't trimmed, but not so
        // strict that slightly-off-white margins go unrecognized.
        let blankMean: Int = 248

        // Interior bounds — exclude the outer ~5% of each axis when sampling
        // a row/col. Skips the panel's own black borders which would otherwise
        // drag the mean down to ~225 for an otherwise-pure-white row.
        func interiorX() -> (Int, Int) {
            let inset = max(2, (x1 - x0) / 20)
            return (min(x1, x0 + inset), max(x0, x1 - inset))
        }
        func interiorY() -> (Int, Int) {
            let inset = max(2, (y1 - y0) / 20)
            return (min(y1, y0 + inset), max(y0, y1 - inset))
        }

        // Top
        while y0 < y1 {
            let (ix0, ix1) = interiorX()
            guard ix1 > ix0 else { break }
            var sum = 0
            for x in ix0...ix1 { sum += Int(gray[y0 * w + x]) }
            let mean = sum / (ix1 - ix0 + 1)
            if mean >= blankMean {
                y0 += 1
            } else {
                break
            }
        }
        // Bottom
        while y1 > y0 {
            let (ix0, ix1) = interiorX()
            guard ix1 > ix0 else { break }
            var sum = 0
            for x in ix0...ix1 { sum += Int(gray[y1 * w + x]) }
            let mean = sum / (ix1 - ix0 + 1)
            if mean >= blankMean {
                y1 -= 1
            } else {
                break
            }
        }
        // Left
        while x0 < x1 {
            let (iy0, iy1) = interiorY()
            guard iy1 > iy0 else { break }
            var sum = 0
            for y in iy0...iy1 { sum += Int(gray[y * w + x0]) }
            let mean = sum / (iy1 - iy0 + 1)
            if mean >= blankMean {
                x0 += 1
            } else {
                break
            }
        }
        // Right
        while x1 > x0 {
            let (iy0, iy1) = interiorY()
            guard iy1 > iy0 else { break }
            var sum = 0
            for y in iy0...iy1 { sum += Int(gray[y * w + x1]) }
            let mean = sum / (iy1 - iy0 + 1)
            if mean >= blankMean {
                x1 -= 1
            } else {
                break
            }
        }

        guard x1 > x0 && y1 > y0 else { return nil }
        return (x0, y0, x1, y1)
    }

    private static func contiguousRuns(of value: Bool, in mask: [Bool], minLength: Int)
        -> [(start: Int, end: Int)]
    {
        var runs: [(Int, Int)] = []
        var i = 0
        while i < mask.count {
            if mask[i] == value {
                let start = i
                while i < mask.count && mask[i] == value { i += 1 }
                let end = i - 1
                if end - start + 1 >= minLength {
                    runs.append((start, end))
                }
            } else {
                i += 1
            }
        }
        return runs
    }

    private static func grayscalePixels(from cg: CGImage) -> [UInt8]? {
        let width = cg.width
        let height = cg.height
        var bytes = [UInt8](repeating: 0, count: width * height)
        let space = CGColorSpaceCreateDeviceGray()
        let bitmapInfo = CGImageAlphaInfo.none.rawValue
        guard let ctx = CGContext(
            data: &bytes,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width,
            space: space,
            bitmapInfo: bitmapInfo
        ) else { return nil }
        // Quartz contexts have y=0 at the BOTTOM, but our byte buffer is laid
        // out top-to-bottom. Without flipping the CTM, the resulting buffer
        // ends up vertically inverted relative to the original image — that
        // turned detected panel rects upside-down.
        ctx.translateBy(x: 0, y: CGFloat(height))
        ctx.scaleBy(x: 1, y: -1)
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
        return bytes
    }

    private static func resample(_ image: CGImage, to size: CGSize) -> CGImage? {
        let w = Int(size.width)
        let h = Int(size.height)
        guard w > 0, h > 0,
              let ctx = CGContext(
                data: nil,
                width: w,
                height: h,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
              )
        else { return nil }
        ctx.interpolationQuality = .medium
        // Same y-flip as grayscalePixels — keep pixel layout matching the
        // original image so downstream scanning is in the right orientation.
        ctx.translateBy(x: 0, y: CGFloat(h))
        ctx.scaleBy(x: 1, y: -1)
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return ctx.makeImage()
    }
}
