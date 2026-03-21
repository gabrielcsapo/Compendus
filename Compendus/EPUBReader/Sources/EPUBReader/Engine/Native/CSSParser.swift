//
//  CSSParser.swift
//  Compendus
//
//  Lightweight CSS parser for EPUB stylesheets.
//  Extracts class-based styles into a lookup table for use by XHTMLContentParser.
//  Supports class selectors, element selectors, and simple compound selectors.
//  Does NOT implement full CSS cascade — only flat rule matching.
//

import Foundation
import UIKit

// MARK: - CSS Value Types

/// A CSS length value with unit.
public enum CSSLength: Equatable, Hashable {
    case em(CGFloat)
    case px(CGFloat)
    case percent(CGFloat)
    case zero

    /// Resolve to points relative to a base font size.
    public func resolve(relativeTo fontSize: CGFloat) -> CGFloat {
        switch self {
        case .em(let value): return value * fontSize
        case .px(let value): return value
        case .percent(let value): return value / 100.0 * fontSize
        case .zero: return 0
        }
    }
}

public enum CSSFontStyle: Equatable { case italic, normal }
public enum CSSFontWeight: Equatable { case bold, normal }
public enum CSSFontVariant: Equatable { case smallCaps, normal }
public enum CSSTextAlign: Equatable { case left, center, right, justify }
public enum CSSTextTransform: Equatable { case uppercase, lowercase, capitalize }
public enum CSSTextDecoration: Equatable { case underline, lineThrough }
public enum CSSDisplay: Equatable { case none, block, inline }
public enum CSSListStyleType: Equatable { case disc, circle, square, decimal, lowerAlpha, lowerRoman, none }
public enum CSSFloat: Equatable { case left, right, none }
public enum CSSDirection: Equatable { case ltr, rtl }

// MARK: - CSS Properties

/// Resolved CSS properties for an element. All fields are optional;
/// nil means the property was not specified.
public struct CSSProperties: Equatable {
    var fontStyle: CSSFontStyle?
    var fontWeight: CSSFontWeight?
    var fontVariant: CSSFontVariant?
    var textAlign: CSSTextAlign?
    var textIndent: CSSLength?
    var marginTop: CSSLength?
    var marginBottom: CSSLength?
    var marginLeft: CSSLength?
    var marginRight: CSSLength?
    var textTransform: CSSTextTransform?
    var textDecoration: CSSTextDecoration?
    var display: CSSDisplay?
    var listStyleType: CSSListStyleType?
    var cssFloat: CSSFloat?
    var width: CSSLength?
    var height: CSSLength?
    var color: UIColor?
    var backgroundColor: UIColor?
    var direction: CSSDirection?
    var paddingTop: CSSLength?
    var paddingBottom: CSSLength?
    var paddingLeft: CSSLength?
    var paddingRight: CSSLength?
    var borderWidth: CSSLength?
    var fontFamily: String?
    var fontSize: CSSLength?

    public static let empty = CSSProperties()

    /// Merge: non-nil values from `other` override self.
    public func merging(with other: CSSProperties) -> CSSProperties {
        var result = self
        if let v = other.fontStyle { result.fontStyle = v }
        if let v = other.fontWeight { result.fontWeight = v }
        if let v = other.fontVariant { result.fontVariant = v }
        if let v = other.textAlign { result.textAlign = v }
        if let v = other.textIndent { result.textIndent = v }
        if let v = other.marginTop { result.marginTop = v }
        if let v = other.marginBottom { result.marginBottom = v }
        if let v = other.marginLeft { result.marginLeft = v }
        if let v = other.marginRight { result.marginRight = v }
        if let v = other.textTransform { result.textTransform = v }
        if let v = other.textDecoration { result.textDecoration = v }
        if let v = other.display { result.display = v }
        if let v = other.listStyleType { result.listStyleType = v }
        if let v = other.cssFloat { result.cssFloat = v }
        if let v = other.width { result.width = v }
        if let v = other.height { result.height = v }
        if let v = other.color { result.color = v }
        if let v = other.backgroundColor { result.backgroundColor = v }
        if let v = other.direction { result.direction = v }
        if let v = other.paddingTop { result.paddingTop = v }
        if let v = other.paddingBottom { result.paddingBottom = v }
        if let v = other.paddingLeft { result.paddingLeft = v }
        if let v = other.paddingRight { result.paddingRight = v }
        if let v = other.borderWidth { result.borderWidth = v }
        if let v = other.fontFamily { result.fontFamily = v }
        if let v = other.fontSize { result.fontSize = v }
        return result
    }
}

// MARK: - CSS Selector

/// A parsed CSS selector with specificity for ordering.
private struct CSSRule {
    enum SelectorKind: Hashable {
        case element(String)                    // "p"
        case className(String)                  // ".italic"
        case elementClass(String, String)       // "span.italic"
        case idSelector(String)                 // "#video1"
    }

    let selector: SelectorKind
    let properties: CSSProperties

    /// Specificity for rule ordering (higher wins).
    var specificity: Int {
        switch selector {
        case .element: return 1
        case .className: return 10
        case .elementClass: return 11
        case .idSelector: return 100
        }
    }
}

/// A CSS rule that requires ancestor context to match (e.g. `.chapter p`).
/// Stored separately from flat rules and only evaluated when an ancestor stack
/// is provided to `CSSStylesheet.resolve(element:classes:id:ancestorStack:)`.
public struct CSSDescendantRule {
    /// The ancestor pattern to find in the ancestor stack.
    /// Starts with "." for class patterns (e.g. ".chapter"), otherwise a tag name (e.g. "section").
    let ancestorPattern: String
    /// The target selector (rightmost part of the original selector).
    fileprivate let target: CSSRule.SelectorKind
    let properties: CSSProperties
}

// MARK: - Font Face

/// A parsed @font-face rule from CSS.
public struct CSSFontFace: Equatable {
    public let family: String       // font-family name
    public let sources: [String]    // src URLs (relative paths)
    public let weight: CSSFontWeight?
    public let style: CSSFontStyle?
}

// MARK: - CSS Stylesheet

/// A parsed CSS stylesheet with fast class-based lookup and descendant-rule support.
public struct CSSStylesheet {
    private var elementRules: [String: CSSProperties] = [:]
    private var classRules: [String: CSSProperties] = [:]
    private var elementClassRules: [String: CSSProperties] = [:] // "element.class" key
    private var idRules: [String: CSSProperties] = [:]
    /// Parsed @font-face rules.
    public internal(set) var fontFaces: [CSSFontFace] = []
    /// Descendant/ancestor-context rules (e.g. `.chapter p`, `section h2`).
    public private(set) var descendantRules: [CSSDescendantRule] = []

    /// Resolve styles for an element given its tag name, CSS classes, and optional ID.
    /// Flat resolution only — no ancestor context.
    public func resolve(element: String, classes: [String], id: String? = nil) -> CSSProperties {
        resolve(element: element, classes: classes, id: id, ancestorStack: [])
    }

    /// Resolve styles with full ancestor context for descendant selector support.
    /// `ancestorStack` is ordered from immediate parent → document root.
    public func resolve(
        element: String,
        classes: [String],
        id: String? = nil,
        ancestorStack: [(tag: String, classes: [String])]
    ) -> CSSProperties {
        var result = CSSProperties.empty

        // 1. Element rules (lowest specificity)
        if let props = elementRules[element] {
            result = result.merging(with: props)
        }

        // 2. Class rules
        for cls in classes {
            if let props = classRules[cls] {
                result = result.merging(with: props)
            }
        }

        // 3. Element.class rules
        for cls in classes {
            let key = "\(element).\(cls)"
            if let props = elementClassRules[key] {
                result = result.merging(with: props)
            }
        }

        // 4. ID rules (highest flat specificity)
        if let id = id, let props = idRules[id] {
            result = result.merging(with: props)
        }

        // 5. Descendant rules — requires ancestor stack (specificity ~11, between class and ID)
        if !ancestorStack.isEmpty {
            for rule in descendantRules {
                guard ruleMatchesTarget(rule.target, element: element, classes: classes, id: id) else { continue }
                let pattern = rule.ancestorPattern
                let isClass = pattern.hasPrefix(".")
                let patternKey = isClass ? String(pattern.dropFirst()) : pattern
                let ancestorMatches = ancestorStack.contains { ancestor in
                    isClass ? ancestor.classes.contains(patternKey) : ancestor.tag == patternKey
                }
                if ancestorMatches {
                    result = result.merging(with: rule.properties)
                }
            }
        }

        return result
    }

    /// Merge another stylesheet into this one (later rules win).
    public mutating func merge(with other: CSSStylesheet) {
        for (key, props) in other.elementRules {
            elementRules[key] = (elementRules[key] ?? .empty).merging(with: props)
        }
        for (key, props) in other.classRules {
            classRules[key] = (classRules[key] ?? .empty).merging(with: props)
        }
        for (key, props) in other.elementClassRules {
            elementClassRules[key] = (elementClassRules[key] ?? .empty).merging(with: props)
        }
        for (key, props) in other.idRules {
            idRules[key] = (idRules[key] ?? .empty).merging(with: props)
        }
        fontFaces.append(contentsOf: other.fontFaces)
        descendantRules.append(contentsOf: other.descendantRules)
    }

    fileprivate mutating func addRule(_ rule: CSSRule) {
        switch rule.selector {
        case .element(let el):
            elementRules[el] = (elementRules[el] ?? .empty).merging(with: rule.properties)
        case .className(let cls):
            classRules[cls] = (classRules[cls] ?? .empty).merging(with: rule.properties)
        case .elementClass(let el, let cls):
            let key = "\(el).\(cls)"
            elementClassRules[key] = (elementClassRules[key] ?? .empty).merging(with: rule.properties)
        case .idSelector(let id):
            idRules[id] = (idRules[id] ?? .empty).merging(with: rule.properties)
        }
    }

    fileprivate mutating func addDescendantRule(_ rule: CSSDescendantRule) {
        descendantRules.append(rule)
    }

    /// Check whether a flat selector kind matches a given element.
    private func ruleMatchesTarget(
        _ target: CSSRule.SelectorKind,
        element: String,
        classes: [String],
        id: String?
    ) -> Bool {
        switch target {
        case .element(let el): return el == element
        case .className(let cls): return classes.contains(cls)
        case .elementClass(let el, let cls): return el == element && classes.contains(cls)
        case .idSelector(let tid): return id == tid
        }
    }
}

// MARK: - CSS Parser

public enum CSSParser {

    /// Parse a CSS string into a CSSStylesheet.
    public static func parse(_ css: String) -> CSSStylesheet {
        var stylesheet = CSSStylesheet()
        let cleaned = stripComments(css)
        let extracted = extractRules(from: cleaned)

        for (selectorText, declarationText) in extracted.rules {
            let properties = parseDeclarations(declarationText)
            let (flatSelectors, descendantSelectors) = parseSelectors(selectorText, properties: properties)
            for selector in flatSelectors {
                stylesheet.addRule(CSSRule(selector: selector, properties: properties))
            }
            for desc in descendantSelectors {
                stylesheet.addDescendantRule(desc)
            }
        }

        for fontFaceDecl in extracted.fontFaces {
            if let fontFace = parseFontFace(fontFaceDecl) {
                stylesheet.fontFaces.append(fontFace)
            }
        }

        return stylesheet
    }

    // MARK: - Comment Stripping

    private static func stripComments(_ css: String) -> String {
        var result = ""
        result.reserveCapacity(css.count)
        var i = css.startIndex
        while i < css.endIndex {
            let next = css.index(after: i)
            if next < css.endIndex && css[i] == "/" && css[next] == "*" {
                // Find closing */
                var j = css.index(after: next)
                while j < css.endIndex {
                    let jNext = css.index(after: j)
                    if jNext <= css.endIndex && css[j] == "*" && jNext < css.endIndex && css[jNext] == "/" {
                        i = css.index(after: jNext)
                        break
                    }
                    j = css.index(after: j)
                }
                if j >= css.endIndex { break }
            } else {
                result.append(css[i])
                i = css.index(after: i)
            }
        }
        return result
    }

    // MARK: - Rule Extraction

    private struct ExtractedRules {
        var rules: [(String, String)] = []
        var fontFaces: [String] = []
    }

    /// Extract (selector, declarations) pairs. Intercepts @font-face; skips other @-blocks.
    private static func extractRules(from css: String) -> ExtractedRules {
        var extracted = ExtractedRules()
        var i = css.startIndex
        var selectorBuffer = ""

        while i < css.endIndex {
            let ch = css[i]

            if ch == "@" {
                // Check for @font-face
                let remaining = css[i...]
                if remaining.lowercased().hasPrefix("@font-face") {
                    // Advance past "@font-face"
                    i = css.index(i, offsetBy: 10, limitedBy: css.endIndex) ?? css.endIndex
                    // Find opening brace
                    while i < css.endIndex && css[i] != "{" { i = css.index(after: i) }
                    if i < css.endIndex {
                        i = css.index(after: i) // skip {
                        var braceDepth = 1
                        var declarationBuffer = ""
                        while i < css.endIndex && braceDepth > 0 {
                            let c = css[i]
                            if c == "{" { braceDepth += 1 }
                            else if c == "}" { braceDepth -= 1 }
                            if braceDepth > 0 { declarationBuffer.append(c) }
                            i = css.index(after: i)
                        }
                        extracted.fontFaces.append(declarationBuffer)
                    }
                    selectorBuffer = ""
                    continue
                }

                // Skip other @-blocks by counting braces
                var braceDepth = 0
                var foundBrace = false
                while i < css.endIndex {
                    let c = css[i]
                    if c == "{" {
                        braceDepth += 1
                        foundBrace = true
                    } else if c == "}" {
                        braceDepth -= 1
                        if foundBrace && braceDepth <= 0 {
                            i = css.index(after: i)
                            break
                        }
                    } else if c == ";" && !foundBrace {
                        // @import without braces
                        i = css.index(after: i)
                        break
                    }
                    i = css.index(after: i)
                }
                selectorBuffer = ""
                continue
            }

            if ch == "{" {
                // Find matching closing brace
                var braceDepth = 1
                var declarationBuffer = ""
                i = css.index(after: i)
                while i < css.endIndex && braceDepth > 0 {
                    let c = css[i]
                    if c == "{" { braceDepth += 1 }
                    else if c == "}" { braceDepth -= 1 }
                    if braceDepth > 0 {
                        declarationBuffer.append(c)
                    }
                    i = css.index(after: i)
                }

                let selector = selectorBuffer.trimmingCharacters(in: .whitespacesAndNewlines)
                if !selector.isEmpty {
                    extracted.rules.append((selector, declarationBuffer))
                }
                selectorBuffer = ""
                continue
            }

            selectorBuffer.append(ch)
            i = css.index(after: i)
        }

        return extracted
    }

    // MARK: - Selector Parsing

    /// Parse a selector string into flat selectors and ancestor-context (descendant) selectors.
    /// Handles comma-separated groups.
    private static func parseSelectors(
        _ text: String,
        properties: CSSProperties
    ) -> (flat: [CSSRule.SelectorKind], descendant: [CSSDescendantRule]) {
        let parts = text.split(separator: ",").map {
            $0.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        var flatSelectors: [CSSRule.SelectorKind] = []
        var descendantSelectors: [CSSDescendantRule] = []

        for part in parts {
            switch parseSingleSelector(part) {
            case .flat(let kind):
                flatSelectors.append(kind)
            case .descendant(let ancestorPattern, let target):
                descendantSelectors.append(
                    CSSDescendantRule(ancestorPattern: ancestorPattern, target: target, properties: properties)
                )
            case .none:
                break
            }
        }
        return (flatSelectors, descendantSelectors)
    }

    private enum SelectorParseResult {
        case flat(CSSRule.SelectorKind)
        case descendant(ancestorPattern: String, target: CSSRule.SelectorKind)
        case none
    }

    /// Parse a single selector (no commas).
    ///
    /// For selectors with ancestor constraints (e.g. `.chapter p`, `section p`,
    /// `div.body h2`), returns a `.descendant` result so the rule is stored in
    /// the ancestor-aware lookup instead of being applied unconditionally.
    private static func parseSingleSelector(_ text: String) -> SelectorParseResult {
        // Split on whitespace, filter out CSS combinators
        let allSegments = text.split(separator: " ").map(String.init)
        let combinators: Set<String> = [">", "+", "~"]
        let segments = allSegments.filter { !combinators.contains($0) }
        guard let last = segments.last else { return .none }

        // Parse the rightmost (target) segment
        guard let targetKind = parseSelectorKind(last) else { return .none }

        // Single-segment selector → flat rule
        if segments.count == 1 {
            return .flat(targetKind)
        }

        // Multi-segment selector — extract ancestor pattern from the segment closest to the target.
        // We take the immediate ancestor only (closest ancestor wins for specificity ordering).
        let immediateAncestorSegment = segments[segments.count - 2]

        // Build ancestor pattern:
        // - ".chapter" for class selectors (or element.class → use the class part)
        // - "section" for element selectors
        let ancestorPattern: String
        if immediateAncestorSegment.hasPrefix("#") {
            // ID ancestor — too specific, just skip
            return .none
        } else if immediateAncestorSegment.hasPrefix(".") {
            // ".chapter" form
            ancestorPattern = immediateAncestorSegment
        } else if let dotIdx = immediateAncestorSegment.firstIndex(of: ".") {
            // "div.chapter" form — use the class part as the ancestor pattern
            let cls = String(immediateAncestorSegment[immediateAncestorSegment.index(after: dotIdx)...])
            ancestorPattern = "." + cls
        } else {
            // Pure element ancestor like "section", "div", "article"
            let el = immediateAncestorSegment.trimmingCharacters(in: .whitespaces)
            // Skip pseudo-elements and attribute selectors
            if el.contains(":") || el.contains("[") { return .none }
            ancestorPattern = el
        }

        return .descendant(ancestorPattern: ancestorPattern, target: targetKind)
    }

    /// Parse a simple selector token (element, .class, element.class, #id) into a SelectorKind.
    private static func parseSelectorKind(_ token: String) -> CSSRule.SelectorKind? {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        // Skip pseudo-selectors and attribute selectors
        if trimmed.contains(":") || trimmed.contains("[") { return nil }

        if trimmed.hasPrefix("#") {
            let id = String(trimmed.dropFirst())
            return id.isEmpty ? nil : .idSelector(id)
        }

        if let dotIndex = trimmed.firstIndex(of: ".") {
            let element = String(trimmed[trimmed.startIndex..<dotIndex])
            let className = String(trimmed[trimmed.index(after: dotIndex)...])
            // Handle multiple classes (e.g. ".a.b") — use only the first class
            let firstClass = className.split(separator: ".").first.map(String.init) ?? className
            if element.isEmpty {
                return firstClass.isEmpty ? nil : .className(firstClass)
            } else {
                return firstClass.isEmpty ? .element(element) : .elementClass(element, firstClass)
            }
        }

        return .element(trimmed)
    }

    // MARK: - Declaration Parsing

    /// Parse a declaration block into CSSProperties.
    /// Parse a CSS declaration block (without braces) into CSSProperties.
    /// Also used for inline style attributes.
    static func parseDeclarations(_ text: String) -> CSSProperties {
        var props = CSSProperties()
        let declarations = text.split(separator: ";")

        for decl in declarations {
            // Split on first colon only
            guard let colonIndex = decl.firstIndex(of: ":") else { continue }
            let property = decl[decl.startIndex..<colonIndex]
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            let rawValue = decl[decl.index(after: colonIndex)...]
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased()
            // Strip !important
            let value = rawValue.replacingOccurrences(of: "!important", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)

            switch property {
            case "font-style":
                if value == "italic" || value == "oblique" { props.fontStyle = .italic }
                else if value == "normal" { props.fontStyle = .normal }

            case "font-weight":
                if value == "bold" || value == "bolder" { props.fontWeight = .bold }
                else if value == "normal" || value == "lighter" { props.fontWeight = .normal }
                else if let num = Int(value), num >= 600 { props.fontWeight = .bold }
                else if let num = Int(value), num < 600 { props.fontWeight = .normal }

            case "font-variant", "font-variant-caps":
                if value.contains("small-caps") { props.fontVariant = .smallCaps }
                else if value == "normal" { props.fontVariant = .normal }

            case "text-align":
                if value == "center" { props.textAlign = .center }
                else if value == "right" { props.textAlign = .right }
                else if value == "left" || value == "start" { props.textAlign = .left }
                else if value == "justify" { props.textAlign = .justify }

            case "text-indent":
                if let length = parseLength(value) { props.textIndent = length }

            case "margin-top":
                if let length = parseLength(value) { props.marginTop = length }

            case "margin-bottom":
                if let length = parseLength(value) { props.marginBottom = length }

            case "margin-left":
                if let length = parseLength(value) { props.marginLeft = length }

            case "margin-right":
                if let length = parseLength(value) { props.marginRight = length }

            case "margin":
                parseMarginShorthand(value, into: &props)

            case "text-transform":
                if value == "uppercase" { props.textTransform = .uppercase }
                else if value == "lowercase" { props.textTransform = .lowercase }
                else if value == "capitalize" { props.textTransform = .capitalize }

            case "text-decoration", "text-decoration-line":
                if value.contains("underline") { props.textDecoration = .underline }
                else if value.contains("line-through") { props.textDecoration = .lineThrough }

            case "display":
                if value == "none" { props.display = .none }
                else if value == "block" { props.display = .block }
                else if value == "inline" { props.display = .inline }

            case "list-style-type", "list-style":
                if value.contains("none") { props.listStyleType = .none }
                else if value.contains("disc") { props.listStyleType = .disc }
                else if value.contains("circle") { props.listStyleType = .circle }
                else if value.contains("square") { props.listStyleType = .square }
                else if value.contains("decimal") { props.listStyleType = .decimal }
                else if value.contains("lower-alpha") || value.contains("lower-latin") {
                    props.listStyleType = .lowerAlpha
                }
                else if value.contains("lower-roman") { props.listStyleType = .lowerRoman }

            case "float":
                if value == "left" { props.cssFloat = .left }
                else if value == "right" { props.cssFloat = .right }
                else if value == "none" { props.cssFloat = .none }

            case "width":
                if let length = parseLength(value) { props.width = length }

            case "height":
                if let length = parseLength(value) { props.height = length }

            case "color":
                if let c = parseColor(value) { props.color = c }

            case "background-color":
                if let c = parseColor(value) { props.backgroundColor = c }

            case "background":
                parseBackgroundShorthand(value, into: &props)

            case "direction":
                if value == "rtl" { props.direction = .rtl }
                else if value == "ltr" { props.direction = .ltr }

            case "padding-top":
                if let length = parseLength(value) { props.paddingTop = length }
            case "padding-bottom":
                if let length = parseLength(value) { props.paddingBottom = length }
            case "padding-left":
                if let length = parseLength(value) { props.paddingLeft = length }
            case "padding-right":
                if let length = parseLength(value) { props.paddingRight = length }
            case "padding":
                parsePaddingShorthand(value, into: &props)

            case "border":
                parseBorderShorthand(value, into: &props)
            case "border-width":
                if let length = parseLength(value) { props.borderWidth = length }

            case "font-size":
                if let length = parseLength(value) { props.fontSize = length }

            case "font-family":
                let family = value.split(separator: ",").first?
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .replacingOccurrences(of: "'", with: "")
                    .replacingOccurrences(of: "\"", with: "")
                if let family, !family.isEmpty { props.fontFamily = family }

            default:
                break
            }
        }

        return props
    }

    // MARK: - Length Parsing

    /// Parse a CSS length value (e.g. "1.42em", "20px", "75%", "0").
    private static func parseLength(_ value: String) -> CSSLength? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed == "0" || trimmed == "0px" || trimmed == "0em" {
            return .zero
        }

        if trimmed.hasSuffix("em") {
            let numStr = String(trimmed.dropLast(2)).trimmingCharacters(in: .whitespaces)
            if let num = Double(numStr) { return .em(CGFloat(num)) }
        } else if trimmed.hasSuffix("rem") {
            let numStr = String(trimmed.dropLast(3)).trimmingCharacters(in: .whitespaces)
            if let num = Double(numStr) { return .em(CGFloat(num)) } // treat rem as em
        } else if trimmed.hasSuffix("px") {
            let numStr = String(trimmed.dropLast(2)).trimmingCharacters(in: .whitespaces)
            if let num = Double(numStr) { return .px(CGFloat(num)) }
        } else if trimmed.hasSuffix("pt") {
            let numStr = String(trimmed.dropLast(2)).trimmingCharacters(in: .whitespaces)
            if let num = Double(numStr) { return .px(CGFloat(num)) } // treat pt as px
        } else if trimmed.hasSuffix("%") {
            let numStr = String(trimmed.dropLast(1)).trimmingCharacters(in: .whitespaces)
            if let num = Double(numStr) { return .percent(CGFloat(num)) }
        } else if let num = Double(trimmed) {
            // Bare number — treat as px
            return num == 0 ? .zero : .px(CGFloat(num))
        }

        return nil
    }

    // MARK: - Margin Shorthand

    /// Parse `margin` shorthand into individual margin properties.
    private static func parseMarginShorthand(_ value: String, into props: inout CSSProperties) {
        let parts = value.split(whereSeparator: { $0.isWhitespace })
            .map { String($0) }
            .compactMap { parseLength($0) }

        switch parts.count {
        case 1:
            // margin: V  → all four
            props.marginTop = parts[0]
            props.marginRight = parts[0]
            props.marginBottom = parts[0]
            props.marginLeft = parts[0]
        case 2:
            // margin: V H
            props.marginTop = parts[0]
            props.marginBottom = parts[0]
            props.marginRight = parts[1]
            props.marginLeft = parts[1]
        case 3:
            // margin: T H B
            props.marginTop = parts[0]
            props.marginRight = parts[1]
            props.marginLeft = parts[1]
            props.marginBottom = parts[2]
        case 4:
            // margin: T R B L
            props.marginTop = parts[0]
            props.marginRight = parts[1]
            props.marginBottom = parts[2]
            props.marginLeft = parts[3]
        default:
            break
        }
    }

    // MARK: - Padding Shorthand

    /// Parse `padding` shorthand into individual padding properties.
    private static func parsePaddingShorthand(_ value: String, into props: inout CSSProperties) {
        let parts = value.split(whereSeparator: { $0.isWhitespace })
            .map { String($0) }
            .compactMap { parseLength($0) }

        switch parts.count {
        case 1:
            props.paddingTop = parts[0]; props.paddingRight = parts[0]
            props.paddingBottom = parts[0]; props.paddingLeft = parts[0]
        case 2:
            props.paddingTop = parts[0]; props.paddingBottom = parts[0]
            props.paddingRight = parts[1]; props.paddingLeft = parts[1]
        case 3:
            props.paddingTop = parts[0]; props.paddingRight = parts[1]
            props.paddingLeft = parts[1]; props.paddingBottom = parts[2]
        case 4:
            props.paddingTop = parts[0]; props.paddingRight = parts[1]
            props.paddingBottom = parts[2]; props.paddingLeft = parts[3]
        default: break
        }
    }

    // MARK: - Border Shorthand

    /// Extract border-width from `border` shorthand (e.g. "1px solid black").
    private static func parseBorderShorthand(_ value: String, into props: inout CSSProperties) {
        let parts = value.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        for part in parts {
            if let length = parseLength(part) {
                props.borderWidth = length
                return
            }
        }
    }

    // MARK: - Background Shorthand

    /// Extract background-color from `background` shorthand.
    private static func parseBackgroundShorthand(_ value: String, into props: inout CSSProperties) {
        // Try the whole value as a color first (most common case: "background: #fff")
        if let c = parseColor(value) {
            props.backgroundColor = c
            return
        }
        // Try each token
        let parts = value.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        for part in parts {
            if let c = parseColor(part) {
                props.backgroundColor = c
                return
            }
        }
    }

    // MARK: - Font Face Parsing

    /// Parse a @font-face declaration block into a CSSFontFace.
    private static func parseFontFace(_ declarations: String) -> CSSFontFace? {
        var family: String?
        var sources: [String] = []
        var weight: CSSFontWeight?
        var style: CSSFontStyle?

        let decls = declarations.split(separator: ";")
        for decl in decls {
            guard let colonIndex = decl.firstIndex(of: ":") else { continue }
            let property = decl[decl.startIndex..<colonIndex]
                .trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let value = decl[decl.index(after: colonIndex)...]
                .trimmingCharacters(in: .whitespacesAndNewlines)

            switch property {
            case "font-family":
                family = value.replacingOccurrences(of: "'", with: "")
                    .replacingOccurrences(of: "\"", with: "")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            case "src":
                // Extract url() values
                var searchStart = value.startIndex
                while let urlRange = value.range(of: "url(", range: searchStart..<value.endIndex) {
                    let afterUrl = urlRange.upperBound
                    if let closeRange = value.range(of: ")", range: afterUrl..<value.endIndex) {
                        var urlStr = String(value[afterUrl..<closeRange.lowerBound])
                        urlStr = urlStr.trimmingCharacters(in: .whitespacesAndNewlines)
                            .replacingOccurrences(of: "'", with: "")
                            .replacingOccurrences(of: "\"", with: "")
                        if !urlStr.isEmpty { sources.append(urlStr) }
                        searchStart = closeRange.upperBound
                    } else { break }
                }
            case "font-weight":
                let v = value.lowercased()
                if v == "bold" || v == "bolder" || (Int(v) ?? 0) >= 600 { weight = .bold }
                else { weight = .normal }
            case "font-style":
                let v = value.lowercased()
                if v == "italic" || v == "oblique" { style = .italic }
                else { style = .normal }
            default: break
            }
        }

        guard let family, !sources.isEmpty else { return nil }
        return CSSFontFace(family: family, sources: sources, weight: weight, style: style)
    }

    // MARK: - CSS Color Parsing

    /// Parse a CSS color value into a UIColor.
    static func parseColor(_ value: String) -> UIColor? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if trimmed.isEmpty || trimmed == "inherit" || trimmed == "currentcolor" || trimmed == "initial" { return nil }
        if trimmed == "transparent" { return .clear }

        // Hex colors
        if trimmed.hasPrefix("#") {
            return parseHexColor(String(trimmed.dropFirst()))
        }

        // rgb() / rgba()
        if trimmed.hasPrefix("rgb") {
            return parseRGBFunction(trimmed)
        }

        // Named colors
        return namedColors[trimmed]
    }

    private static func parseHexColor(_ hex: String) -> UIColor? {
        let chars = Array(hex)
        let r, g, b, a: CGFloat

        switch chars.count {
        case 3: // #RGB
            guard let rv = hexVal(chars[0]), let gv = hexVal(chars[1]), let bv = hexVal(chars[2]) else { return nil }
            r = CGFloat(rv * 17) / 255; g = CGFloat(gv * 17) / 255; b = CGFloat(bv * 17) / 255; a = 1
        case 4: // #RGBA
            guard let rv = hexVal(chars[0]), let gv = hexVal(chars[1]),
                  let bv = hexVal(chars[2]), let av = hexVal(chars[3]) else { return nil }
            r = CGFloat(rv * 17) / 255; g = CGFloat(gv * 17) / 255; b = CGFloat(bv * 17) / 255; a = CGFloat(av * 17) / 255
        case 6: // #RRGGBB
            guard let rv = hexByte(chars[0], chars[1]), let gv = hexByte(chars[2], chars[3]),
                  let bv = hexByte(chars[4], chars[5]) else { return nil }
            r = CGFloat(rv) / 255; g = CGFloat(gv) / 255; b = CGFloat(bv) / 255; a = 1
        case 8: // #RRGGBBAA
            guard let rv = hexByte(chars[0], chars[1]), let gv = hexByte(chars[2], chars[3]),
                  let bv = hexByte(chars[4], chars[5]), let av = hexByte(chars[6], chars[7]) else { return nil }
            r = CGFloat(rv) / 255; g = CGFloat(gv) / 255; b = CGFloat(bv) / 255; a = CGFloat(av) / 255
        default: return nil
        }
        return UIColor(red: r, green: g, blue: b, alpha: a)
    }

    private static func hexVal(_ c: Character) -> Int? {
        if let v = c.hexDigitValue { return v }
        return nil
    }

    private static func hexByte(_ c1: Character, _ c2: Character) -> Int? {
        guard let v1 = c1.hexDigitValue, let v2 = c2.hexDigitValue else { return nil }
        return v1 * 16 + v2
    }

    private static func parseRGBFunction(_ value: String) -> UIColor? {
        // Extract content between parentheses
        guard let openParen = value.firstIndex(of: "("),
              let closeParen = value.lastIndex(of: ")") else { return nil }
        let inner = value[value.index(after: openParen)..<closeParen]
            .trimmingCharacters(in: .whitespacesAndNewlines)

        // Split on comma or whitespace (modern syntax uses spaces)
        let separator: Character = inner.contains(",") ? "," : " "
        let parts = inner.split(separator: separator)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && $0 != "/" }

        guard parts.count >= 3 else { return nil }

        func parseComponent(_ s: String) -> CGFloat? {
            if s.hasSuffix("%") {
                guard let v = Double(s.dropLast()) else { return nil }
                return CGFloat(v) / 100.0
            }
            guard let v = Double(s) else { return nil }
            return CGFloat(v) / 255.0
        }

        guard let r = parseComponent(parts[0]),
              let g = parseComponent(parts[1]),
              let b = parseComponent(parts[2]) else { return nil }

        var a: CGFloat = 1
        if parts.count >= 4 {
            let alphaStr = parts[3]
            if alphaStr.hasSuffix("%") {
                if let v = Double(alphaStr.dropLast()) { a = CGFloat(v) / 100.0 }
            } else if let v = Double(alphaStr) {
                a = v > 1 ? CGFloat(v) / 255.0 : CGFloat(v)
            }
        }

        return UIColor(red: min(1, max(0, r)), green: min(1, max(0, g)),
                       blue: min(1, max(0, b)), alpha: min(1, max(0, a)))
    }

    // MARK: - Named Colors

    private static let namedColors: [String: UIColor] = {
        func c(_ r: UInt8, _ g: UInt8, _ b: UInt8) -> UIColor {
            UIColor(red: CGFloat(r)/255, green: CGFloat(g)/255, blue: CGFloat(b)/255, alpha: 1)
        }
        return [
            // Basic
            "black": c(0,0,0), "white": c(255,255,255), "red": c(255,0,0),
            "green": c(0,128,0), "blue": c(0,0,255), "yellow": c(255,255,0),
            "cyan": c(0,255,255), "magenta": c(255,0,255), "aqua": c(0,255,255),
            "fuchsia": c(255,0,255), "lime": c(0,255,0), "maroon": c(128,0,0),
            "navy": c(0,0,128), "olive": c(128,128,0), "purple": c(128,0,128),
            "teal": c(0,128,128), "silver": c(192,192,192), "gray": c(128,128,128),
            "grey": c(128,128,128),
            // Extended - Reds
            "indianred": c(205,92,92), "lightcoral": c(240,128,128),
            "salmon": c(250,128,114), "darksalmon": c(233,150,122),
            "lightsalmon": c(255,160,122), "crimson": c(220,20,60),
            "firebrick": c(178,34,34), "darkred": c(139,0,0),
            // Extended - Pinks
            "pink": c(255,192,203), "lightpink": c(255,182,193),
            "hotpink": c(255,105,180), "deeppink": c(255,20,147),
            "mediumvioletred": c(199,21,133), "palevioletred": c(219,112,147),
            // Extended - Oranges
            "orange": c(255,165,0), "darkorange": c(255,140,0),
            "orangered": c(255,69,0), "tomato": c(255,99,71), "coral": c(255,127,80),
            // Extended - Yellows
            "gold": c(255,215,0), "khaki": c(240,230,140), "darkkhaki": c(189,183,107),
            "peachpuff": c(255,218,185), "moccasin": c(255,228,181),
            "papayawhip": c(255,239,213), "lemonchiffon": c(255,250,205),
            "lightyellow": c(255,255,224), "wheat": c(245,222,179),
            "cornsilk": c(255,248,220),
            // Extended - Greens
            "limegreen": c(50,205,50), "lightgreen": c(144,238,144),
            "palegreen": c(152,251,152), "darkgreen": c(0,100,0),
            "forestgreen": c(34,139,34), "seagreen": c(46,139,87),
            "mediumseagreen": c(60,179,113), "springgreen": c(0,255,127),
            "mediumspringgreen": c(0,250,154), "mediumaquamarine": c(102,205,170),
            "darkseagreen": c(143,188,143), "yellowgreen": c(154,205,50),
            "olivedrab": c(107,142,35), "darkolivegreen": c(85,107,47),
            "greenyellow": c(173,255,47), "chartreuse": c(127,255,0),
            "lawngreen": c(124,252,0),
            // Extended - Cyans
            "lightcyan": c(224,255,255), "darkturquoise": c(0,206,209),
            "turquoise": c(64,224,208), "mediumturquoise": c(72,209,204),
            "paleturquoise": c(175,238,238), "aquamarine": c(127,255,212),
            "darkcyan": c(0,139,139), "cadetblue": c(95,158,160),
            "lightseagreen": c(32,178,170),
            // Extended - Blues
            "lightblue": c(173,216,230), "skyblue": c(135,206,235),
            "lightskyblue": c(135,206,250), "deepskyblue": c(0,191,255),
            "steelblue": c(70,130,180), "lightsteelblue": c(176,196,222),
            "dodgerblue": c(30,144,255), "cornflowerblue": c(100,149,237),
            "royalblue": c(65,105,225), "mediumblue": c(0,0,205),
            "darkblue": c(0,0,139), "midnightblue": c(25,25,112),
            "powderblue": c(176,224,230), "aliceblue": c(240,248,255),
            // Extended - Purples
            "lavender": c(230,230,250), "thistle": c(216,191,216),
            "plum": c(221,160,221), "violet": c(238,130,238),
            "orchid": c(218,112,214), "mediumorchid": c(186,85,211),
            "mediumpurple": c(147,112,219), "blueviolet": c(138,43,226),
            "darkviolet": c(148,0,211), "darkorchid": c(153,50,204),
            "darkmagenta": c(139,0,139), "rebeccapurple": c(102,51,153),
            "indigo": c(75,0,130), "slateblue": c(106,90,205),
            "mediumslateblue": c(123,104,238), "darkslateblue": c(72,61,139),
            // Extended - Browns
            "brown": c(165,42,42), "saddlebrown": c(139,69,19),
            "sienna": c(160,82,45), "chocolate": c(210,105,30),
            "peru": c(205,133,63), "sandybrown": c(244,164,96),
            "goldenrod": c(218,165,32), "darkgoldenrod": c(184,134,11),
            "burlywood": c(222,184,135), "tan": c(210,180,140),
            "rosybrown": c(188,143,143), "bisque": c(255,228,196),
            "blanchedalmond": c(255,235,205), "navajowhite": c(255,222,173),
            "antiquewhite": c(250,235,215),
            // Extended - Grays
            "lightgray": c(211,211,211), "lightgrey": c(211,211,211),
            "darkgray": c(169,169,169), "darkgrey": c(169,169,169),
            "dimgray": c(105,105,105), "dimgrey": c(105,105,105),
            "gainsboro": c(220,220,220), "whitesmoke": c(245,245,245),
            "slategray": c(112,128,144), "slategrey": c(112,128,144),
            "lightslategray": c(119,136,153), "lightslategrey": c(119,136,153),
            "darkslategray": c(47,79,79), "darkslategrey": c(47,79,79),
            // Extended - Whites
            "snow": c(255,250,250), "honeydew": c(240,255,240),
            "mintcream": c(245,255,250), "azure": c(240,255,255),
            "ghostwhite": c(248,248,255), "floralwhite": c(255,250,240),
            "ivory": c(255,255,240), "beige": c(245,245,220),
            "linen": c(250,240,230), "oldlace": c(253,245,230),
            "seashell": c(255,245,238), "mistyrose": c(255,228,225),
            "lavenderblush": c(255,240,245),
        ]
    }()
}
