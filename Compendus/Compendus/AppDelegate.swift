//
//  AppDelegate.swift
//  Compendus
//
//  Handles background URL session events for downloads that complete
//  while the app is suspended or terminated.
//

import CarPlay
import UIKit
import SwiftData

class AppDelegate: NSObject, UIApplicationDelegate {
    /// Stored by iOS when background download events are ready.
    /// Must be called after DownloadManager processes all pending events.
    var backgroundSessionCompletionHandler: (() -> Void)?

    /// CarPlay scenes are instantiated by UIKit outside the SwiftUI environment,
    /// so the audiobook player + model container are bridged through here.
    var audiobookPlayer: AudiobookPlayer?
    var modelContainer: ModelContainer?

    static var shared: AppDelegate? {
        UIApplication.shared.delegate as? AppDelegate
    }

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Force the shared services to initialize at process launch, before any
        // scene connects. The CarPlay scene can connect without the SwiftUI
        // window scene ever appearing (app launched straight from the car
        // dashboard with the phone locked), so it can't rely on ContentView's
        // onAppear to wire these up.
        audiobookPlayer = AppServices.audiobookPlayer
        modelContainer = AppServices.modelContainer
        AppServices.downloadManager.appDelegate = self
        AppServices.downloadManager.modelContainer = AppServices.modelContainer
        if AppServices.modelContainerRecoveryError == nil {
            AppServices.downloadManager.recoverInterruptedInstalls()
            AppServices.downloadManager.reconnectBackgroundSession()
        } else {
            AppServices.downloadManager.suspendAllTransfersForDatabaseRecovery()
        }
        return true
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        print("[AppDelegate] Background session events for: \(identifier)")
        backgroundSessionCompletionHandler = completionHandler
        AppServices.downloadManager.appDelegate = self
        AppServices.downloadManager.modelContainer = AppServices.modelContainer
        if AppServices.modelContainerRecoveryError == nil {
            AppServices.downloadManager.reconnectBackgroundSession()
        } else {
            AppServices.downloadManager.suspendAllTransfersForDatabaseRecovery()
            completionHandler()
            backgroundSessionCompletionHandler = nil
        }
    }

    func application(
        _ application: UIApplication,
        configurationForConnecting connectingSceneSession: UISceneSession,
        options: UIScene.ConnectionOptions
    ) -> UISceneConfiguration {
        if connectingSceneSession.role == .carTemplateApplication {
            let config = UISceneConfiguration(name: "CarPlay", sessionRole: connectingSceneSession.role)
            // Bind the delegate in code rather than via the Info.plist string.
            // GENERATE_INFOPLIST_FILE emits an empty scene manifest that
            // overrides the source plist's CarPlay entry, and the plist-only
            // reference let the linker dead-strip CarPlaySceneDelegate. A direct
            // type reference fixes both: it survives stripping and binds the
            // delegate without the plist.
            config.delegateClass = CarPlaySceneDelegate.self
            return config
        }
        return UISceneConfiguration(name: nil, sessionRole: connectingSceneSession.role)
    }
}

/// Process-wide services created lazily on first touch and shared across every
/// scene. `AppDelegate.application(_:didFinishLaunchingWithOptions:)` forces
/// them to initialize at launch so the CarPlay scene can read them even when
/// the app is launched straight into the car and the SwiftUI window scene
/// never appears. `CompendusApp` consumes these same instances, so the phone
/// UI and CarPlay drive one model container and one audiobook player.
@MainActor
enum AppServices {
    private static let modelContainerResult = makeModelContainer()
    static let modelContainer: ModelContainer = modelContainerResult.container
    static let modelContainerRecoveryError: String? = modelContainerResult.error

    static let serverConfig = ServerConfig()
    static let apiService = APIService(config: serverConfig)
    static let downloadManager: DownloadManager = {
        let manager = DownloadManager(config: serverConfig, apiService: apiService)
        manager.modelContainer = modelContainer
        return manager
    }()

    static let audiobookPlayer: AudiobookPlayer = {
        let player = AudiobookPlayer()
        player.modelContainer = modelContainer
        return player
    }()

    private static func makeModelContainer() -> (container: ModelContainer, error: String?) {
        let schema = Schema([
            DownloadedBook.self,
            ReadingMark.self,
            PendingDownload.self,
            PendingBookEdit.self,
            ReadingSession.self,
            DeviceReadingPosition.self,
        ])
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)

        do {
            return (try ModelContainer(for: schema, configurations: [configuration]), nil)
        } catch {
            // Keep the original store untouched and boot a temporary container so
            // SwiftUI can present recovery/export controls instead of terminating.
            let fallback = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
            do {
                return (
                    try ModelContainer(for: schema, configurations: [fallback]),
                    error.localizedDescription
                )
            } catch {
                fatalError("Could not create an in-memory recovery container: \(error)")
            }
        }
    }
}
