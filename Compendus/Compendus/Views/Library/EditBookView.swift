//
//  EditBookView.swift
//  Compendus
//
//  Edit book metadata with offline support and tag management
//

import SwiftUI
import SwiftData

struct EditBookView: View {
    let bookId: String
    let initialBook: Book
    var onSave: ((Book) -> Void)?

    @Environment(APIService.self) private var apiService
    @Environment(BookEditSyncService.self) private var syncService
    @Environment(\.modelContext) private var modelContext
    @Environment(\.dismiss) private var dismiss

    // Form state
    @State private var title: String
    @State private var subtitle: String
    @State private var authorsText: String
    @State private var publisher: String
    @State private var publishedDate: String
    @State private var descriptionText: String
    @State private var isbn: String
    @State private var language: String
    @State private var pageCountText: String
    @State private var series: String
    @State private var seriesNumber: String

    // Tags
    @State private var bookTags: [BookTag] = []
    @State private var newTagName: String = ""
    @State private var isLoadingTags = false

    // Save state
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var showingError = false

    init(book: Book, onSave: ((Book) -> Void)? = nil) {
        self.bookId = book.id
        self.initialBook = book
        self.onSave = onSave
        _title = State(initialValue: book.title)
        _subtitle = State(initialValue: book.subtitle ?? "")
        _authorsText = State(initialValue: book.authors.joined(separator: ", "))
        _publisher = State(initialValue: book.publisher ?? "")
        _publishedDate = State(initialValue: book.publishedDate ?? "")
        _descriptionText = State(initialValue: book.description ?? "")
        _isbn = State(initialValue: book.isbn13 ?? book.isbn10 ?? book.isbn ?? "")
        _language = State(initialValue: book.language ?? "")
        _pageCountText = State(initialValue: book.pageCount != nil ? "\(book.pageCount!)" : "")
        _series = State(initialValue: book.series ?? "")
        _seriesNumber = State(initialValue: book.seriesNumber ?? "")
    }

    init(downloadedBook: DownloadedBook, onSave: ((Book) -> Void)? = nil) {
        let book = Book(
            id: downloadedBook.id,
            title: downloadedBook.title,
            subtitle: downloadedBook.subtitle,
            authors: downloadedBook.authors,
            publisher: downloadedBook.publisher,
            publishedDate: downloadedBook.publishedDate,
            description: downloadedBook.bookDescription,
            pageCount: downloadedBook.pageCount,
            format: downloadedBook.format,
            series: downloadedBook.series,
            seriesNumber: downloadedBook.seriesNumber != nil ? String(Int(downloadedBook.seriesNumber!)) : nil,
            fileSize: downloadedBook.fileSize,
            duration: downloadedBook.duration,
            narrator: downloadedBook.narrator
        )
        self.init(book: book, onSave: onSave)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") {
                    TextField("Title", text: $title)
                    TextField("Subtitle", text: $subtitle)
                }

                Section("Authors") {
                    TextField("Authors (comma-separated)", text: $authorsText)
                }

                Section("Publication") {
                    TextField("Publisher", text: $publisher)
                    TextField("Published Date", text: $publishedDate)
                        .keyboardType(.numbersAndPunctuation)
                    TextField("ISBN", text: $isbn)
                        .keyboardType(.numberPad)
                    TextField("Language", text: $language)
                        .autocorrectionDisabled()
                }

                Section("Details") {
                    TextField("Page Count", text: $pageCountText)
                        .keyboardType(.numberPad)
                    TextField("Series", text: $series)
                    TextField("Series Number", text: $seriesNumber)
                        .keyboardType(.decimalPad)
                }

                Section("Description") {
                    TextEditor(text: $descriptionText)
                        .frame(minHeight: 100)
                }

                tagsSection
            }
            .navigationTitle("Edit Book")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            saveChanges()
                        }
                        .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .alert("Error", isPresented: $showingError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(errorMessage ?? "Failed to save changes.")
            }
            .task {
                await loadTags()
            }
        }
    }

    // MARK: - Tags Section

    @ViewBuilder
    private var tagsSection: some View {
        Section("Tags") {
            if isLoadingTags {
                HStack {
                    ProgressView()
                        .controlSize(.small)
                    Text("Loading tags...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else {
                if !bookTags.isEmpty {
                    FlowLayout(spacing: 8) {
                        ForEach(bookTags) { tag in
                            TagChipView(tag: tag) {
                                removeTag(tag)
                            }
                        }
                    }
                }

                HStack {
                    TextField("Add tag...", text: $newTagName)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit {
                            addCurrentTag()
                        }

                    if !newTagName.trimmingCharacters(in: .whitespaces).isEmpty {
                        Button("Add") {
                            addCurrentTag()
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                    }
                }
            }
        }
    }

    // MARK: - Tag Actions

    private func loadTags() async {
        isLoadingTags = true
        defer { isLoadingTags = false }

        do {
            let response = try await apiService.fetchBookTags(bookId: bookId)
            bookTags = response.tags
        } catch {
            // Offline or error — show empty tags (user can still add new ones)
        }
    }

    private func addCurrentTag() {
        let name = newTagName.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }

        // Don't add duplicates
        if bookTags.contains(where: { $0.name.lowercased() == name.lowercased() }) {
            newTagName = ""
            return
        }

        // Optimistic local update
        let tempTag = BookTag(id: UUID().uuidString, name: name.lowercased(), color: nil, createdAt: nil)
        bookTags.append(tempTag)
        newTagName = ""

        // Try API, queue if offline
        Task {
            do {
                let response = try await apiService.addTag(bookId: bookId, name: name)
                // Replace temp tag with server tag
                if let index = bookTags.firstIndex(where: { $0.id == tempTag.id }) {
                    bookTags[index] = response.tag
                }
            } catch {
                // Queue for offline sync
                if let pendingEdit = PendingBookEdit.addTag(bookId: bookId, name: name) {
                    syncService.queueAndSync(pendingEdit, modelContext: modelContext)
                }
            }
        }
    }

    private func removeTag(_ tag: BookTag) {
        bookTags.removeAll { $0.id == tag.id }

        Task {
            do {
                try await apiService.removeTag(bookId: bookId, tagId: tag.id)
            } catch {
                // Queue for offline sync
                if let pendingEdit = PendingBookEdit.removeTag(bookId: bookId, tagId: tag.id) {
                    syncService.queueAndSync(pendingEdit, modelContext: modelContext)
                }
            }
        }
    }

    // MARK: - Save

    private func saveChanges() {
        isSaving = true

        let authors = authorsText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        let trimmed = { (s: String) -> String? in
            let t = s.trimmingCharacters(in: .whitespaces)
            return t.isEmpty ? nil : t
        }

        let updates = UpdateBookRequest(
            title: trimmed(title),
            subtitle: trimmed(subtitle),
            authors: authors,
            publisher: trimmed(publisher),
            publishedDate: trimmed(publishedDate),
            description: trimmed(descriptionText),
            isbn: trimmed(isbn),
            language: trimmed(language),
            pageCount: Int(pageCountText),
            series: trimmed(series),
            seriesNumber: trimmed(seriesNumber)
        )

        // Always update local DownloadedBook immediately
        updateLocalDownloadedBook(authors: authors)

        Task {
            do {
                let response = try await apiService.updateBook(id: bookId, updates: updates)
                await MainActor.run {
                    isSaving = false
                    onSave?(response.book)
                    dismiss()
                }
            } catch {
                // Queue for background sync (offline)
                if let pendingEdit = PendingBookEdit.metadataUpdate(bookId: bookId, request: updates) {
                    syncService.queueAndSync(pendingEdit, modelContext: modelContext)
                }
                await MainActor.run {
                    isSaving = false
                    onSave?(initialBook) // Return original book; local update already applied
                    dismiss()
                }
            }
        }
    }

    private func updateLocalDownloadedBook(authors: [String]) {
        let id = bookId
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == id }
        )
        guard let downloadedBook = try? modelContext.fetch(descriptor).first else { return }

        downloadedBook.title = title.trimmingCharacters(in: .whitespaces)
        downloadedBook.subtitle = subtitle.trimmingCharacters(in: .whitespaces).isEmpty ? nil : subtitle.trimmingCharacters(in: .whitespaces)
        downloadedBook.authors = authors
        downloadedBook.publisher = publisher.trimmingCharacters(in: .whitespaces).isEmpty ? nil : publisher.trimmingCharacters(in: .whitespaces)
        downloadedBook.publishedDate = publishedDate.trimmingCharacters(in: .whitespaces).isEmpty ? nil : publishedDate.trimmingCharacters(in: .whitespaces)
        downloadedBook.bookDescription = descriptionText.trimmingCharacters(in: .whitespaces).isEmpty ? nil : descriptionText.trimmingCharacters(in: .whitespaces)
        downloadedBook.pageCount = Int(pageCountText)
        downloadedBook.series = series.trimmingCharacters(in: .whitespaces).isEmpty ? nil : series.trimmingCharacters(in: .whitespaces)
        if let num = Double(seriesNumber) {
            downloadedBook.seriesNumber = num
        } else {
            downloadedBook.seriesNumber = nil
        }

        try? modelContext.save()
    }
}

// MARK: - Tag Chip View

struct TagChipView: View {
    let tag: BookTag
    let onRemove: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Text(tag.name)
                .font(.caption)
            Button {
                onRemove()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(tagColor.opacity(0.15))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(tagColor.opacity(0.3), lineWidth: 0.5)
        )
        .foregroundStyle(tagColor)
    }

    private var tagColor: Color {
        if let hex = tag.color {
            return Color(hex: hex)
        }
        return .accentColor
    }
}

// MARK: - Flow Layout for Tags

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = computeLayout(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = computeLayout(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y),
                proposal: .unspecified
            )
        }
    }

    private func computeLayout(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var currentX: CGFloat = 0
        var currentY: CGFloat = 0
        var lineHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)

            if currentX + size.width > maxWidth && currentX > 0 {
                currentX = 0
                currentY += lineHeight + spacing
                lineHeight = 0
            }

            positions.append(CGPoint(x: currentX, y: currentY))
            lineHeight = max(lineHeight, size.height)
            currentX += size.width + spacing
        }

        return (
            size: CGSize(width: maxWidth, height: currentY + lineHeight),
            positions: positions
        )
    }
}