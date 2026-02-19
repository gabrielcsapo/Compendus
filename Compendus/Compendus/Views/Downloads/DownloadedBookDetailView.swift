//
//  DownloadedBookDetailView.swift
//  Compendus
//
//  Detail view for a downloaded book with read option
//

import SwiftUI
import SwiftData

struct DownloadedBookDetailView: View {
    let book: DownloadedBook

    @Environment(APIService.self) private var apiService
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(StorageManager.self) private var storageManager
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var bookToRead: DownloadedBook?
    @State private var showingDeleteConfirmation = false
    @State private var isDescriptionExpanded = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                heroCoverSection

                titleBlock
                    .padding(.top, 16)

                metadataRow
                    .padding(.top, 12)

                actionSection
                    .padding(.top, 20)
                    .padding(.horizontal, 20)

                if let description = book.bookDescription, !description.isEmpty {
                    descriptionSection(description)
                        .padding(.top, 24)
                        .padding(.horizontal, 20)
                }

                detailsCardSection
                    .padding(.top, 24)
                    .padding(.horizontal, 20)

                downloadInfoSection
                    .padding(.top, 24)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 40)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(role: .destructive) {
                    showingDeleteConfirmation = true
                } label: {
                    Image(systemName: "trash")
                }
            }
        }
        .confirmationDialog(
            "Delete Book?",
            isPresented: $showingDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                deleteBook()
            }
            Button("Cancel", role: .cancel) { }
        } message: {
            Text("This will remove \"\(book.title)\" from your device. You can download it again from your library.")
        }
        .fullScreenCover(item: $bookToRead) { bookToOpen in
            ReaderContainerView(book: bookToOpen)
                .environment(apiService)
                .environment(storageManager)
                .modelContext(modelContext)
        }
    }

    // MARK: - Hero Cover

    @ViewBuilder
    private var heroCoverSection: some View {
        VStack {
            if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 200)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .shadow(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
            } else {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.gray.opacity(0.2))
                    .aspectRatio(2/3, contentMode: .fit)
                    .frame(width: 200)
                    .overlay {
                        Image(systemName: "book.closed")
                            .font(.system(size: 48))
                            .foregroundStyle(.secondary)
                    }
                    .shadow(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 20)
        .background {
            heroCoverBackground
                .ignoresSafeArea(edges: .top)
        }
    }

    @ViewBuilder
    private var heroCoverBackground: some View {
        if let coverData = book.coverData, let uiImage = UIImage(data: coverData) {
            Image(uiImage: uiImage)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .blur(radius: 40)
                .overlay(Color(.systemBackground).opacity(0.6))
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: 0.6),
                            .init(color: .clear, location: 1.0)
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .clipped()
        } else {
            LinearGradient(
                colors: [Color(.systemGray5), Color(.systemBackground)],
                startPoint: .top,
                endPoint: .bottom
            )
        }
    }

    // MARK: - Title Block

    @ViewBuilder
    private var titleBlock: some View {
        VStack(spacing: 4) {
            Text(book.title)
                .font(.title2)
                .fontWeight(.bold)
                .multilineTextAlignment(.center)

            if let subtitle = book.subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Text(book.authorsDisplay)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Metadata Row

    @ViewBuilder
    private var metadataRow: some View {
        HStack(spacing: 12) {
            formatBadge

            if book.isAudiobook {
                if let duration = book.durationDisplay {
                    metadataLabel(icon: "clock", text: duration)
                }
                if let narrator = book.narrator {
                    metadataLabel(icon: "person.wave.2", text: narrator)
                }
            } else if let pageCount = book.pageCount {
                metadataLabel(icon: "doc.text", text: "\(pageCount) pages")
            }

            metadataLabel(icon: nil, text: book.fileSizeDisplay)
        }
        .padding(.horizontal, 20)
    }

    @ViewBuilder
    private func metadataLabel(icon: String?, text: String) -> some View {
        HStack(spacing: 4) {
            if let icon {
                Image(systemName: icon)
                    .font(.caption2)
            }
            Text(text)
                .font(.caption)
        }
        .foregroundStyle(.secondary)
    }

    // MARK: - Action Section

    @ViewBuilder
    private var actionSection: some View {
        VStack(spacing: 10) {
            Button {
                bookToRead = book
            } label: {
                Label(readButtonTitle, systemImage: readButtonIcon)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)

            if book.readingProgress > 0 && book.readingProgress < 1.0 {
                VStack(spacing: 4) {
                    ProgressView(value: book.readingProgress)
                        .tint(.accentColor)

                    HStack {
                        if let pageCount = book.pageCount, pageCount > 0 {
                            let currentPage = Int(book.readingProgress * Double(pageCount))
                            Text("Page \(currentPage) of \(pageCount)")
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            Text("·")
                                .font(.caption)
                                .foregroundStyle(.tertiary)

                            Text("\(pageCount - currentPage) pages left")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Text("\(Int(book.readingProgress * 100))% complete")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        if let lastRead = book.lastReadAt {
                            Text("Last read \(lastRead.formatted(.relative(presentation: .named)))")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                    }
                }
            }
        }
    }

    private var readButtonTitle: String {
        if book.readingProgress >= 1.0 {
            return "Read Again"
        } else if book.readingProgress > 0 {
            return "Continue Reading"
        } else {
            return "Read"
        }
    }

    private var readButtonIcon: String {
        if book.readingProgress >= 1.0 {
            return "arrow.counterclockwise"
        } else {
            return "book.fill"
        }
    }

    // MARK: - Description

    @ViewBuilder
    private func descriptionSection(_ description: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(description)
                .font(.body)
                .foregroundStyle(.secondary)
                .lineLimit(isDescriptionExpanded ? nil : 3)

            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isDescriptionExpanded.toggle()
                }
            } label: {
                Text(isDescriptionExpanded ? "Less" : "More")
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Details Card

    @ViewBuilder
    private var detailsCardSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Details")
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                detailsGrid
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(.separator, lineWidth: 0.5)
                    }
            }
        }
    }

    // MARK: - Download Info

    @ViewBuilder
    private var downloadInfoSection: some View {
        HStack {
            Label(
                "Downloaded \(book.downloadedAt.formatted(date: .abbreviated, time: .omitted))",
                systemImage: "arrow.down.circle"
            )
            .font(.caption)
            .foregroundStyle(.tertiary)

            Spacer()

            Text(book.fileSizeDisplay)
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    // MARK: - Components

    @ViewBuilder
    private var formatBadge: some View {
        Text(book.formatDisplay)
            .font(.caption)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(formatColor.opacity(0.2))
            .foregroundStyle(formatColor)
            .clipShape(Capsule())
    }

    private var formatColor: Color {
        switch book.format.lowercased() {
        case "epub":
            return .blue
        case "pdf":
            return .red
        case "mobi", "azw", "azw3":
            return .orange
        case "cbr", "cbz":
            return .purple
        case "m4b", "mp3", "m4a":
            return .green
        default:
            return .gray
        }
    }

    @ViewBuilder
    private var detailsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 8) {
            if let publisher = book.publisher {
                DetailRow(label: "Publisher", value: publisher)
            }
            if let publishedDate = book.publishedDate {
                DetailRow(label: "Published", value: publishedDate)
            }
            if let series = book.series {
                let value = book.seriesNumber != nil ? "\(series) #\(Int(book.seriesNumber!))" : series
                DetailRow(label: "Series", value: value)
            }
        }
    }

    private func deleteBook() {
        do {
            try downloadManager.deleteBook(book, modelContext: modelContext)
            dismiss()
        } catch {
            // Handle error silently
        }
    }
}

#Preview {
    let book = DownloadedBook(
        id: "1",
        title: "Sample Book",
        subtitle: "A Subtitle",
        authors: ["Author Name"],
        publisher: "Publisher Name",
        publishedDate: "2024",
        bookDescription: "This is a sample book description.",
        format: "epub",
        fileSize: 1024000,
        localPath: "books/1.epub",
        series: "Sample Series",
        seriesNumber: 1
    )

    NavigationStack {
        DownloadedBookDetailView(book: book)
    }
    .environment(APIService(config: ServerConfig()))
    .environment(DownloadManager(config: ServerConfig(), apiService: APIService(config: ServerConfig())))
    .environment(StorageManager())
    .modelContainer(for: DownloadedBook.self, inMemory: true)
}
