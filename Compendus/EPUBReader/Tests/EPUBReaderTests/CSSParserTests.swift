//
//  CSSParserTests.swift
//  EPUBReaderTests
//
//  Unit tests for CSSParser and CSSStylesheet.
//

import XCTest
import UIKit
@testable import EPUBReader

final class CSSParserTests: XCTestCase {

    // MARK: - Comment Stripping

    func testCommentsAreStripped() {
        let css = "/* This is a comment */ p { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        let props = sheet.resolve(element: "p", classes: [])
        XCTAssertEqual(props.fontWeight, .bold)
    }

    func testMultilineCommentStripped() {
        let css = """
        /* start
           multiline
           comment */
        p { font-style: italic; }
        """
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "p", classes: []).fontStyle, .italic)
    }

    func testCommentInsideRule() {
        let css = "p { /* color: red; */ font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        let props = sheet.resolve(element: "p", classes: [])
        XCTAssertEqual(props.fontWeight, .bold)
        XCTAssertNil(props.color)
    }

    // MARK: - Element Selectors

    func testElementSelectorFontWeight() {
        let css = "p { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "p", classes: []).fontWeight, .bold)
    }

    func testElementSelectorFontStyle() {
        let css = "em { font-style: italic; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "em", classes: []).fontStyle, .italic)
    }

    func testElementSelectorDoesNotMatchOtherElements() {
        let css = "p { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        XCTAssertNil(sheet.resolve(element: "div", classes: []).fontWeight)
    }

    // MARK: - Class Selectors

    func testClassSelectorMatchesClass() {
        let css = ".highlight { text-decoration: underline; }"
        let sheet = CSSParser.parse(css)
        let props = sheet.resolve(element: "span", classes: ["highlight"])
        XCTAssertEqual(props.textDecoration, .underline)
    }

    func testClassSelectorRequiresClass() {
        let css = ".chapter { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        XCTAssertNil(sheet.resolve(element: "p", classes: []).fontWeight)
        XCTAssertEqual(sheet.resolve(element: "p", classes: ["chapter"]).fontWeight, .bold)
    }

    func testMultipleClassesAllApplied() {
        let css = ".bold { font-weight: bold; } .italic { font-style: italic; }"
        let sheet = CSSParser.parse(css)
        let props = sheet.resolve(element: "span", classes: ["bold", "italic"])
        XCTAssertEqual(props.fontWeight, .bold)
        XCTAssertEqual(props.fontStyle, .italic)
    }

    // MARK: - Compound (Element.Class) Selectors

    func testElementClassSelectorMatchesBoth() {
        let css = "p.intro { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "p", classes: ["intro"]).fontWeight, .bold)
    }

    func testElementClassSelectorDoesNotMatchWrongElement() {
        let css = "p.intro { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        XCTAssertNil(sheet.resolve(element: "div", classes: ["intro"]).fontWeight)
    }

    func testElementClassSelectorDoesNotMatchMissingClass() {
        let css = "p.intro { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        XCTAssertNil(sheet.resolve(element: "p", classes: []).fontWeight)
    }

    // MARK: - ID Selectors

    func testIdSelectorMatchesId() {
        let css = "#cover { display: none; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "div", classes: [], id: "cover").display, .none)
    }

    func testIdSelectorRequiresId() {
        let css = "#cover { display: none; }"
        let sheet = CSSParser.parse(css)
        XCTAssertNil(sheet.resolve(element: "div", classes: [], id: nil).display)
        XCTAssertNil(sheet.resolve(element: "div", classes: [], id: "other").display)
    }

    // MARK: - Specificity (ID > Element.Class > Class > Element)

    func testIdOverridesElementRule() {
        let css = "p { font-weight: normal; } #special { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        // p element rule first, then id rule wins for the same element with id
        let props = sheet.resolve(element: "p", classes: [], id: "special")
        XCTAssertEqual(props.fontWeight, .bold)
    }

    // MARK: - Comma-Separated Selectors

    func testCommaSeparatedSelectors() {
        let css = "h1, h2, h3 { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "h1", classes: []).fontWeight, .bold)
        XCTAssertEqual(sheet.resolve(element: "h2", classes: []).fontWeight, .bold)
        XCTAssertEqual(sheet.resolve(element: "h3", classes: []).fontWeight, .bold)
        XCTAssertNil(sheet.resolve(element: "p", classes: []).fontWeight)
    }

    // MARK: - Descendant Selectors

    func testDescendantClassRuleMatchesWithAncestor() {
        let css = ".chapter p { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        let ancestors: [(tag: String, classes: [String])] = [("div", ["chapter"])]
        let props = sheet.resolve(element: "p", classes: [], ancestorStack: ancestors)
        XCTAssertEqual(props.fontWeight, .bold)
    }

    func testDescendantClassRuleDoesNotMatchWithoutAncestor() {
        let css = ".chapter p { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        let props = sheet.resolve(element: "p", classes: [], ancestorStack: [])
        XCTAssertNil(props.fontWeight)
    }

    func testDescendantTagRuleMatchesWithAncestorTag() {
        let css = "section p { font-style: italic; }"
        let sheet = CSSParser.parse(css)
        let ancestors: [(tag: String, classes: [String])] = [("section", [])]
        let props = sheet.resolve(element: "p", classes: [], ancestorStack: ancestors)
        XCTAssertEqual(props.fontStyle, .italic)
    }

    func testDescendantRuleMatchesDeepAncestor() {
        let css = ".body p { text-align: justify; }"
        let sheet = CSSParser.parse(css)
        // ancestor is two levels up
        let ancestors: [(tag: String, classes: [String])] = [
            ("div", []),
            ("section", ["body"])
        ]
        let props = sheet.resolve(element: "p", classes: [], ancestorStack: ancestors)
        XCTAssertEqual(props.textAlign, .justify)
    }

    // MARK: - Property Parsing

    func testTextAlignJustify() {
        let css = "p { text-align: justify; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "p", classes: []).textAlign, .justify)
    }

    func testTextAlignCenter() {
        let css = "h1 { text-align: center; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "h1", classes: []).textAlign, .center)
    }

    func testDisplayNone() {
        let css = ".hidden { display: none; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "div", classes: ["hidden"]).display, .none)
    }

    func testTextDecorationLineThrough() {
        let css = ".strike { text-decoration: line-through; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "span", classes: ["strike"]).textDecoration, .lineThrough)
    }

    func testColorParsedAsHex() {
        let css = "p { color: #ff0000; }"
        let sheet = CSSParser.parse(css)
        let color = sheet.resolve(element: "p", classes: []).color
        XCTAssertNotNil(color, "Should parse hex color")
        var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0
        color?.getRed(&red, green: &green, blue: &blue, alpha: nil)
        XCTAssertEqual(red, 1.0, accuracy: 0.05)
        XCTAssertEqual(green, 0.0, accuracy: 0.05)
        XCTAssertEqual(blue, 0.0, accuracy: 0.05)
    }

    func testFontWeightNormal() {
        let css = ".regular { font-weight: normal; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "span", classes: ["regular"]).fontWeight, .normal)
    }

    func testDirectionRTL() {
        let css = ".arabic { direction: rtl; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "p", classes: ["arabic"]).direction, .rtl)
    }

    func testFloatLeft() {
        let css = "img { float: left; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "img", classes: []).cssFloat, .left)
    }

    func testListStyleTypeDecimal() {
        let css = "ol { list-style-type: decimal; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "ol", classes: []).listStyleType, .decimal)
    }

    // MARK: - CSS Length Parsing

    func testLengthEmResolves() {
        let em = CSSLength.em(1.5)
        XCTAssertEqual(em.resolve(relativeTo: 16), 24, accuracy: 0.01)
    }

    func testLengthPxResolves() {
        let px = CSSLength.px(12)
        XCTAssertEqual(px.resolve(relativeTo: 16), 12, accuracy: 0.01)
    }

    func testLengthPercentResolves() {
        let pct = CSSLength.percent(50)
        XCTAssertEqual(pct.resolve(relativeTo: 20), 10, accuracy: 0.01)
    }

    func testLengthZeroResolves() {
        XCTAssertEqual(CSSLength.zero.resolve(relativeTo: 16), 0, accuracy: 0.01)
    }

    func testMarginParsed() {
        let css = "p { margin-top: 1em; margin-bottom: 0.5em; }"
        let sheet = CSSParser.parse(css)
        let props = sheet.resolve(element: "p", classes: [])
        XCTAssertEqual(props.marginTop, .em(1))
        XCTAssertEqual(props.marginBottom, .em(0.5))
    }

    func testPaddingParsed() {
        let css = "blockquote { padding-left: 2em; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "blockquote", classes: []).paddingLeft, .em(2))
    }

    // MARK: - @font-face Parsing

    func testFontFaceParsed() {
        let css = """
        @font-face {
            font-family: "MyFont";
            src: url("fonts/MyFont.ttf");
        }
        """
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.fontFaces.count, 1)
        XCTAssertEqual(sheet.fontFaces.first?.family, "MyFont")
        XCTAssertTrue(sheet.fontFaces.first?.sources.first?.contains("MyFont.ttf") ?? false)
    }

    func testFontFaceDoesNotBlockOtherRules() {
        let css = """
        @font-face { font-family: "F"; src: url("f.ttf"); }
        p { font-weight: bold; }
        """
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "p", classes: []).fontWeight, .bold)
    }

    // MARK: - @-Block Skipping

    func testAtMediaBlockSkipped() {
        let css = "@media print { p { display: none; } } p { font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        // The @media block should be skipped; only the plain p rule applies
        XCTAssertEqual(sheet.resolve(element: "p", classes: []).fontWeight, .bold)
        XCTAssertNil(sheet.resolve(element: "p", classes: []).display)
    }

    func testAtImportSkipped() {
        let css = "@import url('base.css'); p { font-style: italic; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "p", classes: []).fontStyle, .italic)
    }

    // MARK: - Stylesheet Merging

    func testMergeStylesheetOverrides() {
        let css1 = "p { font-weight: normal; }"
        let css2 = "p { font-weight: bold; }"
        var sheet1 = CSSParser.parse(css1)
        let sheet2 = CSSParser.parse(css2)
        sheet1.merge(with: sheet2)
        XCTAssertEqual(sheet1.resolve(element: "p", classes: []).fontWeight, .bold)
    }

    func testMergeStylesheetPreservesNonOverlapping() {
        let css1 = "p { font-weight: bold; }"
        let css2 = "em { font-style: italic; }"
        var sheet1 = CSSParser.parse(css1)
        sheet1.merge(with: CSSParser.parse(css2))
        XCTAssertEqual(sheet1.resolve(element: "p", classes: []).fontWeight, .bold)
        XCTAssertEqual(sheet1.resolve(element: "em", classes: []).fontStyle, .italic)
    }

    func testMergeAccumulatesDescendantRules() {
        let css1 = ".a p { font-weight: bold; }"
        let css2 = ".b p { font-style: italic; }"
        var sheet1 = CSSParser.parse(css1)
        sheet1.merge(with: CSSParser.parse(css2))
        let ancestorA: [(tag: String, classes: [String])] = [("div", ["a"])]
        let ancestorB: [(tag: String, classes: [String])] = [("div", ["b"])]
        XCTAssertEqual(sheet1.resolve(element: "p", classes: [], ancestorStack: ancestorA).fontWeight, .bold)
        XCTAssertEqual(sheet1.resolve(element: "p", classes: [], ancestorStack: ancestorB).fontStyle, .italic)
    }

    // MARK: - CSSProperties Merging

    func testMergePropertiesOverridesNonNil() {
        var base = CSSProperties()
        base.fontWeight = .normal
        base.fontStyle = .normal

        var override = CSSProperties()
        override.fontWeight = .bold

        let merged = base.merging(with: override)
        XCTAssertEqual(merged.fontWeight, .bold)
        XCTAssertEqual(merged.fontStyle, .normal) // not overridden
    }

    func testMergePropertiesSkipsNil() {
        var base = CSSProperties()
        base.textAlign = .center

        let empty = CSSProperties()
        let merged = base.merging(with: empty)
        XCTAssertEqual(merged.textAlign, .center)
    }

    // MARK: - Edge Cases

    func testEmptyCSS() {
        let sheet = CSSParser.parse("")
        let props = sheet.resolve(element: "p", classes: [])
        XCTAssertEqual(props, CSSProperties.empty)
    }

    func testWhitespaceOnlyCSS() {
        let sheet = CSSParser.parse("   \n\t  ")
        XCTAssertEqual(sheet.resolve(element: "p", classes: []), CSSProperties.empty)
    }

    func testUnknownPropertyIgnored() {
        let css = "p { -webkit-hyphens: auto; font-weight: bold; }"
        let sheet = CSSParser.parse(css)
        XCTAssertEqual(sheet.resolve(element: "p", classes: []).fontWeight, .bold)
    }

    func testMultipleRulesForSameElement() {
        let css = "p { font-weight: bold; } p { font-style: italic; }"
        let sheet = CSSParser.parse(css)
        let props = sheet.resolve(element: "p", classes: [])
        XCTAssertEqual(props.fontWeight, .bold)
        XCTAssertEqual(props.fontStyle, .italic)
    }
}
