//
//  HighlightRenderInfo.swift
//  CCReader
//
//  Engine-side value type used to render highlights. The app's persistent
//  storage model (ReadingMark, in the main app) converts to this struct
//  before passing to the engine — keeps the engine API independent of the
//  app's SwiftData schema.
//

import UIKit

public struct HighlightRenderInfo: Equatable, Hashable, Sendable {
    public let id: String
    public let locatorJSON: String
    public let color: String   // Hex, e.g. "#ffff00"

    public init(id: String, locatorJSON: String, color: String) {
        self.id = id
        self.locatorJSON = locatorJSON
        self.color = color
    }

    public var uiColor: UIColor {
        UIColor(hex: color) ?? .yellow
    }
}
