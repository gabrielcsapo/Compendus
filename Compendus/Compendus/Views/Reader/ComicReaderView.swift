//
//  ComicReaderView.swift
//  Compendus
//
//  Comic reader for CBR/CBZ files with local extraction support for offline reading
//  CBZ files can be read offline, CBR files require server connection
//

import SwiftUI
import SwiftData

struct ComicReaderView: View {
    let book: DownloadedBook

    @Environment(\.modelContext) private var modelContext
    @Environment(APIService.self) private var apiService
    @Environment(StorageManager.self) private var storageManager
    @Environment(ComicExtractor.self) private var comicExtractor

    @State private var currentPage: Int = 0
    @State private var totalPages: Int = 0
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showingControls = true
    @State private var currentPageImage: UIImage?
    @State private var isLoadingPage = false
    @State private var isOfflineMode = false

    // Zoom state
    @State private var scale: CGFloat = 1.0
    @State private var lastScale: CGFloat = 1.0
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    // Tutorial state
    @State private var showingTutorial = TapZoneOverlay.shouldShow

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.ignoresSafeArea()

                if let error = errorMessage {
                    ContentUnavailableView {
                        Label("Error", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Close") {
                            dismiss()
                        }
                    }
                    .foregroundStyle(.white)
                } else if isLoading {
                    ProgressView("Loading comic...")
                        .foregroundStyle(.white)
                        .tint(.white)
                } else {
                    // Page view with gestures
                    ZStack {
                        if let image = currentPageImage {
                            Image(uiImage: image)
                                .resizable()
                                .aspectRatio(contentMode: .fit)
                                .scaleEffect(scale)
                                .offset(offset)
                                .frame(maxWidth: geometry.size.width, maxHeight: geometry.size.height)
                        } else if isLoadingPage {
                            ProgressView()
                                .tint(.white)
                        } else {
                            Image(systemName: "photo")
                                .font(.largeTitle)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                    // Pinch to zoom gesture
                    .gesture(
                        MagnificationGesture()
                            .onChanged { value in
                                let newScale = lastScale * value
                                scale = min(max(newScale, 1.0), 4.0) // Clamp between 1x and 4x
                            }
                            .onEnded { _ in
                                lastScale = scale
                                // Reset if zoomed out below 1x
                                if scale <= 1.0 {
                                    withAnimation(reduceMotion ? .none : .spring(response: 0.3)) {
                                        scale = 1.0
                                        lastScale = 1.0
                                        offset = .zero
                                        lastOffset = .zero
                                    }
                                }
                            }
                    )
                    // Pan gesture when zoomed
                    .simultaneousGesture(
                        scale > 1.0 ?
                        DragGesture()
                            .onChanged { value in
                                offset = CGSize(
                                    width: lastOffset.width + value.translation.width,
                                    height: lastOffset.height + value.translation.height
                                )
                            }
                            .onEnded { _ in
                                lastOffset = offset
                            }
                        : nil
                    )
                    // Swipe navigation (only when not zoomed)
                    .gesture(
                        scale <= 1.0 ?
                        DragGesture(minimumDistance: 50)
                            .onEnded { value in
                                if value.translation.width < -50 {
                                    goToNextPage()
                                } else if value.translation.width > 50 {
                                    goToPreviousPage()
                                }
                            }
                        : nil
                    )
                    // Double tap to reset zoom
                    .onTapGesture(count: 2) {
                        withAnimation(reduceMotion ? .none : .spring(response: 0.3)) {
                            if scale > 1.0 {
                                scale = 1.0
                                lastScale = 1.0
                                offset = .zero
                                lastOffset = .zero
                            } else {
                                scale = 2.0
                                lastScale = 2.0
                            }
                        }
                    }
                    .onTapGesture { location in
                        // Only handle tap zones when not zoomed
                        guard scale <= 1.0 else { return }

                        let width = geometry.size.width
                        if location.x < width * 0.3 {
                            goToPreviousPage()
                        } else if location.x > width * 0.7 {
                            goToNextPage()
                        } else {
                            withAnimation(reduceMotion ? .none : .spring(response: 0.35, dampingFraction: 0.8)) {
                                showingControls.toggle()
                            }
                        }
                    }
                }

                // Controls overlay
                if showingControls && !isLoading && errorMessage == nil {
                    VStack {
                        // Top bar with close button
                        HStack {
                            Button {
                                dismiss()
                            } label: {
                                Image(systemName: "xmark")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(.white)
                                    .frame(width: 32, height: 32)
                                    .background(.ultraThinMaterial)
                                    .clipShape(Circle())
                            }

                            Spacer()

                            if isOfflineMode {
                                HStack {
                                    Image(systemName: "icloud.slash")
                                    Text("Offline Mode")
                                }
                                .font(.caption)
                                .foregroundStyle(.white)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(.ultraThinMaterial)
                                .clipShape(Capsule())
                            }
                        }
                        .padding(.horizontal)
                        .padding(.top, 8)

                        Spacer()

                        VStack(spacing: 12) {
                            // Page slider
                            if totalPages > 1 {
                                Slider(
                                    value: Binding(
                                        get: { Double(currentPage) },
                                        set: { newValue in
                                            let page = Int(newValue)
                                            if page != currentPage {
                                                currentPage = page
                                                // Reset zoom when changing pages
                                                scale = 1.0
                                                lastScale = 1.0
                                                offset = .zero
                                                lastOffset = .zero
                                                Task { await loadPage(page) }
                                            }
                                        }
                                    ),
                                    in: 0...Double(max(0, totalPages - 1)),
                                    step: 1
                                )
                                .tint(.white)
                            }
                        }
                        .padding()
                        .background(.ultraThinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .padding(.horizontal)
                        .padding(.bottom, 8)

                        // Prominent page indicator pill at bottom
                        Text("\(currentPage + 1) / \(totalPages)")
                            .font(.subheadline.monospacedDigit())
                            .fontWeight(.medium)
                            .foregroundStyle(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(.ultraThinMaterial.opacity(0.9))
                            .clipShape(Capsule())
                            .padding(.bottom, 16)
                    }
                    .transition(.opacity)
                }

                // Tutorial overlay for first-time users
                if showingTutorial {
                    TapZoneOverlay(isShowing: $showingTutorial)
                        .transition(.opacity)
                }
            }
        }
        .navigationTitle(book.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .task {
            await loadComic()
        }
        .onDisappear {
            saveProgress()
        }
    }

    private func loadComic() async {
        isLoading = true
        errorMessage = nil

        // Check if we can use local extraction
        let canExtractLocally = comicExtractor.supportsLocalExtraction(format: book.format)
        let hasLocalFile = book.fileURL != nil && FileManager.default.fileExists(atPath: book.fileURL!.path)

        if canExtractLocally && hasLocalFile {
            // Use local extraction for CBZ
            await loadComicLocally()
        } else if book.format.lowercased() == "cbr" && hasLocalFile {
            // CBR downloaded but needs server for extraction
            // Try server first, but inform user about limitation
            await loadComicFromServer()
        } else {
            // No local file or unsupported format - use server
            await loadComicFromServer()
        }
    }

    private func loadComicLocally() async {
        guard let fileURL = book.fileURL else {
            errorMessage = "Book file not found"
            isLoading = false
            return
        }

        do {
            // Get page count from local file
            totalPages = try comicExtractor.getPageCount(from: fileURL, format: book.format)

            if totalPages == 0 {
                errorMessage = "Comic has no pages"
                isLoading = false
                return
            }

            // Cache page count for future use
            if book.pageCount != totalPages {
                book.pageCount = totalPages
                try? modelContext.save()
            }

            // Restore last position
            if let lastPosition = book.lastPosition, let page = Int(lastPosition) {
                currentPage = min(page, totalPages - 1)
            }

            isOfflineMode = true
            isLoading = false

            // Load initial page
            await loadPage(currentPage)
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    private func loadComicFromServer() async {
        do {
            // Get page count from server
            let info = try await apiService.fetchComicInfo(bookId: book.id, format: book.format)
            totalPages = info.pageCount

            if totalPages == 0 {
                errorMessage = "Comic has no pages"
                isLoading = false
                return
            }

            // Cache page count
            if book.pageCount != totalPages {
                book.pageCount = totalPages
                try? modelContext.save()
            }

            // Restore last position
            if let lastPosition = book.lastPosition, let page = Int(lastPosition) {
                currentPage = min(page, totalPages - 1)
            }

            isOfflineMode = false
            isLoading = false

            // Load initial page
            await loadPage(currentPage)
        } catch {
            // If server fails and we have a CBR file, show specific message
            if book.format.lowercased() == "cbr" {
                errorMessage = "CBR files require server connection for reading. Please connect to your server or download books in CBZ format for offline reading."
            } else {
                errorMessage = "Failed to load comic: \(error.localizedDescription)"
            }
            isLoading = false
        }
    }

    private func loadPage(_ page: Int) async {
        isLoadingPage = true
        currentPageImage = nil

        // Check local cache first
        if let cachedData = storageManager.getCachedComicPage(bookId: book.id, page: page),
           let image = UIImage(data: cachedData) {
            currentPageImage = image
            isLoadingPage = false
            return
        }

        // Try local extraction for CBZ
        let canExtractLocally = comicExtractor.supportsLocalExtraction(format: book.format)
        let hasLocalFile = book.fileURL != nil && FileManager.default.fileExists(atPath: book.fileURL!.path)

        if canExtractLocally && hasLocalFile {
            await loadPageLocally(page)
        } else {
            await loadPageFromServer(page)
        }
    }

    private func loadPageLocally(_ page: Int) async {
        guard let fileURL = book.fileURL else {
            isLoadingPage = false
            return
        }

        do {
            let data = try comicExtractor.extractPage(from: fileURL, format: book.format, pageIndex: page)
            if let image = UIImage(data: data) {
                currentPageImage = image

                // Cache for faster access next time
                try? storageManager.cacheComicPage(bookId: book.id, page: page, data: data)
            }
        } catch {
            print("Failed to extract page \(page) locally: \(error)")
            // Try server as fallback
            await loadPageFromServer(page)
        }

        isLoadingPage = false
    }

    private func loadPageFromServer(_ page: Int) async {
        do {
            let data = try await apiService.fetchComicPage(bookId: book.id, format: book.format, page: page)
            if let image = UIImage(data: data) {
                currentPageImage = image

                // Cache for offline use
                try? storageManager.cacheComicPage(bookId: book.id, page: page, data: data)
            }
        } catch {
            print("Failed to load page \(page) from server: \(error)")
        }

        isLoadingPage = false
    }

    private func goToNextPage() {
        guard currentPage < totalPages - 1 else { return }
        currentPage += 1
        resetZoom()
        Task { await loadPage(currentPage) }
    }

    private func goToPreviousPage() {
        guard currentPage > 0 else { return }
        currentPage -= 1
        resetZoom()
        Task { await loadPage(currentPage) }
    }

    private func resetZoom() {
        scale = 1.0
        lastScale = 1.0
        offset = .zero
        lastOffset = .zero
    }

    private func saveProgress() {
        book.lastPosition = String(currentPage)
        book.readingProgress = totalPages > 0 ? Double(currentPage + 1) / Double(totalPages) : 0
        try? modelContext.save()
    }
}

#Preview {
    let book = DownloadedBook(
        id: "1",
        title: "Sample Comic",
        authors: ["Author"],
        format: "cbz",
        fileSize: 50000000,
        localPath: "books/1.cbz"
    )

    NavigationStack {
        ComicReaderView(book: book)
    }
    .environment(APIService(config: ServerConfig()))
    .environment(StorageManager())
    .environment(ComicExtractor())
    .modelContainer(for: DownloadedBook.self, inMemory: true)
}
