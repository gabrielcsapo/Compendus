//
//  ContentView.swift
//  Compendus
//
//  Main navigation with TabView for Library, Downloads, and Settings
//

import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(\.modelContext) private var modelContext
    @Environment(\.deepLinkBookId) private var deepLinkBookId
    @State private var selectedTab = 0
    @State private var deepLinkedBook: DownloadedBook?

    var body: some View {
        Group {
            if serverConfig.isConfigured {
                TabView(selection: $selectedTab) {
                    LibraryView()
                        .tabItem {
                            Label("Library", systemImage: "books.vertical")
                        }
                        .tag(0)

                    DownloadsView()
                        .tabItem {
                            Label("Downloads", systemImage: "arrow.down.circle")
                        }
                        .tag(1)

                    HighlightsView()
                        .tabItem {
                            Label("Highlights", systemImage: "highlighter")
                        }
                        .tag(2)

                    SettingsView()
                        .tabItem {
                            Label("Settings", systemImage: "gear")
                        }
                        .tag(3)
                }
                .onChange(of: deepLinkBookId.wrappedValue) { _, newBookId in
                    if let bookId = newBookId {
                        openBookFromDeepLink(bookId)
                    }
                }
                .fullScreenCover(item: $deepLinkedBook) { book in
                    ReaderContainerView(book: book)
                }
                .task {
                    // One-time migration of old Readium-format highlight locators
                    HighlightMigration.migrateIfNeeded(modelContext: modelContext)
                }
            } else {
                ServerSetupView()
            }
        }
    }

    private func openBookFromDeepLink(_ bookId: String) {
        // Find the downloaded book
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId }
        )

        if let book = try? modelContext.fetch(descriptor).first {
            deepLinkedBook = book
            // Switch to downloads tab
            selectedTab = 1
        }

        // Clear the deep link
        deepLinkBookId.wrappedValue = nil
    }
}

/// Initial setup view when server is not configured
struct ServerSetupView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @State private var serverURL = ""
    @State private var isTestingConnection = false
    @State private var connectionError: String?
    @State private var showingError = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                Spacer()

                VStack(spacing: 16) {
                    Image(systemName: "books.vertical.fill")
                        .font(.system(size: 80))
                        .foregroundStyle(.blue)

                    Text("Compendus")
                        .font(.largeTitle)
                        .fontWeight(.bold)

                    Text("Connect to your library server")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 16) {
                    TextField("Server URL (e.g., 192.168.1.100:3000)", text: $serverURL)
                        .textFieldStyle(.roundedBorder)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .padding(.horizontal)

                    Button {
                        testAndSaveConnection()
                    } label: {
                        HStack {
                            if isTestingConnection {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Text(isTestingConnection ? "Connecting..." : "Connect")
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(serverURL.isEmpty ? Color.gray : Color.blue)
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                    }
                    .disabled(serverURL.isEmpty || isTestingConnection)
                    .padding(.horizontal)
                }

                Spacer()

                Text("Make sure your Compendus server is running and accessible on the same network.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding()
            }
            .navigationTitle("Setup")
            .navigationBarTitleDisplayMode(.inline)
            .alert("Connection Failed", isPresented: $showingError) {
                Button("OK", role: .cancel) { }
            } message: {
                Text(connectionError ?? "Unable to connect to the server. Please check the URL and try again.")
            }
        }
    }

    private func testAndSaveConnection() {
        isTestingConnection = true
        connectionError = nil

        // Temporarily set the URL for testing
        let tempConfig = ServerConfig()
        tempConfig.serverURL = serverURL

        Task {
            let success = await tempConfig.testConnection()

            await MainActor.run {
                isTestingConnection = false

                if success {
                    serverConfig.serverURL = serverURL
                } else {
                    connectionError = "Unable to connect to the server. Please check the URL and make sure the server is running."
                    showingError = true
                }
            }
        }
    }
}

#Preview {
    ContentView()
        .environment(ServerConfig())
        .environment(StorageManager())
        .modelContainer(for: DownloadedBook.self, inMemory: true)
}
