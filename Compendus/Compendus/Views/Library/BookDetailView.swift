//
//  BookDetailView.swift
//  Compendus
//
//  Detailed view of a book with download option
//

import SwiftUI
import SwiftData
import EPUBReader

struct BookDetailView: View {
    let book: Book
    var onRead: ((DownloadedBook) -> Void)?
    var onSeriesTap: ((String) -> Void)?
    var onBookTap: ((Book) -> Void)?

    @Environment(APIService.self) private var apiService
    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(StorageManager.self) private var storageManager
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var isDownloading = false
    @State private var isDownloaded = false
    @State private var downloadError: String?
    @State private var showingError = false
    @State private var downloadedBook: DownloadedBook?
    @State private var bookToRead: DownloadedBook?
    @State private var isDescriptionExpanded = false

    @State private var readAsEpub = false
    @State private var isDownloadingEpub = false
    @State private var isLoadingAudiobook = false
    @State private var relatedBooks: [Book] = []
    @State private var isLoadingRelated = true
    @State private var showingEditSheet = false
    @State private var editedBook: Book?

    /// Use edited version of the book if available
    private var displayBook: Book {
        editedBook ?? book
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 0) {
                    heroCoverSection

                    titleBlock
                        .padding(.top, 16)

                    metadataRow
                        .padding(.top, 12)

                    VStack(spacing: 12) {
                        actionButton
                        epubReadingOption
                    }
                    .padding(.top, 20)
                    .padding(.horizontal, 20)

                    if let description = displayBook.description, !description.isEmpty {
                        descriptionSection(description)
                            .padding(.top, 24)
                            .padding(.horizontal, 20)
                    }

                    detailsCardSection
                        .padding(.top, 24)
                        .padding(.horizontal, 20)

                    if displayBook.isAudiobook, let chapters = displayBook.chapters, !chapters.isEmpty {
                        chaptersSection(chapters)
                            .padding(.top, 24)
                            .padding(.horizontal, 20)
                    }

                    relatedBooksContent
                        .padding(.top, 24)
                        .padding(.horizontal, 20)
                }
                .padding(.bottom, 40)
            }
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(.hidden, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showingEditSheet = true
                    } label: {
                        Image(systemName: "pencil")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .sheet(isPresented: $showingEditSheet) {
                EditBookView(book: displayBook) { updatedBook in
                    editedBook = updatedBook
                }
            }
            .task {
                checkIfDownloaded()
                await loadRelatedBooks()
            }
            .onChange(of: downloadManager.activeDownloads[book.id]?.state.isCompleted) { _, completed in
                if completed == true {
                    checkIfDownloaded()
                    isDownloading = false
                }
            }
            .alert("Download Failed", isPresented: $showingError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(downloadError ?? "An error occurred while downloading the book.")
            }
            .fullScreenCover(item: $bookToRead) { book in
                ReaderContainerView(book: book, preferEpub: readAsEpub)
                    .environment(apiService)
                    .environment(storageManager)
                    .environment(readerSettings)
                    .modelContext(modelContext)
            }
            .onChange(of: bookToRead) { _, newValue in
                if newValue == nil {
                    readAsEpub = false
                }
            }
        }
    }

    // MARK: - Hero Cover

    @ViewBuilder
    private var heroCoverSection: some View {
        VStack {
            CachedCoverImage(bookId: book.id, hasCover: book.coverUrl != nil, format: book.format, useThumbnail: false)
                .aspectRatio(2/3, contentMode: .fit)
                .frame(width: 200)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .shadow(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
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
        if book.coverUrl != nil {
            CachedCoverImage(bookId: book.id, hasCover: true, format: book.format)
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
            neutralGradientBackground
        }
    }

    private var neutralGradientBackground: some View {
        LinearGradient(
            colors: [Color(.systemGray5), Color(.systemBackground)],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    // MARK: - Title Block

    @ViewBuilder
    private var titleBlock: some View {
        VStack(spacing: 4) {
            Text(displayBook.title)
                .font(.title2)
                .fontWeight(.bold)
                .multilineTextAlignment(.center)

            if let subtitle = displayBook.subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            Text(displayBook.authorsDisplay)
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

            if displayBook.isAudiobook {
                if let duration = displayBook.durationDisplay {
                    metadataLabel(icon: "clock", text: duration)
                }
                if let narrator = displayBook.narrator {
                    metadataLabel(icon: "person.wave.2", text: narrator)
                }
            } else if let pageCount = displayBook.pageCount {
                metadataLabel(icon: "doc.text", text: "\(pageCount) pages")
            }

            metadataLabel(icon: nil, text: displayBook.fileSizeDisplay)
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

    // MARK: - Action Button

    @ViewBuilder
    private var actionButton: some View {
        AnimatedDownloadButton(
            state: downloadButtonState,
            isAudiobook: book.isAudiobook,
            onTap: {
                if isDownloaded, let downloaded = downloadedBook {
                    if downloaded.isAudiobook {
                        isLoadingAudiobook = true
                        Task {
                            await audiobookPlayer.loadBook(downloaded)
                            audiobookPlayer.isFullPlayerPresented = true
                            isLoadingAudiobook = false
                            dismiss()
                        }
                    } else if let onRead {
                        // Dismiss sheet and let parent present the reader full-screen
                        dismiss()
                        onRead(downloaded)
                    } else {
                        // Fallback: present locally
                        if ["mobi", "azw", "azw3"].contains(book.format.lowercased()),
                           downloaded.hasEpubVersion {
                            readAsEpub = true
                        }
                        bookToRead = downloaded
                    }
                } else {
                    downloadBook()
                }
            },
            onCancel: {
                downloadManager.cancelDownload(bookId: book.id)
                isDownloading = false
            }
        )
    }

    /// Secondary option shown for downloaded PDFs when the server has a converted EPUB available.
    @ViewBuilder
    private var epubReadingOption: some View {
        let isPdf = book.format.lowercased() == "pdf"
        let serverHasEpub = book.hasEpubVersion
        if isPdf && isDownloaded && serverHasEpub, let downloaded = downloadedBook {
            if downloaded.hasEpubVersion {
                // EPUB already downloaded locally — offer direct read
                Button {
                    readAsEpub = true
                    bookToRead = downloaded
                } label: {
                    Label(
                        "Read as EPUB",
                        systemImage: "doc.text"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
            } else {
                // EPUB not downloaded yet — offer download + read
                Button {
                    isDownloadingEpub = true
                    Task {
                        do {
                            try await downloadManager.downloadEpubVersion(bookId: book.id, modelContext: modelContext)
                            // Refresh downloaded state so hasEpubVersion reflects the new file
                            checkIfDownloaded()
                            if let refreshed = downloadedBook {
                                readAsEpub = true
                                bookToRead = refreshed
                            }
                        } catch {
                            // Silently fail — user can retry
                        }
                        isDownloadingEpub = false
                    }
                } label: {
                    if isDownloadingEpub {
                        Label("Downloading EPUB…", systemImage: "arrow.down.doc")
                            .frame(maxWidth: .infinity)
                    } else {
                        Label("Download & Read as EPUB", systemImage: "arrow.down.doc")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .disabled(isDownloadingEpub)
            }
        }
    }

    private var downloadButtonState: AnimatedDownloadButton.State {
        if isLoadingAudiobook {
            return .loading
        } else if isDownloaded {
            return .completed
        } else if isDownloading {
            let progress = downloadManager.activeDownloads[book.id]?.progress ?? 0
            return .downloading(progress: progress)
        } else if downloadError != nil {
            return .failed
        } else {
            return .idle
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

    // MARK: - Chapters

    @ViewBuilder
    private func chaptersSection(_ chapters: [Chapter]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Chapters")
                .font(.headline)

            VStack(spacing: 0) {
                ForEach(chapters) { chapter in
                    HStack {
                        Text(chapter.title)
                            .font(.subheadline)
                        Spacer()
                        Text(chapter.startTimeDisplay)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 10)
                    .padding(.horizontal, 16)

                    if chapter.id != chapters.last?.id {
                        Divider()
                            .padding(.leading, 16)
                    }
                }
            }
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

    // MARK: - Components

    @ViewBuilder
    private var formatBadge: some View {
        let info = FormatInfo.from(format: book.format)
        FormatBadgeView(
            format: book.format,
            size: .detail,
            showConversionHint: info.isConvertible && !book.hasEpubVersion
        )
    }

    @ViewBuilder
    private var detailsGrid: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 8) {
            if let publisher = displayBook.publisher {
                DetailRow(label: "Publisher", value: publisher)
            }
            if let publishedDate = displayBook.publishedDate {
                DetailRow(label: "Published", value: publishedDate)
            }
            if let isbn = displayBook.isbn13 ?? displayBook.isbn10 ?? displayBook.isbn {
                DetailRow(label: "ISBN", value: isbn)
            }
            if let language = displayBook.language {
                DetailRow(label: "Language", value: language.uppercased())
            }
            if let series = displayBook.series {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Series")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button {
                        onSeriesTap?(series)
                        dismiss()
                    } label: {
                        HStack(spacing: 4) {
                            Text(displayBook.seriesNumber != nil ? "\(series) #\(displayBook.seriesNumber!)" : series)
                                .font(.subheadline)
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                        }
                        .foregroundStyle(.accent)
                    }
                }
            }
        }
    }

    // MARK: - Related Books

    @ViewBuilder
    private var relatedBooksContent: some View {
        if isLoadingRelated {
            VStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Loading related books...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
        } else if !relatedBooks.isEmpty {
            RelatedBooksSection(
                title: "Related Books",
                books: relatedBooks,
                currentBookId: book.id
            ) { tappedBook in
                onBookTap?(tappedBook)
            }
        }
    }

    private func loadRelatedBooks() async {
        isLoadingRelated = true
        do {
            let response = try await apiService.fetchBook(id: book.id)
            relatedBooks = response.relatedBooks ?? []
        } catch {
            // Silently fail — related books are supplementary
        }
        isLoadingRelated = false
    }

    private func checkIfDownloaded() {
        downloadedBook = downloadManager.getDownloadedBook(id: book.id, modelContext: modelContext)
        isDownloaded = downloadedBook != nil
    }

    private func downloadBook() {
        isDownloading = true
        downloadError = nil

        Task {
            do {
                let downloaded = try await downloadManager.downloadBook(book, modelContext: modelContext)
                await MainActor.run {
                    if let downloaded = downloaded {
                        // Already existed, available immediately
                        isDownloading = false
                        isDownloaded = true
                        downloadedBook = downloaded
                    }
                    // If nil, download started in background — UI tracks via activeDownloads
                    // The download completion will be detected by checkIfDownloaded()
                }
            } catch {
                await MainActor.run {
                    isDownloading = false
                    downloadError = error.localizedDescription
                    showingError = true
                }
            }
        }
    }
}

struct DetailRow: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.subheadline)
        }
    }
}

#Preview {
    let book = Book(
        id: "1",
        title: "Sample Book",
        subtitle: "A Subtitle",
        authors: ["Author Name"],
        publisher: "Publisher Name",
        publishedDate: "2024",
        description: "This is a sample book description that provides information about the content of the book.",
        isbn: nil,
        isbn10: nil,
        isbn13: "9781234567890",
        language: "en",
        pageCount: 300,
        format: "epub",
        series: "Sample Series",
        seriesNumber: "1",
        coverUrl: "/covers/1.jpg",
        addedAt: nil,
        fileSize: 1024000
    )

    let config = ServerConfig()
    let api = APIService(config: config)

    BookDetailView(book: book)
        .environment(config)
        .environment(api)
        .environment(DownloadManager(config: config, apiService: api))
        .environment(AudiobookPlayer())
        .environment(StorageManager())
        .environment(ImageCache())
        .modelContainer(for: DownloadedBook.self, inMemory: true)
}
