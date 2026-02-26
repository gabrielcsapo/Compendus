//
//  CompendusApp.swift
//  Compendus
//
//  Personal book library app for iOS
//

import SwiftUI
import SwiftData
import BackgroundTasks

@main
struct CompendusApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var sharedModelContainer: ModelContainer = {
        let schema = Schema([
            DownloadedBook.self,
            BookHighlight.self,
            PendingDownload.self,
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

    @State private var imageCache = ImageCache()
    @State private var readerSettings = ReaderSettings()
    @State private var appNavigation = AppNavigation()
    @State private var audiobookPlayer = AudiobookPlayer()
    @State private var onDeviceTranscriptionService = OnDeviceTranscriptionService()
    @State private var themeManager = ThemeManager()
    @State private var appSettings = AppSettings()
    @State private var highlightColorManager = HighlightColorManager()

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

    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(serverConfig)
                .environment(storageManager)
                .environment(comicExtractor)
                .environment(apiService)
                .environment(downloadManager)
                .environment(imageCache)
                .environment(readerSettings)
                .environment(appNavigation)
                .environment(audiobookPlayer)
                .environment(onDeviceTranscriptionService)
                .environment(themeManager)
                .environment(appSettings)
                .environment(highlightColorManager)
                .environment(\.deepLinkBookId, $deepLinkBookId)
                .tint(themeManager.accentColor)
                .preferredColorScheme(appSettings.colorScheme)
                .onOpenURL { url in
                    handleDeepLink(url)
                }
                .onAppear {
                    downloadManager.appDelegate = appDelegate
                    downloadManager.modelContainer = sharedModelContainer
                    downloadManager.reconnectBackgroundSession()
                    audiobookPlayer.modelContainer = sharedModelContainer
                    OnDeviceTranscriptionService.registerBackgroundTask(
                        service: onDeviceTranscriptionService
                    )
                }
        }
        .modelContainer(sharedModelContainer)
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .background:
                onDeviceTranscriptionService.handleAppBackgrounded()
            case .active:
                onDeviceTranscriptionService.handleAppForegrounded()
            default:
                break
            }
        }
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
