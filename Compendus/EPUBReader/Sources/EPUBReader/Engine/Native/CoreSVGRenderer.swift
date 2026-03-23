//
//  CoreSVGRenderer.swift
//  EPUBReader
//
//  Direct access to Apple's private CoreSVG.framework for native SVG rendering.
//
//  CoreSVG is the engine that powers SF Symbols and UIImage asset-catalog SVGs.
//  UIImage(contentsOfFile:) goes through CGImageSource (raster pipeline) and
//  has no SVG plugin, so it cannot load SVG data. CoreSVG must be accessed
//  directly to get native vector rendering from arbitrary SVG data.
//
//  Fonts registered with CTFontManager are respected during rendering, so
//  EPUB-embedded PostScript fonts resolve correctly.
//
//  NOTE: CoreSVG.framework is a private Apple framework. These symbols have been
//  stable across iOS 13–18. The implementation uses dlopen/dlsym to load them
//  at runtime so there is no link-time dependency on the private framework.
//

import Darwin
import Foundation
import UIKit
import CoreGraphics

// MARK: - CoreSVG symbol loading

private let _coreSVG: UnsafeMutableRawPointer? = dlopen(
    "/System/Library/PrivateFrameworks/CoreSVG.framework/CoreSVG", RTLD_NOW
)

private func coreSVGSymbol<T>(_ name: String) -> T {
    unsafeBitCast(dlsym(_coreSVG, name), to: T.self)
}

// MARK: - CoreSVG function pointers

@objc private class CGSVGDocument: NSObject {}

private let _CGSVGDocumentCreateFromData: @convention(c) (CFData?, CFDictionary?) -> Unmanaged<CGSVGDocument>?
    = coreSVGSymbol("CGSVGDocumentCreateFromData")

private let _CGSVGDocumentRelease: @convention(c) (CGSVGDocument?) -> Void
    = coreSVGSymbol("CGSVGDocumentRelease")

private let _CGSVGDocumentGetCanvasSize: @convention(c) (CGSVGDocument?) -> CGSize
    = coreSVGSymbol("CGSVGDocumentGetCanvasSize")

private let _CGContextDrawSVGDocument: @convention(c) (CGContext?, CGSVGDocument?) -> Void
    = coreSVGSymbol("CGContextDrawSVGDocument")

private let _imageWithCGSVGDocumentSEL: Selector = NSSelectorFromString("_imageWithCGSVGDocument:")
private typealias _ImageWithCGSVGDocumentFn = @convention(c) (AnyObject, Selector, CGSVGDocument) -> UIImage

// MARK: - SVGDocument

/// Wraps a parsed CoreSVG document. Lightweight — parsing happens once on init.
final class SVGDocument {

    private let doc: CGSVGDocument

    deinit { _CGSVGDocumentRelease(doc) }

    /// Returns `nil` if `data` is not valid SVG or CoreSVG is unavailable.
    init?(_ data: Data) {
        guard _coreSVG != nil,
              let unmanaged = _CGSVGDocumentCreateFromData(data as CFData, nil) else { return nil }
        let document = unmanaged.takeUnretainedValue()
        guard _CGSVGDocumentGetCanvasSize(document) != .zero else {
            _CGSVGDocumentRelease(document)
            return nil
        }
        doc = document
    }

    /// Intrinsic canvas size declared in the SVG (may be in user units / pt).
    var canvasSize: CGSize { _CGSVGDocumentGetCanvasSize(doc) }

    /// Render the SVG into `context` scaled to fit `viewport`, centered.
    ///
    /// `context` is assumed to use UIKit coordinates (top-left origin, y downward)
    /// as provided by `UIGraphicsImageRenderer`. `CGContextDrawSVGDocument` expects
    /// a CG coordinate system (bottom-left, y upward), so we flip the y-axis and
    /// translate the origin to the bottom of the content area AFTER centering.
    func draw(in context: CGContext, size viewport: CGSize) {
        let canvas = canvasSize
        guard canvas.width > 0, canvas.height > 0 else { return }

        // Scale to fit, preserving aspect ratio (scaleAspectFit behaviour)
        let scale        = min(viewport.width  / canvas.width,
                               viewport.height / canvas.height)
        let scaledWidth  = canvas.width  * scale
        let scaledHeight = canvas.height * scale

        // Centering offsets within the viewport
        let cx = (viewport.width  - scaledWidth)  / 2
        let cy = (viewport.height - scaledHeight) / 2

        // In UIKit space (y-down), the bottom of the content area is at cy + scaledHeight.
        // We translate the origin there, then flip y so CGContextDrawSVGDocument sees a
        // CG coordinate system where y=0 is the bottom of the content area.
        context.translateBy(x: cx, y: cy + scaledHeight)
        context.scaleBy(x: 1, y: -1)
        context.scaleBy(x: scale, y: scale)

        _CGContextDrawSVGDocument(context, doc)
    }

    /// Render to a `UIImage` at the given pixel size.
    /// Safe to call off the main thread.
    func image(size: CGSize) -> UIImage? {
        UIGraphicsImageRenderer(size: size).image { ctx in
            draw(in: ctx.cgContext, size: size)
        }
    }
}
