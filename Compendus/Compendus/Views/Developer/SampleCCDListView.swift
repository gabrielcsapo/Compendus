//
//  SampleCCDListView.swift
//  Compendus
//
//  Developer tool for testing the native CCD reader against bundled sample packs.
//  Only available in debug builds via ReaderSettingsView.
//

#if DEBUG
import SwiftUI
import SwiftData
import CCReader

struct SampleCCDListView: View {
    @Environment(\.modelContext) private var modelContext
    @Environment(ServerConfig.self) private var serverConfig
    @State private var selectedBook: DownloadedBook?
    @State private var sampleFiles: [(name: String, url: URL)] = []
    @State private var errorMessage: String?

    var body: some View {
        List {
            if let errorMessage {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                }
            }

            Section {
                ForEach(sampleFiles, id: \.name) { sample in
                    Button {
                        openSample(sample)
                    } label: {
                        HStack {
                            Image(systemName: "book")
                                .foregroundStyle(.blue)
                            VStack(alignment: .leading) {
                                Text(sample.name)
                                    .foregroundStyle(.primary)
                                Text(fileSizeString(for: sample.url))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            } header: {
                Text("\(sampleFiles.count) sample CCDs")
            } footer: {
                Text("Samples are unpacked to a temporary directory when opened. They will not appear in your library.")
            }
        }
        .navigationTitle("Sample CCDs")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { loadSampleFiles() }
        .fullScreenCover(item: $selectedBook) { book in
            ReaderContainerView(book: book)
                .environment(ReaderSettings())
        }
    }

    private func loadSampleFiles() {
        let bundle = Bundle.main
        let urls: [URL]
        if let samplesURL = bundle.url(forResource: "Samples", withExtension: nil, subdirectory: nil),
           let contents = try? FileManager.default.contentsOfDirectory(
               at: samplesURL,
               includingPropertiesForKeys: [.fileSizeKey],
               options: [.skipsHiddenFiles]) {
            urls = contents.filter { $0.pathExtension.lowercased() == "ccd" }
        } else {
            urls = bundle.urls(forResourcesWithExtension: "ccd", subdirectory: nil) ?? []
        }
        if urls.isEmpty {
            errorMessage = "No sample CCDs found in bundle. Run `pnpm ccd:fixtures` and rebuild."
            return
        }
        sampleFiles = urls
            .map { (name: $0.deletingPathExtension().lastPathComponent, url: $0) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func openSample(_ sample: (name: String, url: URL)) {
        do {
            // A temporary DownloadedBook keyed by sample name. The reader reads the
            // unpacked CCD pack dir (keyed by book id) — there is no source file.
            let book = DownloadedBook(
                id: "dev-sample-\(sample.name)",
                title: sample.name,
                authors: ["Sample"],
                format: "epub",
                fileSize: fileSize(for: sample.url),
                localPath: "dev-samples/\(sample.name).ccd",
                profileId: serverConfig.selectedProfileId ?? ""
            )

            // Unpack the bundled CCD pack (<name>.ccd, produced by `pnpm ccd:fixtures`)
            // into the reader's pack dir. ensureCcdPack() then finds the local manifest
            // and renders the local conversion output fully offline — no server.
            if let packDir = book.ccdPackDir {
                if FileManager.default.fileExists(atPath: packDir.path) {
                    try FileManager.default.removeItem(at: packDir)
                }
                _ = try CCDPack.unpack(zipData: try Data(contentsOf: sample.url), into: packDir)
            }

            let sampleId = book.id
            let descriptor = FetchDescriptor<DownloadedBook>(
                predicate: #Predicate<DownloadedBook> { $0.id == sampleId }
            )
            if let existing = try? modelContext.fetch(descriptor).first {
                selectedBook = existing
            } else {
                modelContext.insert(book)
                try? modelContext.save()
                selectedBook = book
            }
        } catch {
            errorMessage = "Failed to open sample: \(error.localizedDescription)"
        }
    }

    private func fileSize(for url: URL) -> Int {
        (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
    }

    private func fileSizeString(for url: URL) -> String {
        let size = fileSize(for: url)
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: Int64(size))
    }
}
#endif
