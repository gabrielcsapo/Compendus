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
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(OnDeviceTranscriptionService.self) private var transcriptionService
    @Environment(ReadAlongService.self) private var readAlongService
    @Environment(KokoroModelManager.self) private var kokoroModelManager
    @Environment(TTSAudioCache.self) private var ttsAudioCache
    @Environment(BackgroundProcessingManager.self) private var backgroundProcessingManager
    @Environment(ComicExtractor.self) private var comicExtractor
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
    @State private var bookTags: [BookTag] = []
    @State private var bookCollections: [BookCollection] = []
    @State private var allCollections: [BookCollection] = []
    @State private var showingRatingSheet = false

    /// Use edited version of the book if available
    private var displayBook: Book {
        editedBook ?? book
    }

    var body: some View {
        // NOTE: Intentionally NOT wrapped in NavigationStack.
        //
        // Root cause of the long-standing auto-scroll bug:
        //   Wrapping ScrollView in NavigationStack with
        //   `.toolbarBackground(.hidden, for: .navigationBar)` triggers an iOS
        //   18+ regression where the ScrollView's top safe-area inset is
        //   recomputed AFTER first layout. When the inset settles (~1 second
        //   in, around the same time async content lands), SwiftUI snaps the
        //   scroll offset to honour the new inset, shifting the hero ~150pt
        //   down. `.scrollPosition`, `ScrollViewReader.scrollTo`, and
        //   `.defaultScrollAnchor` all lose this race because the inset change
        //   re-anchors *after* their callbacks fire. The only reliable fix is
        //   to not introduce a navigation bar / toolbar at all — this view is
        //   always presented as a sheet, so we render the Edit / Done buttons
        //   manually as an inline header above the ScrollView.
        ZStack(alignment: .top) {
            ScrollView { mainContent }
            inlineHeader
        }
        .sheet(isPresented: $showingEditSheet) { editSheet }
        .onChange(of: showingEditSheet) { _, isShowing in
            // Tags can be edited in the sheet — refresh the chips when it closes.
            if !isShowing {
                Task { await loadTags() }
            }
        }
        .sheet(isPresented: $showingRatingSheet) {
            RatingSheet(
                initialRating: displayBook.rating,
                initialReview: displayBook.review ?? "",
                onSave: { rating, review in saveRating(rating: rating, review: review) }
            )
            .presentationDetents([.medium, .large])
        }
        .task {
            checkIfDownloaded()
            await loadTags()
            await loadCollections()
            await loadRelatedBooks()
        }
        .onChange(of: downloadCompletion) { _, completed in
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
            readerCover(for: book)
        }
        .onChange(of: bookToRead) { _, newValue in
            if newValue == nil { readAsEpub = false }
        }
    }

    @ViewBuilder
    private var inlineHeader: some View {
        HStack {
            Menu {
                Button { showingEditSheet = true } label: {
                    Label("Edit Details", systemImage: "pencil")
                }
                Button { showingRatingSheet = true } label: {
                    Label(
                        displayBook.rating != nil ? "Edit Rating & Review" : "Rate & Review",
                        systemImage: "star"
                    )
                }
                Divider()
                Button { toggleRead() } label: {
                    Label(
                        isMarkedRead ? "Mark as Unread" : "Mark as Read",
                        systemImage: isMarkedRead ? "circle" : "checkmark.circle"
                    )
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.body)
                    .padding(8)
                    .background(.ultraThinMaterial, in: Circle())
            }
            Spacer()
            Button("Done") { dismiss() }
                .fontWeight(.semibold)
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(.ultraThinMaterial, in: Capsule())
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private var isMarkedRead: Bool { displayBook.isRead ?? false }

    @ViewBuilder
    private var editSheet: some View {
        EditBookView(book: displayBook) { updatedBook in
            editedBook = updatedBook
        }
    }

    @ViewBuilder
    private func readerCover(for book: DownloadedBook) -> some View {
        ReaderContainerView(book: book, preferEpub: readAsEpub)
            .environment(readerSettings)
            .environment(highlightColorManager)
            .environment(readAlongService)
            .environment(audiobookPlayer)
            .environment(transcriptionService)
            .environment(apiService)
            .environment(storageManager)
            .environment(kokoroModelManager)
            .environment(ttsAudioCache)
            .environment(backgroundProcessingManager)
            .environment(comicExtractor)
            .modelContext(modelContext)
    }

    /// Extracted from `onChange` so the type-checker doesn't choke on the
    /// chained optional keypath inside the body's modifier chain.
    private var downloadCompletion: Bool? {
        downloadManager.activeDownloads[book.id]?.state.isCompleted
    }

    /// Extracted so the body's type-check stays fast. SwiftUI's compiler
    /// chokes on long VStacks inside ScrollView with conditional sections.
    @ViewBuilder
    private var mainContent: some View {
        VStack(spacing: 0) {
            heroCoverSection

            titleBlock
                .padding(.top, 16)

            metadataRow
                .padding(.top, 12)

            tagsRow
                .padding(.top, 12)
                .padding(.horizontal, 20)

            collectionsRow
                .padding(.top, 10)
                .padding(.horizontal, 20)

            progressSection
                .padding(.top, 12)

            actionButtonGroup
                .padding(.top, 20)
                .padding(.horizontal, 20)

            descriptionBlock
                .padding(.horizontal, 20)

            detailsCardSection
                .padding(.top, 24)
                .padding(.horizontal, 20)

            audiobookChaptersBlock
                .padding(.horizontal, 20)

            relatedBooksContent
                .padding(.top, 24)
                .padding(.horizontal, 20)
        }
        .padding(.bottom, 40)
    }

    @ViewBuilder
    private var actionButtonGroup: some View {
        VStack(spacing: 12) {
            actionButton
            epubReadingOption
        }
    }

    @ViewBuilder
    private var descriptionBlock: some View {
        if let description = displayBook.description, !description.isEmpty {
            descriptionSection(description)
                .padding(.top, 24)
        }
    }

    @ViewBuilder
    private var audiobookChaptersBlock: some View {
        if displayBook.isAudiobook, let chapters = displayBook.chapters, !chapters.isEmpty {
            chaptersSection(chapters)
                .padding(.top, 24)
        }
    }

    // MARK: - Hero Cover

    /// Foreground cover is 200pt × 300pt (2:3 aspect ratio), plus 20pt
    /// vertical padding above and below = 340pt total. Pinning the
    /// background to this height stops the async-loaded blurred cover from
    /// resizing the parent and triggering an auto-scroll.
    private static let heroHeight: CGFloat = 340

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
        .frame(height: Self.heroHeight)
        .background {
            // NOTE: Do NOT add `.ignoresSafeArea(edges: .top)` here. Inside a
            // ScrollView, that modifier inflates the ScrollView's content size
            // into the safe area and causes SwiftUI to re-anchor the scroll
            // offset after first layout (auto-scroll bug). The background is
            // pinned to the fixed hero height so it can't grow async either.
            heroCoverBackground
                .frame(height: Self.heroHeight)
                .clipped()
        }
    }

    @ViewBuilder
    private var heroCoverBackground: some View {
        if book.coverUrl != nil {
            CachedCoverImage(bookId: book.id, hasCover: true, format: book.format)
                .aspectRatio(contentMode: .fill)
                .frame(height: Self.heroHeight)
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

            if isMarkedRead {
                Label("Completed", systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.green)
                    .padding(.top, 2)
            }

            ratingRow
                .padding(.top, 6)
        }
        .padding(.horizontal, 20)
    }

    /// Tappable star rating — opens the rating & review sheet.
    @ViewBuilder
    private var ratingRow: some View {
        Button { showingRatingSheet = true } label: {
            HStack(spacing: 8) {
                StarsView(rating: displayBook.rating ?? 0)
                Text(displayBook.rating != nil ? "\(displayBook.rating!)/5" : "Rate this book")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
    }

    // MARK: - Tags

    @ViewBuilder
    private var tagsRow: some View {
        if !bookTags.isEmpty {
            FlowLayout(spacing: 8) {
                ForEach(bookTags) { tag in
                    Text(tag.name)
                        .font(.caption)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(tagColor(tag).opacity(0.18), in: Capsule())
                        .foregroundStyle(tagColor(tag))
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func tagColor(_ tag: BookTag) -> Color {
        if let hex = tag.color, !hex.isEmpty { return Color(hex: hex) }
        return .accentColor
    }

    // MARK: - Collections

    private var availableCollections: [BookCollection] {
        let current = Set(bookCollections.map(\.id))
        return allCollections.filter { !current.contains($0.id) }
    }

    @ViewBuilder
    private var collectionsRow: some View {
        FlowLayout(spacing: 8) {
            ForEach(bookCollections) { collection in
                Menu {
                    Button(role: .destructive) {
                        removeFromCollection(collection.id)
                    } label: {
                        Label("Remove from \(collection.name)", systemImage: "minus.circle")
                    }
                } label: {
                    collectionChip(collection)
                }
            }

            Menu {
                if availableCollections.isEmpty {
                    Text(allCollections.isEmpty ? "No collections yet" : "In all collections")
                } else {
                    ForEach(availableCollections) { collection in
                        Button {
                            addToCollection(collection.id)
                        } label: {
                            Label(
                                collection.icon.map { "\($0) \(collection.name)" } ?? collection.name,
                                systemImage: "folder"
                            )
                        }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "plus")
                        .font(.caption2)
                    Text("Add to collection")
                        .font(.caption)
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .foregroundStyle(.secondary)
                .overlay(
                    Capsule().strokeBorder(
                        Color.secondary.opacity(0.4),
                        style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                    )
                )
            }
        }
        .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private func collectionChip(_ collection: BookCollection) -> some View {
        let color: Color = (collection.color.map { Color(hex: $0) }) ?? .accentColor
        HStack(spacing: 4) {
            if let icon = collection.icon, !icon.isEmpty {
                Text(icon)
            } else {
                Image(systemName: "folder.fill")
                    .font(.caption2)
            }
            Text(collection.name)
                .font(.caption)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(color.opacity(0.18), in: Capsule())
        .foregroundStyle(color)
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

    // MARK: - Reading Progress

    @ViewBuilder
    private var progressSection: some View {
        if let progress = displayBook.readingProgress, progress > 0 {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Reading Progress")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text("\(displayBook.readingProgressPercent)%")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.primary)
                }
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .tint(.accentColor)
                if let relativeLastRead = relativeLastReadString {
                    Text(relativeLastRead)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private var relativeLastReadString: String? {
        guard let iso = displayBook.lastReadAt,
              let date = ISO8601DateFormatter().date(from: iso) else { return nil }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return "Last read " + formatter.localizedString(for: date, relativeTo: Date())
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

    private func loadTags() async {
        do {
            let response = try await apiService.fetchBookTags(bookId: book.id)
            bookTags = response.tags
        } catch {
            // Offline or error — leave tags empty
        }
    }

    private func loadCollections() async {
        if let response = try? await apiService.fetchBookCollections(bookId: book.id) {
            bookCollections = response.collections
        }
        if let response = try? await apiService.fetchCollections() {
            allCollections = response.collections
        }
    }

    private func addToCollection(_ collectionId: String) {
        guard let collection = allCollections.first(where: { $0.id == collectionId }) else { return }
        if !bookCollections.contains(where: { $0.id == collectionId }) {
            bookCollections.append(collection)
        }
        Task {
            try? await apiService.addBookToCollection(bookId: book.id, collectionId: collectionId)
        }
    }

    private func removeFromCollection(_ collectionId: String) {
        bookCollections.removeAll { $0.id == collectionId }
        Task {
            try? await apiService.removeBookFromCollection(bookId: book.id, collectionId: collectionId)
        }
    }

    /// Toggle read/completed state, optimistically updating the local copy.
    private func toggleRead() {
        let newValue = !isMarkedRead
        var updated = displayBook
        updated.isRead = newValue
        editedBook = updated
        Task {
            _ = try? await apiService.updateBook(id: book.id, updates: UpdateBookRequest(isRead: newValue))
        }
    }

    /// Persist rating + review, optimistically updating the local copy.
    private func saveRating(rating: Int?, review: String) {
        var updated = displayBook
        updated.rating = rating
        updated.review = review.isEmpty ? nil : review
        editedBook = updated
        Task {
            _ = try? await apiService.updateBook(
                id: book.id,
                updates: UpdateBookRequest(rating: rating, review: review)
            )
        }
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

/// Compact read-only star display (0–5).
struct StarsView: View {
    let rating: Int

    var body: some View {
        HStack(spacing: 2) {
            ForEach(1...5, id: \.self) { i in
                Image(systemName: i <= rating ? "star.fill" : "star")
                    .font(.caption)
                    .foregroundStyle(i <= rating ? Color.yellow : Color.secondary)
            }
        }
    }
}

/// Sheet for setting a book's rating and writing a review.
struct RatingSheet: View {
    let initialRating: Int?
    let initialReview: String
    let onSave: (Int?, String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var rating: Int
    @State private var review: String

    init(initialRating: Int?, initialReview: String, onSave: @escaping (Int?, String) -> Void) {
        self.initialRating = initialRating
        self.initialReview = initialReview
        self.onSave = onSave
        _rating = State(initialValue: initialRating ?? 0)
        _review = State(initialValue: initialReview)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Your Rating") {
                    HStack {
                        Spacer()
                        ForEach(1...5, id: \.self) { i in
                            Image(systemName: i <= rating ? "star.fill" : "star")
                                .font(.title2)
                                .foregroundStyle(i <= rating ? Color.yellow : Color.secondary)
                                .onTapGesture { rating = i }
                                .accessibilityLabel("\(i) star\(i == 1 ? "" : "s")")
                        }
                        Spacer()
                    }
                    .padding(.vertical, 4)
                }

                Section("Review") {
                    TextField("Write your thoughts...", text: $review, axis: .vertical)
                        .lineLimit(4...10)
                }
            }
            .navigationTitle("Rating & Review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave(rating == 0 ? nil : rating, review)
                        dismiss()
                    }
                }
            }
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
