//
//  SampleEPUBListView.swift
//  Compendus
//
//  Developer tool for testing the native EPUB renderer against bundled samples.
//  Only available in debug builds via ReaderSettingsView.
//

#if DEBUG
import SwiftUI
import SwiftData

struct SampleEPUBListView: View {
    @Environment(\.modelContext) private var modelContext
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
                Text("\(sampleFiles.count) sample EPUBs")
            } footer: {
                Text("Samples are copied to a temporary directory when opened. They will not appear in your library.")
            }
        }
        .navigationTitle("Sample EPUBs")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { loadSampleFiles() }
        .fullScreenCover(item: $selectedBook) { book in
            ReaderContainerView(book: book)
                .environment(ReaderSettings())
        }
    }

    private func loadSampleFiles() {
        guard let samplesURL = Bundle.main.url(forResource: "Samples", withExtension: nil, subdirectory: nil) else {
            // Try finding in the Reader directory
            let bundle = Bundle.main
            guard let urls = bundle.urls(forResourcesWithExtension: "epub", subdirectory: nil) else {
                errorMessage = "No sample EPUBs found in bundle"
                return
            }
            sampleFiles = urls
                .map { (name: $0.deletingPathExtension().lastPathComponent, url: $0) }
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            return
        }

        do {
            let contents = try FileManager.default.contentsOfDirectory(
                at: samplesURL,
                includingPropertiesForKeys: [.fileSizeKey],
                options: [.skipsHiddenFiles]
            )
            sampleFiles = contents
                .filter { $0.pathExtension.lowercased() == "epub" }
                .map { (name: $0.deletingPathExtension().lastPathComponent, url: $0) }
                .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        } catch {
            errorMessage = "Failed to list samples: \(error.localizedDescription)"
        }
    }

    private func openSample(_ sample: (name: String, url: URL)) {
        do {
            // Copy to a temporary location in the documents directory
            guard let docsURL = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
                errorMessage = "Could not find documents directory"
                return
            }

            let samplesDir = docsURL.appendingPathComponent("dev-samples")
            try FileManager.default.createDirectory(at: samplesDir, withIntermediateDirectories: true)

            let destURL = samplesDir.appendingPathComponent(sample.url.lastPathComponent)

            // Remove existing copy if present
            if FileManager.default.fileExists(atPath: destURL.path) {
                try FileManager.default.removeItem(at: destURL)
            }
            try FileManager.default.copyItem(at: sample.url, to: destURL)

            let localPath = "dev-samples/\(sample.url.lastPathComponent)"

            // Create a temporary DownloadedBook
            let book = DownloadedBook(
                id: "dev-sample-\(sample.name)",
                title: sample.name,
                authors: ["Sample"],
                format: "epub",
                fileSize: fileSize(for: sample.url),
                localPath: localPath
            )

            // Check if this sample already exists in the context
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
