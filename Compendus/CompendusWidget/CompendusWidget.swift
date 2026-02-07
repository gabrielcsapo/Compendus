//
//  CompendusWidget.swift
//  CompendusWidget
//
//  Continue Reading widget showing the current book
//

import WidgetKit
import SwiftUI

// MARK: - Timeline Provider

struct ContinueReadingProvider: TimelineProvider {
    func placeholder(in context: Context) -> ContinueReadingEntry {
        ContinueReadingEntry(
            date: Date(),
            book: WidgetBook(
                id: "placeholder",
                title: "Book Title",
                author: "Author Name",
                format: "epub",
                progress: 0.45,
                coverData: nil,
                lastReadAt: Date()
            )
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (ContinueReadingEntry) -> Void) {
        let entry = ContinueReadingEntry(
            date: Date(),
            book: WidgetDataManager.shared.getCurrentBook()
        )
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ContinueReadingEntry>) -> Void) {
        let currentBook = WidgetDataManager.shared.getCurrentBook()
        let entry = ContinueReadingEntry(date: Date(), book: currentBook)

        // Refresh every 30 minutes
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 30, to: Date())!
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }
}

// MARK: - Timeline Entry

struct ContinueReadingEntry: TimelineEntry {
    let date: Date
    let book: WidgetBook?
}

// MARK: - Widget Views

struct ContinueReadingWidgetEntryView: View {
    var entry: ContinueReadingProvider.Entry
    @Environment(\.widgetFamily) var family

    var body: some View {
        if let book = entry.book {
            switch family {
            case .systemSmall:
                SmallWidgetView(book: book)
            case .systemMedium:
                MediumWidgetView(book: book)
            default:
                SmallWidgetView(book: book)
            }
        } else {
            EmptyWidgetView()
        }
    }
}

struct SmallWidgetView: View {
    let book: WidgetBook

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Cover or icon
            HStack {
                if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
                    Image(uiImage: uiImage)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: 50, height: 70)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                } else {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(Color.gray.opacity(0.3))
                        .frame(width: 50, height: 70)
                        .overlay {
                            Image(systemName: book.formatIcon)
                                .font(.title2)
                                .foregroundStyle(.secondary)
                        }
                }

                Spacer()
            }

            Spacer()

            // Title
            Text(book.title)
                .font(.caption)
                .fontWeight(.semibold)
                .lineLimit(2)

            // Progress
            HStack(spacing: 4) {
                ProgressView(value: book.progress)
                    .tint(.blue)

                Text("\(book.progressPercentage)%")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .widgetURL(URL(string: "compendus://book/\(book.id)"))
    }
}

struct MediumWidgetView: View {
    let book: WidgetBook

    var body: some View {
        HStack(spacing: 12) {
            // Cover
            if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 80, height: 110)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.gray.opacity(0.3))
                    .frame(width: 80, height: 110)
                    .overlay {
                        Image(systemName: book.formatIcon)
                            .font(.largeTitle)
                            .foregroundStyle(.secondary)
                    }
            }

            // Book info
            VStack(alignment: .leading, spacing: 6) {
                Text("Continue Reading")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .textCase(.uppercase)

                Text(book.title)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .lineLimit(2)

                Text(book.author)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                Spacer()

                // Progress bar
                VStack(alignment: .leading, spacing: 2) {
                    ProgressView(value: book.progress)
                        .tint(.blue)

                    Text("\(book.progressPercentage)% complete")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()
        }
        .widgetURL(URL(string: "compendus://book/\(book.id)"))
    }
}

struct EmptyWidgetView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "books.vertical")
                .font(.largeTitle)
                .foregroundStyle(.secondary)

            Text("No Recent Books")
                .font(.caption)
                .foregroundStyle(.secondary)

            Text("Open a book to continue reading")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
        }
    }
}

// MARK: - Widget Configuration

struct CompendusWidget: Widget {
    let kind: String = "ContinueReadingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ContinueReadingProvider()) { entry in
            ContinueReadingWidgetEntryView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("Continue Reading")
        .description("Quickly resume your current book.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

// MARK: - Previews

#Preview("Small", as: .systemSmall) {
    CompendusWidget()
} timeline: {
    ContinueReadingEntry(
        date: .now,
        book: WidgetBook(
            id: "1",
            title: "The Great Gatsby",
            author: "F. Scott Fitzgerald",
            format: "epub",
            progress: 0.45,
            coverData: nil,
            lastReadAt: Date()
        )
    )
}

#Preview("Medium", as: .systemMedium) {
    CompendusWidget()
} timeline: {
    ContinueReadingEntry(
        date: .now,
        book: WidgetBook(
            id: "1",
            title: "The Great Gatsby",
            author: "F. Scott Fitzgerald",
            format: "epub",
            progress: 0.45,
            coverData: nil,
            lastReadAt: Date()
        )
    )
}

#Preview("Empty", as: .systemSmall) {
    CompendusWidget()
} timeline: {
    ContinueReadingEntry(date: .now, book: nil)
}
