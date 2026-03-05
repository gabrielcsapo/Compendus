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
            BookBookmark.self,
            PendingDownload.self,
            PendingBookEdit.self,
            ReadingSession.self,
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
    @State private var readAlongService = ReadAlongService()
    @State private var pocketTTSModelManager = PocketTTSModelManager()
    @State private var ttsAudioCache = TTSAudioCache()
    @State private var ttsPreGenerationService = TTSPreGenerationService()
    @State private var backgroundProcessingManager = BackgroundProcessingManager()

    // These are created lazily based on serverConfig
    @State private var apiService: APIService
    @State private var downloadManager: DownloadManager
    @State private var bookEditSyncService: BookEditSyncService
    @State private var syncService: SyncService

    init() {
        let config = ServerConfig()
        let api = APIService(config: config)
        let download = DownloadManager(config: config, apiService: api)
        let editSync = BookEditSyncService(apiService: api)
        let sync = SyncService(apiService: api)

        _serverConfig = State(initialValue: config)
        _apiService = State(initialValue: api)
        _downloadManager = State(initialValue: download)
        _bookEditSyncService = State(initialValue: editSync)
        _syncService = State(initialValue: sync)
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
                .environment(readAlongService)
                .environment(pocketTTSModelManager)
                .environment(ttsAudioCache)
                .environment(ttsPreGenerationService)
                .environment(backgroundProcessingManager)
                .environment(bookEditSyncService)
                .environment(syncService)
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
                    downloadManager.backgroundProcessingManager = backgroundProcessingManager
                    downloadManager.appSettings = appSettings
                    downloadManager.pocketTTSModelManager = pocketTTSModelManager
                    audiobookPlayer.modelContainer = sharedModelContainer
                    bookEditSyncService.modelContainer = sharedModelContainer
                    syncService.modelContainer = sharedModelContainer
                    onDeviceTranscriptionService.appSettings = appSettings
                    OnDeviceTranscriptionService.registerBackgroundTask(
                        service: onDeviceTranscriptionService
                    )
                    BookEditSyncService.registerBackgroundTask(
                        service: bookEditSyncService
                    )
                    SyncService.registerBackgroundTask(
                        service: syncService
                    )
                    BackgroundProcessingManager.registerBackgroundTasks(
                        manager: backgroundProcessingManager
                    )
                    backgroundProcessingManager.configure(
                        transcriptionService: onDeviceTranscriptionService,
                        ttsPreGenerationService: ttsPreGenerationService,
                        ttsAudioCache: ttsAudioCache,
                        pocketTTSModelManager: pocketTTSModelManager,
                        appSettings: appSettings,
                        modelContainer: sharedModelContainer
                    )
                }
        }
        .modelContainer(sharedModelContainer)
        .onChange(of: scenePhase) { _, newPhase in
            switch newPhase {
            case .background:
                onDeviceTranscriptionService.handleAppBackgrounded()
                bookEditSyncService.scheduleBackgroundTaskIfNeeded()
                syncService.scheduleBackgroundTask()
                backgroundProcessingManager.handleAppBackgrounded()
            case .active:
                onDeviceTranscriptionService.handleAppForegrounded()
                bookEditSyncService.handleAppForegrounded()
                syncService.handleAppForegrounded()
                backgroundProcessingManager.handleAppForegrounded()
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
