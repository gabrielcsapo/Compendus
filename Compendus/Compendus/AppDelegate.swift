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
        return true
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        print("[AppDelegate] Background session events for: \(identifier)")
        backgroundSessionCompletionHandler = completionHandler
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
    static let modelContainer: ModelContainer = makeModelContainer()

    static let audiobookPlayer: AudiobookPlayer = {
        let player = AudiobookPlayer()
        player.modelContainer = modelContainer
        return player
    }()

    private static func makeModelContainer() -> ModelContainer {
        let schema = Schema([
            DownloadedBook.self,
            ReadingMark.self,
            PendingDownload.self,
            PendingBookEdit.self,
            ReadingSession.self,
        ])
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: false)

        do {
            return try ModelContainer(for: schema, configurations: [configuration])
        } catch {
            // Pre-release destructive migration: BookHighlight / BookBookmark
            // were consolidated into ReadingMark in May 2026. Old stores from
            // that schema can't be migrated automatically — wipe and rebuild.
            // Safe to do solo pre-release; remove this fallback once shipped.
            print("ModelContainer init failed (\(error)); attempting destructive reset.")
            let storeURL = URL.applicationSupportDirectory.appending(path: "default.store")
            try? FileManager.default.removeItem(at: storeURL)
            try? FileManager.default.removeItem(at: storeURL.appendingPathExtension("shm"))
            try? FileManager.default.removeItem(at: storeURL.appendingPathExtension("wal"))
            do {
                return try ModelContainer(for: schema, configurations: [configuration])
            } catch {
                fatalError("Could not create ModelContainer after reset: \(error)")
            }
        }
    }
}
