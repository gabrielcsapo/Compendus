import XCTest
import SwiftData
@testable import Compendus

@MainActor
final class OfflineHardeningTests: XCTestCase {
    override func tearDown() {
        ConnectivityMonitor.shared.manualOfflineMode = false
        LocalNetworkSessionDelegate.clearPinnedCertificate(for: "offline-test.local")
        super.tearDown()
    }

    func testOfflineModeRejectsAPIRequestBeforeURLSession() async {
        ConnectivityMonitor.shared.manualOfflineMode = true
        let service = APIService(config: ServerConfig())
        let request = URLRequest(url: URL(string: "https://offline-test.local/must-not-connect")!)

        do {
            _ = try await service.performDataRequest(request)
            XCTFail("Offline Mode allowed a URLSession request")
        } catch APIError.offline {
            // Expected: the request is rejected before URLSession is entered.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testCertificatePinCanOnlyChangeAfterExplicitReset() {
        let host = "offline-test.local"
        let key = "compendus.tls.certificate." + host.data(using: .utf8)!.base64EncodedString()
        UserDefaults.standard.set("first", forKey: key)

        XCTAssertEqual(LocalNetworkSessionDelegate.pinnedFingerprint(for: host), "first")
        LocalNetworkSessionDelegate.clearPinnedCertificate(for: host)
        XCTAssertNil(LocalNetworkSessionDelegate.pinnedFingerprint(for: host))
    }

    func testInterruptedInstallRestoresLastCommittedArtifact() throws {
        let container = try makeDownloadContainer()
        let context = ModelContext(container)
        let id = UUID().uuidString
        let pending = PendingDownload(
            id: id,
            bookId: id,
            title: "Recovery Test",
            authors: ["Compendus"],
            format: "pdf",
            originalFormat: "pdf",
            fileSize: 3,
            downloadURL: "https://offline-test.local/book"
        )
        pending.status = "installing"
        context.insert(pending)
        try context.save()

        let paths = try makeInterruptedInstallFixture(bookId: id)
        defer { try? FileManager.default.removeItem(at: paths.destination) }

        let config = ServerConfig()
        let manager = DownloadManager(config: config, apiService: APIService(config: config))
        manager.modelContainer = container
        manager.recoverInterruptedInstalls()

        XCTAssertEqual(try Data(contentsOf: paths.destination), Data("old".utf8))
        XCTAssertFalse(FileManager.default.fileExists(atPath: paths.backup.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: paths.journal.path))
        XCTAssertEqual(try context.fetch(FetchDescriptor<PendingDownload>()).first?.status, "interrupted")
    }

    func testCommittedInstallKeepsDestinationAndCleansBackup() throws {
        let container = try makeDownloadContainer()
        let id = UUID().uuidString
        let paths = try makeInterruptedInstallFixture(bookId: id)
        defer { try? FileManager.default.removeItem(at: paths.destination) }

        let config = ServerConfig()
        let manager = DownloadManager(config: config, apiService: APIService(config: config))
        manager.modelContainer = container
        manager.recoverInterruptedInstalls()

        XCTAssertEqual(try Data(contentsOf: paths.destination), Data("new".utf8))
        XCTAssertFalse(FileManager.default.fileExists(atPath: paths.backup.path))
        XCTAssertFalse(FileManager.default.fileExists(atPath: paths.journal.path))
    }

    private func makeDownloadContainer() throws -> ModelContainer {
        let schema = Schema([DownloadedBook.self, PendingDownload.self])
        let configuration = ModelConfiguration(schema: schema, isStoredInMemoryOnly: true)
        return try ModelContainer(for: schema, configurations: [configuration])
    }

    private func makeInterruptedInstallFixture(bookId: String) throws -> (
        destination: URL,
        backup: URL,
        journal: URL
    ) {
        let fm = FileManager.default
        let documents = fm.urls(for: .documentDirectory, in: .userDomainMask).first!
        let books = documents.appendingPathComponent("books", isDirectory: true)
        let staging = documents.appendingPathComponent(".download-staging", isDirectory: true)
        try fm.createDirectory(at: books, withIntermediateDirectories: true)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        let destination = books.appendingPathComponent("\(bookId).pdf")
        let backup = staging.appendingPathComponent("\(UUID().uuidString).install-backup")
        let journal = staging.appendingPathComponent("\(bookId).install-journal.json")
        try Data("new".utf8).write(to: destination)
        try Data("old".utf8).write(to: backup)
        let payload: [String: Any] = [
            "bookId": bookId,
            "destinationPath": destination.path,
            "backupPath": backup.path,
        ]
        try JSONSerialization.data(withJSONObject: payload).write(to: journal, options: .atomic)
        return (destination, backup, journal)
    }
}
