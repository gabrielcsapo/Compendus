import Foundation
import Network

/// Tracks every URLSession created by Compendus so Offline Mode is an immediate
/// process-wide cutoff, including work that began just before the toggle.
final class NetworkSessionRegistry: @unchecked Sendable {
    static let shared = NetworkSessionRegistry()

    private final class WeakSession: @unchecked Sendable {
        weak var value: URLSession?
        init(_ value: URLSession) { self.value = value }
    }

    private let lock = NSLock()
    private var dataSessions: [WeakSession] = []
    private var transferSessions: [WeakSession] = []

    private init() {}

    func registerDataSession(_ session: URLSession) {
        lock.withLock {
            dataSessions.removeAll { $0.value == nil }
            dataSessions.append(WeakSession(session))
        }
        if UserDefaults.standard.bool(forKey: "compendus.offlineMode") {
            session.getAllTasks { $0.forEach { $0.cancel() } }
        }
    }

    func registerTransferSession(_ session: URLSession) {
        lock.withLock {
            transferSessions.removeAll { $0.value == nil }
            transferSessions.append(WeakSession(session))
        }
        if UserDefaults.standard.bool(forKey: "compendus.offlineMode") {
            session.getAllTasks { $0.forEach { $0.suspend() } }
        }
    }

    func enterOfflineMode() {
        let sessions = lock.withLock {
            dataSessions.removeAll { $0.value == nil }
            transferSessions.removeAll { $0.value == nil }
            return (dataSessions.compactMap(\.value), transferSessions.compactMap(\.value))
        }
        sessions.0.forEach { session in
            session.getAllTasks { $0.forEach { $0.cancel() } }
        }
        sessions.1.forEach { session in
            session.getAllTasks { $0.forEach { $0.suspend() } }
        }
    }
}

@Observable
final class ConnectivityMonitor: @unchecked Sendable {
    static let shared = ConnectivityMonitor()

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.compendus.connectivity")
    private(set) var pathIsSatisfied = true
    private(set) var hasObservedPath = false
    var manualOfflineMode: Bool {
        didSet {
            UserDefaults.standard.set(manualOfflineMode, forKey: "compendus.offlineMode")
            if manualOfflineMode { NetworkSessionRegistry.shared.enterOfflineMode() }
        }
    }

    var permitsNetworkRequests: Bool {
        !manualOfflineMode && (!hasObservedPath || pathIsSatisfied)
    }

    private init() {
        manualOfflineMode = UserDefaults.standard.bool(forKey: "compendus.offlineMode")
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.hasObservedPath = true
                self?.pathIsSatisfied = path.status == .satisfied
            }
        }
        monitor.start(queue: queue)
    }
}
