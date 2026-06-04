//
//  CCDContentMapper.swift
//  Compendus
//
//  Bridges decoded CCD blocks → the existing `ContentNode` AST, so the rest of
//  the native pipeline (AttributedStringBuilder → TextKit pagination) is reused
//  unchanged. This REPLACES XHTMLContentParser as the source of [ContentNode]:
//  parsing now happens once on the server, not per-open on device.
//
//  Degradations vs. the full CCD model (first cut — extend ContentNode later to
//  render these natively): inline `ruby` keeps the base reading text (furigana
//  dropped); `math` renders its TeX/MathML source as a code run; `verse` renders
//  one paragraph per line; `definitionList` renders bold term + definition
//  blocks; `pageBreak`/`foreign` are skipped.
//

import UIKit

public enum CCDContentMapper {
    /// Map one chapter's blocks to ContentNodes. `resolveResource` turns a CCD
    /// resource handle (image/media path) into a loadable URL.
    public static func nodes(for chapter: CCDChapter, resolveResource: (String) -> URL?) -> [ContentNode] {
        chapter.blocks.flatMap { mapBlock($0, resolveResource) }
    }

    /// Map a standalone list of blocks (e.g. a footnote body) to ContentNodes.
    public static func nodes(forBlocks blocks: [CCDBlock], resolveResource: (String) -> URL?) -> [ContentNode] {
        blocks.flatMap { mapBlock($0, resolveResource) }
    }

    private static func mapBlocks(_ blocks: [CCDBlock], _ res: (String) -> URL?) -> [ContentNode] {
        blocks.flatMap { mapBlock($0, res) }
    }

    private static func mapBlock(_ b: CCDBlock, _ res: (String) -> URL?) -> [ContentNode] {
        switch b.t {
        case "paragraph":
            return [.paragraph(runs: mapInlines(b.inlines ?? []), blockStyle: mapStyle(b.style))]
        case "heading":
            return [.heading(level: b.level ?? 1, runs: mapInlines(b.inlines ?? []), blockStyle: mapStyle(b.style))]
        case "blockquote":
            return [.blockquote(children: mapBlocks(b.children ?? [], res))]
        case "container":
            return [.container(children: mapBlocks(b.children ?? [], res), blockStyle: mapStyle(b.style))]
        case "list":
            return [.list(ordered: b.ordered ?? false,
                          items: (b.listItems ?? []).map { ListItem(children: mapBlocks($0, res)) },
                          blockStyle: mapStyle(b.style))]
        case "definitionList":
            var out: [ContentNode] = []
            for it in b.defItems ?? [] {
                let term = mapInlines(it.term).map { r -> TextRun in var t = r; t.styles.insert(.bold); return t }
                out.append(.paragraph(runs: term, blockStyle: .empty))
                out.append(contentsOf: mapBlocks(it.definition, res))
            }
            return [.container(children: out, blockStyle: .empty)]
        case "verse":
            let lines = (b.lines ?? []).map { ContentNode.paragraph(runs: mapInlines($0.inlines), blockStyle: .empty) }
            return [.container(children: lines, blockStyle: .empty)]
        case "code":
            return [.codeBlock(text: b.text ?? "")]
        case "thematicBreak":
            return [.horizontalRule]
        case "table":
            let rows = (b.rows ?? []).map { row in
                TableRow(cells: row.cells.map { cell in
                    TableCell(isHeader: cell.header, runs: runsFromBlocks(cell.blocks),
                              colspan: cell.colspan ?? 1, rowspan: cell.rowspan ?? 1)
                })
            }
            return [.table(rows: rows)]
        case "image":
            guard let url = res(b.resource ?? "") else { return [] }
            var style = MediaStyle.empty
            if b.float == "start" { style.cssFloat = .left } else if b.float == "end" { style.cssFloat = .right }
            if let pct = b.widthPct { style.cssWidth = .percent(CGFloat(pct)) }
            var nodes: [ContentNode] = [.image(url: url, alt: b.alt, width: nil, height: nil, style: style)]
            if let cap = b.caption { nodes.append(contentsOf: mapBlocks(cap, res)) }
            return nodes
        case "embed":
            guard let url = res(b.resource ?? "") else { return [] }
            return b.kind == "audio" ? [.audio(url: url, style: .empty)] : [.video(url: url, poster: nil, style: .empty)]
        case "math":
            // Degraded: render the math source as a code run until ContentNode gains a math case.
            let src = b.tex ?? b.mathml ?? ""
            return src.isEmpty ? [] : [.paragraph(runs: [TextRun(text: src, styles: [.code])], blockStyle: .empty)]
        case "pageBreak", "foreign":
            return []
        default:
            return []
        }
    }

    // MARK: - Inlines

    private static func mapInlines(_ inlines: [CCDInline]) -> [TextRun] {
        var runs: [TextRun] = []
        for i in inlines {
            switch i.t {
            case "br":
                runs.append(TextRun(text: "\n"))
            case "ruby":
                runs.append(TextRun(text: i.base ?? ""))   // base = reading text; furigana dropped (degraded)
            case "math":
                let s = i.tex ?? i.mathml ?? ""
                if !s.isEmpty { runs.append(TextRun(text: s, styles: [.code])) }
            case "span":
                runs.append(mapSpan(i))
            default:
                break
            }
        }
        return runs
    }

    private static func mapSpan(_ s: CCDInline) -> TextRun {
        var styles: Set<TextStyle> = []
        var link: URL?
        var color: UIColor?
        var family: String?
        var scale: CGFloat?
        let defs = Dictionary(uniqueKeysWithValues: (s.markDefs ?? []).map { ($0.key, $0) })
        for m in s.marks ?? [] {
            switch m {
            case "strong": styles.insert(.bold)
            case "em": styles.insert(.italic)
            case "code": styles.insert(.code)
            case "sup": styles.insert(.superscript)
            case "sub": styles.insert(.subscript)
            case "underline": styles.insert(.underline)
            case "strike": styles.insert(.strikethrough)
            case "smallCaps": styles.insert(.smallCaps)
            case "allCaps": styles.insert(.uppercase)
            default:
                if let d = defs[m] {
                    switch d.t {
                    case "link": link = d.href.flatMap { URL(string: $0) }
                    case "noteRef": styles.insert(.footnoteRef); link = d.noteId.flatMap { URL(string: "#\($0)") }
                    case "color": color = d.value.flatMap { UIColor(ccdHex: $0) }
                    case "font": family = d.family; scale = d.scale.map { CGFloat($0) }
                    default: break
                    }
                }
            }
        }
        return TextRun(text: s.text ?? "", styles: styles, link: link, textColor: color, fontFamily: family, fontSizeScale: scale)
    }

    /// Flatten a cell's block content to inline runs (ContentNode table cells are inline-only).
    private static func runsFromBlocks(_ blocks: [CCDBlock]) -> [TextRun] {
        var runs: [TextRun] = []
        for b in blocks {
            switch b.t {
            case "paragraph", "heading": runs.append(contentsOf: mapInlines(b.inlines ?? []))
            case "blockquote", "container": runs.append(contentsOf: runsFromBlocks(b.children ?? []))
            case "list": for it in b.listItems ?? [] { runs.append(contentsOf: runsFromBlocks(it)) }
            default: break
            }
            runs.append(TextRun(text: "\n"))
        }
        return runs
    }

    // MARK: - Style

    private static func mapStyle(_ s: CCDStyle?) -> BlockStyle {
        guard let s else { return .empty }
        var bs = BlockStyle.empty
        switch s.align {
        case "center": bs.textAlign = .center
        case "end", "right": bs.textAlign = .right
        case "justify": bs.textAlign = .justify
        case "start", "left": bs.textAlign = .left
        default: break
        }
        if let indent = s.indent { bs.textIndent = .em(CGFloat(indent)) }
        if let sb = s.spaceBefore { bs.marginTop = .em(CGFloat(sb)) }
        if let sa = s.spaceAfter { bs.marginBottom = .em(CGFloat(sa)) }
        if s.direction == "rtl" { bs.writingDirection = .rightToLeft }
        return bs
    }
}

private extension UIColor {
    /// Parse #rrggbb / #rrggbbaa.
    convenience init?(ccdHex: String) {
        var h = ccdHex.trimmingCharacters(in: .whitespaces)
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6 || h.count == 8, let v = UInt64(h, radix: 16) else { return nil }
        let r, g, b, a: CGFloat
        if h.count == 8 {
            r = CGFloat((v >> 24) & 0xff) / 255; g = CGFloat((v >> 16) & 0xff) / 255
            b = CGFloat((v >> 8) & 0xff) / 255; a = CGFloat(v & 0xff) / 255
        } else {
            r = CGFloat((v >> 16) & 0xff) / 255; g = CGFloat((v >> 8) & 0xff) / 255
            b = CGFloat(v & 0xff) / 255; a = 1
        }
        self.init(red: r, green: g, blue: b, alpha: a)
    }
}
