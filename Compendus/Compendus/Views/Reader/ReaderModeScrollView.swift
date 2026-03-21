//
//  ReaderModeScrollView.swift
//  Compendus
//
//  Infinite scroll reader mode for EPUBs. Displays all book text as
//  a continuous scroll with chapter headers and page position indicator.
//  Replaces the paginated engine view when active.
//

import SwiftUI
import EPUBReader

struct ReaderModeScrollView: View {
    struct Segment: Identifiable {
        let id: Int
        let text: String
        let chapterTitle: String?
        let isChapterStart: Bool
        let pageNumber: Int
    }

    let segments: [Segment]
    let totalPages: Int
    let initialSegment: Int
    var onActiveSegmentChanged: ((Int) -> Void)?
    /// Called when the user taps a non-scrolling zone (top/bottom edges) to toggle the toolbar.
    var onToggleOverlay: (() -> Void)?

    @Environment(ReaderSettings.self) private var readerSettings
    @State private var activeSegmentIndex: Int = -1

    /// Height reserved at the top for the toolbar tap zone.
    private let topInset: CGFloat = 60
    /// Height reserved at the bottom for the page info bar + tap zone.
    private let bottomInset: CGFloat = 60

    private var readerFont: Font {
        let size = readerSettings.fontSize
        let name = readerSettings.fontFamily.previewFontName
        if name == ".AppleSystemUIFont" {
            return .system(size: size)
        }
        return .custom(name, size: size)
    }

    private var themeBackground: Color {
        Color(uiColor: readerSettings.theme.backgroundColor)
    }

    private var themeText: Color {
        Color(uiColor: readerSettings.theme.textColor)
    }

    var body: some View {
        GeometryReader { geometry in
            // Center of the visible reading area (between top and bottom insets)
            let visibleHeight = geometry.size.height - topInset - bottomInset
            let centerY = topInset + visibleHeight / 2

            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    LazyVStack(alignment: .leading, spacing: 16) {
                        Spacer()
                            .frame(height: max(0, visibleHeight / 2 - 60))
                            .id("top-spacer")

                        ForEach(segments) { segment in
                            let isActive = segment.id == activeSegmentIndex

                            VStack(alignment: .leading, spacing: 0) {
                                if segment.isChapterStart {
                                    if segment.id > 0 {
                                        Divider()
                                            .padding(.vertical, 20)
                                    }
                                    if let title = segment.chapterTitle {
                                        Text(title)
                                            .font(.title2.weight(.bold))
                                            .foregroundStyle(themeText)
                                            .padding(.bottom, 12)
                                    }
                                }

                                Text(segment.text)
                                    .font(readerFont)
                                    .fontWeight(isActive ? .medium : .regular)
                                    .lineSpacing(CGFloat(readerSettings.lineHeight - 1.0) * readerSettings.fontSize)
                                    .foregroundStyle(themeText.opacity(isActive ? 1.0 : 0.3))
                            }
                            .id(segment.id)
                            .animation(.easeInOut(duration: 0.25), value: activeSegmentIndex)
                            .onGeometryChange(for: CGFloat.self) { proxy in
                                proxy.frame(in: .global).midY
                            } action: { midY in
                                let distance = abs(midY - centerY)
                                if distance < 40 {
                                    activeSegmentIndex = segment.id
                                }
                            }
                            .onTapGesture {
                                activeSegmentIndex = segment.id
                            }
                        }

                        Spacer()
                            .frame(height: max(0, visibleHeight / 2 - 60))
                            .id("bottom-spacer")
                    }
                    .padding(.horizontal, 24)
                }
                .safeAreaInset(edge: .top, spacing: 0) {
                    Color.clear
                        .frame(height: topInset)
                        .contentShape(Rectangle())
                        .onTapGesture { onToggleOverlay?() }
                }
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    VStack(spacing: 0) {
                        pageInfoBar
                        Color.clear
                            .frame(height: 16)
                            .contentShape(Rectangle())
                            .onTapGesture { onToggleOverlay?() }
                    }
                }
                .onAppear {
                    if initialSegment > 0 {
                        proxy.scrollTo(initialSegment, anchor: .center)
                    }
                }
            }
        }
        .background(themeBackground)
        .onChange(of: activeSegmentIndex) { _, newIndex in
            guard newIndex >= 0 else { return }
            onActiveSegmentChanged?(newIndex)
        }
        .onAppear {
            activeSegmentIndex = initialSegment
        }
    }

    @ViewBuilder
    private var pageInfoBar: some View {
        let activeSegment = activeSegmentIndex >= 0 && activeSegmentIndex < segments.count
            ? segments[activeSegmentIndex]
            : nil

        if let seg = activeSegment {
            HStack(spacing: 8) {
                if let chapter = seg.chapterTitle ?? currentChapterTitle {
                    Text(chapter)
                        .lineLimit(1)
                }
                Text("\u{00B7}")
                Text("Page \(seg.pageNumber + 1) of \(totalPages)")
                    .monospacedDigit()
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(.ultraThinMaterial, in: Capsule())
        }
    }

    /// Walk back from active segment to find the most recent chapter title.
    private var currentChapterTitle: String? {
        guard activeSegmentIndex >= 0 else { return nil }
        for i in stride(from: activeSegmentIndex, through: 0, by: -1) {
            if let title = segments[i].chapterTitle {
                return title
            }
        }
        return nil
    }
}
