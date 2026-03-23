//
//  DownloadedBookDetailView.swift
//  Compendus
//
//  Detail view for a downloaded book with read option
//

import SwiftUI
import SwiftData
import EPUBReader

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
    @State private var isLoadingRelated = true
    @State private var selectedRelatedBook: Book?
    @State private var showingManagementSheet = false

    // Reading stats
    @State private var totalReadingTime: Int = 0      // Wall-clock seconds
    @State private var totalContentTime: Int = 0      // Speed-adjusted seconds (audiobooks)
    @State private var sessionCount: Int = 0
    @State private var isLoadingStats = true
    @State private var showingReadingHistory = false
    @State private var isCheckingConnection = false
    @State private var isLoadingAudiobook = false
    @State private var showingDeleteError = false
    @State private var deleteError: String?
    @State private var saveError: String?

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

                if isLoadingStats {
                    ProgressView()
                        .controlSize(.small)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)
                } else if totalReadingTime > 0 {
                    readingStatsSection
                        .padding(.top, 16)
                        .padding(.horizontal, 20)
                }

                if book.review != nil {
                    reviewDisplaySection
                        .padding(.top, 16)
                        .padding(.horizontal, 20)
                }

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
            await loadReadingStats()
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
        .sheet(isPresented: $showingReadingHistory) {
            BookReadingHistoryView(book: book)
        }
        .fullScreenCover(item: $bookToRead) { bookToOpen in
            ReaderContainerView(book: bookToOpen)
                .environment(apiService)
                .environment(storageManager)
                .environment(readerSettings)
                .modelContext(modelContext)
        }
        .alert("Delete Failed", isPresented: $showingDeleteError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(deleteError ?? "An error occurred while deleting the book.")
        }
        .sheet(item: $selectedRelatedBook) { relatedBook in
            BookDetailView(
                book: relatedBook,
                onBookTap: { tappedBook in
                    // Replace the current sheet with the tapped book
                    selectedRelatedBook = tappedBook
                }
            )
        }
        .bannerToast($saveError, type: .error)
    }

    // MARK: - Hero Cover

    @ViewBuilder
    private var heroCoverSection: some View {
        VStack {
            if let uiImage = CoverImageDecoder.decode(bookId: book.id, data: book.coverData) {
                Image(uiImage: uiImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 200)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .shadow(color: .black.opacity(0.2), radius: 8, x: 0, y: 4)
            } else {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color(.systemGray5))
                    .aspectRatio(2/3, contentMode: .fit)
                    .frame(width: 200)
                    .overlay {
                        Image(systemName: CoverImageDecoder.placeholderIcon(for: book.format))
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
        if let uiImage = CoverImageDecoder.decode(bookId: book.id, data: book.coverData) {
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
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                formatBadge

                if book.isRead {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.caption2)
                            .foregroundStyle(.green)
                        Text("Read")
                            .font(.caption)
                            .foregroundStyle(.green)
                    }
                }

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

            if let rating = book.rating {
                HStack(spacing: 2) {
                    ForEach(1...5, id: \.self) { star in
                        Image(systemName: star <= rating ? "star.fill" : "star")
                            .font(.caption)
                            .foregroundStyle(star <= rating ? .yellow : .secondary.opacity(0.3))
                    }
                }
            }
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
                    isLoadingAudiobook = true
                    Task {
                        await audiobookPlayer.loadBook(book)
                        audiobookPlayer.isFullPlayerPresented = true
                        isLoadingAudiobook = false
                    }
                } else {
                    bookToRead = book
                }
            } label: {
                if isLoadingAudiobook {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Label(readButtonTitle, systemImage: readButtonIcon)
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(isLoadingAudiobook)

            if book.readingProgress > 0 && book.readingProgress < 1.0 {
                VStack(spacing: 4) {
                    ProgressView(value: book.readingProgress)
                        .tint(.accentColor)

                    HStack {
                        if book.isAudiobook, let duration = book.duration, duration > 0 {
                            let elapsed = Int(book.readingProgress * Double(duration))
                            let remaining = duration - elapsed
                            let elapsedHours = elapsed / 3600
                            let elapsedMinutes = (elapsed % 3600) / 60
                            let remainingHours = remaining / 3600
                            let remainingMinutes = (remaining % 3600) / 60
                            let elapsedText = elapsedHours > 0 ? "\(elapsedHours)h \(elapsedMinutes)m" : "\(elapsedMinutes)m"
                            let remainingText = remainingHours > 0 ? "\(remainingHours)h \(remainingMinutes)m" : "\(remainingMinutes)m"
                            Text(elapsedText)
                                .font(.caption)
                                .foregroundStyle(.secondary)

                            Text("·")
                                .font(.caption)
                                .foregroundStyle(.tertiary)

                            Text("\(remainingText) left")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if !book.isAudiobook, let pageCount = book.pageCount, pageCount > 0 {
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

    // MARK: - Review Display

    @ViewBuilder
    private var reviewDisplaySection: some View {
        if let review = book.review, !review.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Your Review")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.secondary)

                Text(review)
                    .font(.body)
                    .foregroundStyle(.primary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
    }

    // MARK: - Reading Stats

    @ViewBuilder
    private var readingStatsSection: some View {
        Button {
            showingReadingHistory = true
        } label: {
            HStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 2) {
                    Label(book.isAudiobook ? "Time Listened" : "Time Spent", systemImage: book.isAudiobook ? "headphones" : "clock")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if book.isAudiobook && totalContentTime != totalReadingTime {
                        Text(formatReadingTime(totalContentTime))
                            .font(.title3)
                            .fontWeight(.semibold)
                        Text("\(formatReadingTime(totalReadingTime)) real time")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    } else {
                        Text(formatReadingTime(totalReadingTime))
                            .font(.title3)
                            .fontWeight(.semibold)
                    }
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 2) {
                    Text("Sessions")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("\(sessionCount)")
                        .font(.title3)
                        .fontWeight(.semibold)
                }

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .background {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(.separator, lineWidth: 0.5)
                    }
            }
        }
        .buttonStyle(.plain)
    }

    private func loadReadingStats() async {
        isLoadingStats = true
        let bookId = book.id
        let descriptor = FetchDescriptor<ReadingSession>(
            predicate: #Predicate { $0.bookId == bookId }
        )
        if let sessions = try? modelContext.fetch(descriptor) {
            let data = sessions.map { (duration: $0.durationSeconds, content: $0.contentDurationSeconds) }
            let computed = await Task.detached {
                let readingTime = data.reduce(0) { $0 + $1.duration }
                let contentTime = data.reduce(0) { $0 + $1.content }
                return (readingTime, contentTime, data.count)
            }.value
            totalReadingTime = computed.0
            totalContentTime = computed.1
            sessionCount = computed.2
        }
        isLoadingStats = false
    }

    private func formatReadingTime(_ totalSeconds: Int) -> String {
        let hours = totalSeconds / 3600
        let minutes = (totalSeconds % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        } else if minutes > 0 {
            return "\(minutes)m"
        }
        return "<1m"
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
                            if isCheckingConnection {
                                ProgressView()
                                    .controlSize(.mini)
                            } else {
                                Image(systemName: "chevron.right")
                                    .font(.caption2)
                            }
                        }
                        .foregroundStyle(.accent)
                    }
                    .disabled(isCheckingConnection)
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
                selectedRelatedBook = tappedBook
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

    private func navigateToSeries(_ series: String) {
        Task {
            isCheckingConnection = true
            let isConnected = await serverConfig.testConnection()
            await MainActor.run {
                isCheckingConnection = false
                if isConnected {
                    // Navigate to Library tab filtered by this series
                    appNavigation.pendingSeriesFilter = series
                    appNavigation.selectedTab = 1
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
            deleteError = error.localizedDescription
            showingDeleteError = true
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
    @State private var transcriptDeleteError: String?
    @State private var showingTranscriptDeleteError = false
    @State private var showingEditSheet = false
    @State private var showingReviewSheet = false
    @State private var saveError: String?

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
                // Metadata editing
                Section {
                    Button {
                        showingEditSheet = true
                    } label: {
                        Label("Edit Details", systemImage: "pencil")
                    }
                } header: {
                    Text("Metadata")
                }

                // Status section
                Section {
                    Button {
                        toggleReadStatus()
                    } label: {
                        Label(
                            book.isRead ? "Mark as Unread" : "Mark as Read",
                            systemImage: book.isRead ? "checkmark.circle.fill" : "checkmark.circle"
                        )
                    }

                    // Star rating
                    HStack {
                        Text("Rating")
                        Spacer()
                        HStack(spacing: 4) {
                            ForEach(1...5, id: \.self) { star in
                                Button {
                                    setRating(star == book.rating ? nil : star)
                                } label: {
                                    Image(systemName: star <= (book.rating ?? 0) ? "star.fill" : "star")
                                        .font(.system(size: 18))
                                        .foregroundStyle(star <= (book.rating ?? 0) ? .yellow : .secondary)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }

                    Button {
                        showingReviewSheet = true
                    } label: {
                        Label(
                            book.review != nil ? "Edit Review" : "Write Review",
                            systemImage: "text.quote"
                        )
                    }
                } header: {
                    Text("Status")
                }

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
                    } footer: {
                        Text("On-device transcription runs best while connected to power.")
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
                Text("This will remove \"\(book.title)\" from your device, including all highlights and bookmarks. You can download it again from your library.")
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
        .sheet(isPresented: $showingEditSheet) {
            EditBookView(downloadedBook: book)
        }
        .sheet(isPresented: $showingReviewSheet) {
            BookReviewSheet(book: book)
        }
        .alert("Transcript Delete", isPresented: $showingTranscriptDeleteError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(transcriptDeleteError ?? "An error occurred.")
        }
        .bannerToast($saveError, type: .error)
    }

    private func toggleReadStatus() {
        let newValue = !book.isRead
        book.isRead = newValue
        do {
            try modelContext.save()
        } catch {
            HapticFeedback.error()
            saveError = "Couldn't save read status. Please try again."
            return
        }

        // Sync to server
        if let edit = PendingBookEdit.toggleRead(bookId: book.id, isRead: newValue) {
            modelContext.insert(edit)
            do { try modelContext.save() } catch { print("[DownloadedBookDetail] Failed to queue sync: \(error)") }
        }
    }

    private func setRating(_ rating: Int?) {
        book.rating = rating
        do {
            try modelContext.save()
        } catch {
            HapticFeedback.error()
            saveError = "Couldn't save rating. Please try again."
            return
        }

        // Sync to server
        if let edit = PendingBookEdit.rateBook(bookId: book.id, rating: rating, review: book.review) {
            modelContext.insert(edit)
            do { try modelContext.save() } catch { print("[DownloadedBookDetail] Failed to queue sync: \(error)") }
        }
    }

    private func deleteTranscript() {
        isDeletingTranscript = true

        // Cancel any in-progress transcription for this book
        if onDeviceService.activeBookId == book.id {
            onDeviceService.cancel()
        }

        book.transcriptData = nil
        do {
            try modelContext.save()
        } catch {
            print("[DownloadedBookDetail] Failed to delete transcript locally: \(error)")
        }

        // Also delete from server
        Task {
            do {
                try await apiService.deleteTranscript(bookId: book.id)
            } catch {
                transcriptDeleteError = "Local transcript removed, but failed to delete from server."
                showingTranscriptDeleteError = true
            }
            isDeletingTranscript = false
        }
    }
}

// MARK: - Book Review Sheet

struct BookReviewSheet: View {
    let book: DownloadedBook

    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    @State private var reviewText: String = ""
    @State private var saveError: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $reviewText)
                        .frame(minHeight: 150)
                } header: {
                    Text("Your Review")
                } footer: {
                    Text("Write your thoughts about this book.")
                }
            }
            .navigationTitle("Review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Save") {
                        saveReview()
                    }
                    .fontWeight(.semibold)
                }
            }
            .onAppear {
                reviewText = book.review ?? ""
            }
        }
        .presentationDetents([.medium, .large])
        .bannerToast($saveError, type: .error)
    }

    private func saveReview() {
        book.review = reviewText.isEmpty ? nil : reviewText
        do {
            try modelContext.save()
        } catch {
            HapticFeedback.error()
            saveError = "Couldn't save review. Please try again."
            return
        }

        // Sync to server
        if let edit = PendingBookEdit.rateBook(bookId: book.id, rating: book.rating, review: book.review) {
            modelContext.insert(edit)
            do { try modelContext.save() } catch { print("[DownloadedBookDetail] Failed to queue sync: \(error)") }
        }

        dismiss()
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
