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
    var onSeriesTap: ((String) -> Void)?

    @Environment(APIService.self) private var apiService
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(AppNavigation.self) private var appNavigation
    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(StorageManager.self) private var storageManager
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var bookToRead: DownloadedBook?
    @State private var showingDeleteConfirmation = false
    @State private var isDescriptionExpanded = false
    @State private var relatedBooks: [Book] = []
    @State private var selectedRelatedBook: Book?
    @State private var showingManagementSheet = false

    var body: some View {
        ScrollView {
            VStack(spacing: 0) {
                heroCoverSection

                titleBlock
                    .padding(.top, 12)

                metadataRow
                    .padding(.top, 12)

                actionSection
                    .padding(.top, 16)
                    .padding(.horizontal, 20)

                if let description = book.bookDescription, !description.isEmpty {
                    descriptionSection(description)
                        .padding(.top, 16)
                        .padding(.horizontal, 20)
                }

                detailsCardSection
                    .padding(.top, 16)
                    .padding(.horizontal, 20)

                relatedBooksContent
                    .padding(.top, 16)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 32)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            await loadRelatedBooks()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    showingManagementSheet = true
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sheet(isPresented: $showingManagementSheet) {
            BookManagementSheet(book: book) {
                deleteBook()
            }
        }
        .fullScreenCover(item: $bookToRead) { bookToOpen in
            ReaderContainerView(book: bookToOpen)
                .environment(apiService)
                .environment(storageManager)
                .environment(readerSettings)
                .modelContext(modelContext)
        }
        .sheet(item: $selectedRelatedBook) { relatedBook in
            BookDetailView(book: relatedBook)
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
                if book.isAudiobook {
                    Task {
                        await audiobookPlayer.loadBook(book)
                        audiobookPlayer.play()
                        audiobookPlayer.isFullPlayerPresented = true
                    }
                } else {
                    bookToRead = book
                }
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
        if book.isAudiobook {
            if book.readingProgress >= 1.0 {
                return "Play Again"
            } else if book.readingProgress > 0 {
                return "Continue Playing"
            } else {
                return "Play"
            }
        } else {
            if book.readingProgress >= 1.0 {
                return "Read Again"
            } else if book.readingProgress > 0 {
                return "Continue Reading"
            } else {
                return "Read"
            }
        }
    }

    private var readButtonIcon: String {
        if book.readingProgress >= 1.0 {
            return "arrow.counterclockwise"
        } else {
            return book.isAudiobook ? "headphones" : "book.fill"
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

    // MARK: - Components

    @ViewBuilder
    private var formatBadge: some View {
        FormatBadgeView(format: book.format, size: .detail)
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
                VStack(alignment: .leading, spacing: 2) {
                    Text("Series")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button {
                        navigateToSeries(series)
                    } label: {
                        HStack(spacing: 4) {
                            Text(book.seriesNumber != nil ? "\(series) #\(Int(book.seriesNumber!))" : series)
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
        if !relatedBooks.isEmpty {
            RelatedBooksSection(
                title: "Related Books",
                books: relatedBooks,
                currentBookId: book.id
            ) { tappedBook in
                selectedRelatedBook = tappedBook
            }
        }
    }

    private func loadRelatedBooks() async {
        do {
            let response = try await apiService.fetchBook(id: book.id)
            relatedBooks = response.relatedBooks ?? []
        } catch {
            // Silently fail — related books are supplementary
        }
    }

    private func navigateToSeries(_ series: String) {
        Task {
            let isConnected = await serverConfig.testConnection()
            await MainActor.run {
                if isConnected {
                    // Navigate to Library tab filtered by this series
                    appNavigation.pendingSeriesFilter = series
                    appNavigation.selectedTab = 0
                } else {
                    // Stay in Downloads, filter by series
                    onSeriesTap?(series)
                    dismiss()
                }
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

// MARK: - Book Management Sheet

struct BookManagementSheet: View {
    let book: DownloadedBook
    let onDelete: () -> Void

    @Environment(APIService.self) private var apiService
    @Environment(OnDeviceTranscriptionService.self) private var onDeviceService
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var showingDeleteBookConfirmation = false
    @State private var showingDeleteTranscriptConfirmation = false
    @State private var isDeletingTranscript = false

    /// Whether a transcript exists (saved or in-progress partial)
    private var hasAnyTranscript: Bool {
        book.transcriptData != nil || onDeviceService.activeBookId == book.id
    }

    /// Whether transcription is actively running for this book
    private var isTranscribing: Bool {
        onDeviceService.activeBookId == book.id && onDeviceService.isActive
    }

    var body: some View {
        NavigationStack {
            List {
                // Transcription section (audiobooks only)
                if book.isAudiobook {
                    Section {
                        TranscribeButton(book: book)

                        if hasAnyTranscript {
                            Button(role: .destructive) {
                                showingDeleteTranscriptConfirmation = true
                            } label: {
                                Label {
                                    if isDeletingTranscript {
                                        HStack(spacing: 8) {
                                            Text("Deleting...")
                                            Spacer()
                                            ProgressView()
                                                .scaleEffect(0.8)
                                        }
                                    } else {
                                        Text(isTranscribing ? "Stop & Delete Transcript" : "Delete Transcript")
                                    }
                                } icon: {
                                    Image(systemName: "trash")
                                }
                            }
                            .disabled(isDeletingTranscript)
                        }
                    } header: {
                        Text("Transcription")
                    }
                }

                // Book actions
                Section {
                    Button(role: .destructive) {
                        showingDeleteBookConfirmation = true
                    } label: {
                        Label("Delete from Device", systemImage: "trash")
                    }
                } header: {
                    Text("Book")
                }

                // Information section
                Section {
                    LabeledContent("Downloaded") {
                        Text(book.downloadedAt.formatted(date: .abbreviated, time: .omitted))
                    }

                    LabeledContent("File Size") {
                        Text(book.fileSizeDisplay)
                    }

                    if book.isAudiobook {
                        LabeledContent("Transcript") {
                            if book.transcriptData != nil {
                                Label("Available", systemImage: "checkmark.circle.fill")
                                    .foregroundStyle(.green)
                            } else if isTranscribing {
                                Label("In progress", systemImage: "waveform")
                                    .foregroundStyle(.orange)
                            } else {
                                Text("Not available")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Information")
                }
            }
            .navigationTitle("Manage Book")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
            .confirmationDialog(
                "Delete Book?",
                isPresented: $showingDeleteBookConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    dismiss()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        onDelete()
                    }
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This will remove \"\(book.title)\" from your device. You can download it again from your library.")
            }
            .confirmationDialog(
                "Delete Transcript?",
                isPresented: $showingDeleteTranscriptConfirmation,
                titleVisibility: .visible
            ) {
                Button("Delete", role: .destructive) {
                    deleteTranscript()
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This will remove the transcript for \"\(book.title)\". You can transcribe it again later.")
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func deleteTranscript() {
        isDeletingTranscript = true

        // Cancel any in-progress transcription for this book
        if onDeviceService.activeBookId == book.id {
            onDeviceService.cancel()
        }

        book.transcriptData = nil
        try? modelContext.save()

        // Also delete from server (fire-and-forget)
        Task {
            try? await apiService.deleteTranscript(bookId: book.id)
            isDeletingTranscript = false
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
    .environment(ServerConfig())
    .environment(AppNavigation())
    .environment(AudiobookPlayer())
    .environment(APIService(config: ServerConfig()))
    .environment(DownloadManager(config: ServerConfig(), apiService: APIService(config: ServerConfig())))
    .environment(StorageManager())
    .modelContainer(for: DownloadedBook.self, inMemory: true)
}
