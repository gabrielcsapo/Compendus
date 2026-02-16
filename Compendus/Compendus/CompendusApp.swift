//
//  CompendusApp.swift
//  Compendus
//
//  Personal book library app for iOS
//

import SwiftUI
import SwiftData

@main
struct CompendusApp: App {
    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            DownloadedBook.self,
            BookHighlight.self,
        ])
        let modelConfiguration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)

        do {
            return try ModelContainer(for: schema, configurations: [modelConfiguration])
        } catch {
            fatalError("Could not create ModelContainer: \(error)")
        }
    }()

    @State private var serverConfig = ServerConfig()
    @State private var storageManager = StorageManager()
    @State private var comicExtractor = ComicExtractor()
    @State private var deepLinkBookId: String?

    @State private var readerSettings = ReaderSettings()

    // These are created lazily based on serverConfig
    @State private var apiService: APIService
    @State private var downloadManager: DownloadManager

    init() {
        let config = ServerConfig()
        let api = APIService(config: config)
        let download = DownloadManager(config: config, apiService: api)

        _serverConfig = State(initialValue: config)
        _apiService = State(initialValue: api)
        _downloadManager = State(initialValue: download)
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(serverConfig)
                .environment(storageManager)
                .environment(comicExtractor)
                .environment(apiService)
                .environment(downloadManager)
                .environment(readerSettings)
                .environment(\.deepLinkBookId, $deepLinkBookId)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
        }
        .modelContainer(sharedModelContainer)
    }

    private func handleDeepLink(_ url: URL) {
        // Handle compendus://book/{bookId}
        guard url.scheme == "compendus",
              url.host == "book",
              let bookId = url.pathComponents.dropFirst().first else {
            return
        }

        deepLinkBookId = bookId
    }
}

// MARK: - Deep Link Environment Key

struct DeepLinkBookIdKey: EnvironmentKey {
    static let defaultValue: Binding<String?> = .constant(nil)
}

extension EnvironmentValues {
    var deepLinkBookId: Binding<String?> {
        get { self[DeepLinkBookIdKey.self] }
        set { self[DeepLinkBookIdKey.self] = newValue }
    }
}
