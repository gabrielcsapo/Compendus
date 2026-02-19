//
//  CompendusWidget.swift
//  CompendusWidget
//
//  Continue Reading widget showing the current book
//

import WidgetKit
import SwiftUI

// MARK: - Color Extraction

extension UIImage {
    /// Extracts the most prominent color by sampling and finding the most common color bucket
    func prominentColor() -> Color {
        guard let cgImage = self.cgImage else { return Color(.systemGray4) }

        let sampleSize = 20
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let bitmapInfo = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)

        guard let context = CGContext(
            data: nil,
            width: sampleSize,
            height: sampleSize,
            bitsPerComponent: 8,
            bytesPerRow: sampleSize * 4,
            space: colorSpace,
            bitmapInfo: bitmapInfo.rawValue
        ) else { return Color(.systemGray4) }

        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: sampleSize, height: sampleSize))

        guard let data = context.data else { return Color(.systemGray4) }

        let pointer = data.bindMemory(to: UInt8.self, capacity: sampleSize * sampleSize * 4)

        // Bucket colors into a 4x4x4 grid (64 buckets) to find the most common
        var buckets: [Int: (count: Int, r: Double, g: Double, b: Double)] = [:]

        for i in 0..<(sampleSize * sampleSize) {
            let offset = i * 4
            let r = Double(pointer[offset])
            let g = Double(pointer[offset + 1])
            let b = Double(pointer[offset + 2])

            // Skip very dark and very light pixels (backgrounds/borders)
            let brightness = (r + g + b) / 3.0
            if brightness < 30 || brightness > 230 { continue }

            let bucketR = Int(r / 64)
            let bucketG = Int(g / 64)
            let bucketB = Int(b / 64)
            let key = bucketR * 16 + bucketG * 4 + bucketB

            if var bucket = buckets[key] {
                bucket.count += 1
                bucket.r += r
                bucket.g += g
                bucket.b += b
                buckets[key] = bucket
            } else {
                buckets[key] = (count: 1, r: r, g: g, b: b)
            }
        }

        // Find the most common bucket
        guard let dominant = buckets.values.max(by: { $0.count < $1.count }) else {
            return Color(.systemGray4)
        }

        let avgR = dominant.r / Double(dominant.count) / 255.0
        let avgG = dominant.g / Double(dominant.count) / 255.0
        let avgB = dominant.b / Double(dominant.count) / 255.0

        return Color(red: avgR, green: avgG, blue: avgB)
    }
}

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

    private var coverImage: UIImage? {
        if let data = book.coverData {
            return UIImage(data: data)
        }
        return nil
    }

    private var backgroundColor: Color {
        coverImage?.prominentColor() ?? Color(.systemGray4)
    }

    var body: some View {
        ZStack {
            // Full-bleed cover image as background
            if let uiImage = coverImage {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                // Fallback gradient background
                LinearGradient(
                    colors: [Color(.systemGray5), Color(.systemGray3)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .overlay {
                    Image(systemName: book.formatIcon)
                        .font(.system(size: 40))
                        .foregroundStyle(.white.opacity(0.3))
                }
            }

            // Gradient overlay for text readability
            VStack {
                Spacer()
                LinearGradient(
                    colors: [.clear, .black.opacity(0.8)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 80)
            }

            // Overlaid text
            VStack(alignment: .leading, spacing: 4) {
                Spacer()

                Text(book.title)
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .shadow(color: .black.opacity(0.3), radius: 2, x: 0, y: 1)

                HStack(spacing: 4) {
                    ProgressView(value: book.progress)
                        .tint(.white)

                    Text("\(book.progressPercentage)%")
                        .font(.caption2)
                        .fontWeight(.medium)
                        .foregroundStyle(.white.opacity(0.9))
                }
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 20)
            .padding(.top, 12)
        }
        .widgetURL(URL(string: "compendus://book/\(book.id)"))
        .containerBackground(for: .widget) {
            backgroundColor
        }
    }
}

struct MediumWidgetView: View {
    let book: WidgetBook

    private var coverImage: UIImage? {
        if let data = book.coverData {
            return UIImage(data: data)
        }
        return nil
    }

    private var dominantColor: Color {
        coverImage?.prominentColor() ?? Color(.systemGray4)
    }

    var body: some View {
        HStack(spacing: 0) {
            // Book info
            VStack(alignment: .leading, spacing: 4) {
                Text("Continue Reading")
                    .font(.caption2)
                    .fontWeight(.medium)
                    .foregroundStyle(.white.opacity(0.8))
                    .textCase(.uppercase)

                Text(book.title)
                    .font(.subheadline)
                    .fontWeight(.bold)
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .shadow(color: .black.opacity(0.2), radius: 1, x: 0, y: 1)

                Text(book.author)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.8))
                    .lineLimit(1)

                Spacer()

                // Progress bar
                VStack(alignment: .leading, spacing: 2) {
                    ProgressView(value: book.progress)
                        .tint(.white)

                    Text("\(book.progressPercentage)% complete")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.7))
                }
            }

            Spacer()

            // Cover in the corner
            if let uiImage = coverImage {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 70, height: 100)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)
            } else {
                RoundedRectangle(cornerRadius: 8)
                    .fill(.white.opacity(0.15))
                    .frame(width: 70, height: 100)
                    .overlay {
                        Image(systemName: book.formatIcon)
                            .font(.title2)
                            .foregroundStyle(.white.opacity(0.5))
                    }
            }
        }
        .widgetURL(URL(string: "compendus://book/\(book.id)"))
        .containerBackground(for: .widget) {
            dominantColor
        }
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
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

// MARK: - Widget Configuration

struct CompendusWidget: Widget {
    let kind: String = "ContinueReadingWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ContinueReadingProvider()) { entry in
            ContinueReadingWidgetEntryView(entry: entry)
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
