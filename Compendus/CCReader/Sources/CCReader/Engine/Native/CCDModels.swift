//
//  CCDModels.swift
//  Compendus
//
//  Codable models for the Compendus Content Document (CCD) bundle — the
//  canonical, server-produced content format the reader now consumes instead
//  of parsing EPUB XHTML on-device. Mirrors app/lib/content-ast/types.ts.
//
//  Decoding uses flat structs (optional fields keyed by the node's `t` tag)
//  rather than enums, because Swift's synthesized Codable can't express the
//  tagged unions cleanly — and `list`/`definitionList` reuse the `items` key
//  with different shapes, so CCDBlock has a custom decoder.
//

import Foundation

public struct CCDBundle: Decodable {
    public let ccdVersion: String
    public let bookId: String
    public let sourceFormat: String
    public let readingOrder: [CCDChapterRef]
    public let toc: [CCDTocEntry]
    public let totalVirtual: Int
    public let isFixedLayout: Bool?
    public let writingMode: String?
    public let chapters: [CCDChapter]
}

public struct CCDChapterRef: Decodable {
    public let id: String
    public let title: String?
    public let spineIndex: Int
    public let virtualStart: Int
    public let virtualLength: Int
}

public struct CCDTocEntry: Decodable {
    public let title: String
    public let spineIndex: Int
    public let blockId: String?
    public let level: Int?
    public let children: [CCDTocEntry]?
}

public struct CCDChapter: Decodable {
    public let id: String
    /// In-EPUB href for this chapter (used for internal-link resolution). Optional
    /// because not all bundle versions emit it.
    public let href: String?
    public let spineIndex: Int
    public let role: String?
    public let writingMode: String?
    public let lang: String?
    public let blocks: [CCDBlock]
    public let notes: [String: [CCDBlock]]?
    public let virtualStart: Int
    public let virtualLength: Int
}

public struct CCDStyle: Decodable {
    public let align: String?
    public let indent: Double?
    public let spaceBefore: Double?
    public let spaceAfter: Double?
    public let direction: String?
    public let dropCap: Bool?
}

public struct CCDDefItem: Decodable {
    public let term: [CCDInline]
    public let definition: [CCDBlock]
}

public struct CCDVerseLine: Decodable {
    public let inlines: [CCDInline]
    public let indent: Double?
}

public struct CCDCell: Decodable {
    public let header: Bool
    public let blocks: [CCDBlock]
    public let colspan: Int?
    public let rowspan: Int?
}
public struct CCDRow: Decodable { public let cells: [CCDCell] }

/// One block node. Only the fields relevant to the node's `t` are populated.
public struct CCDBlock: Decodable {
    public let t: String
    public let id: String?
    public let style: CCDStyle?
    public let lang: String?
    public let dir: String?
    public let role: String?
    public let level: Int?
    public let inlines: [CCDInline]?
    public let children: [CCDBlock]?
    public let listItems: [[CCDBlock]]?     // list
    public let defItems: [CCDDefItem]?      // definitionList
    public let ordered: Bool?
    public let start: Int?
    public let rows: [CCDRow]?
    public let caption: [CCDBlock]?
    public let resource: String?
    public let alt: String?
    public let float: String?
    public let widthPct: Double?
    public let kind: String?                // embed
    public let lines: [CCDVerseLine]?       // verse
    public let label: String?               // pageBreak
    public let text: String?                // code
    public let tex: String?
    public let mathml: String?
    public let html: String?                // foreign

    private enum CodingKeys: String, CodingKey {
        case t, id, style, lang, dir, role, level, inlines, children, items, ordered,
             start, rows, caption, resource, alt, float, widthPct, kind, lines, label, text, tex, mathml, html
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        t = try c.decode(String.self, forKey: .t)
        id = try c.decodeIfPresent(String.self, forKey: .id)
        style = try c.decodeIfPresent(CCDStyle.self, forKey: .style)
        lang = try c.decodeIfPresent(String.self, forKey: .lang)
        dir = try c.decodeIfPresent(String.self, forKey: .dir)
        role = try c.decodeIfPresent(String.self, forKey: .role)
        level = try c.decodeIfPresent(Int.self, forKey: .level)
        inlines = try c.decodeIfPresent([CCDInline].self, forKey: .inlines)
        children = try c.decodeIfPresent([CCDBlock].self, forKey: .children)
        ordered = try c.decodeIfPresent(Bool.self, forKey: .ordered)
        start = try c.decodeIfPresent(Int.self, forKey: .start)
        rows = try c.decodeIfPresent([CCDRow].self, forKey: .rows)
        caption = try c.decodeIfPresent([CCDBlock].self, forKey: .caption)
        resource = try c.decodeIfPresent(String.self, forKey: .resource)
        alt = try c.decodeIfPresent(String.self, forKey: .alt)
        float = try c.decodeIfPresent(String.self, forKey: .float)
        widthPct = try c.decodeIfPresent(Double.self, forKey: .widthPct)
        kind = try c.decodeIfPresent(String.self, forKey: .kind)
        lines = try c.decodeIfPresent([CCDVerseLine].self, forKey: .lines)
        label = try c.decodeIfPresent(String.self, forKey: .label)
        text = try c.decodeIfPresent(String.self, forKey: .text)
        tex = try c.decodeIfPresent(String.self, forKey: .tex)
        mathml = try c.decodeIfPresent(String.self, forKey: .mathml)
        html = try c.decodeIfPresent(String.self, forKey: .html)
        // `items` is [[CCDBlock]] for list, [CCDDefItem] for definitionList.
        if t == "definitionList" {
            listItems = nil
            defItems = try c.decodeIfPresent([CCDDefItem].self, forKey: .items)
        } else {
            defItems = nil
            listItems = try c.decodeIfPresent([[CCDBlock]].self, forKey: .items)
        }
    }
}

/// One inline node. `t` is "span" | "br" | "math" | "ruby".
public struct CCDInline: Decodable {
    public let t: String
    public let text: String?
    public let marks: [String]?
    public let markDefs: [CCDMarkDef]?
    public let lang: String?
    public let base: String?    // ruby
    public let tex: String?     // math
    public let mathml: String?  // math
}

public struct CCDMarkDef: Decodable {
    public let key: String
    public let t: String
    public let href: String?
    public let target: String?
    public let noteId: String?
    public let value: String?   // color
    public let family: String?  // font
    public let scale: Double?   // font
}

public extension CCDBundle {
    static func decode(from data: Data) throws -> CCDBundle {
        try JSONDecoder().decode(CCDBundle.self, from: data)
    }
}
