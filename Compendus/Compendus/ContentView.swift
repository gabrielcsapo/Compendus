//
//  ContentView.swift
//  Compendus
//
//  Main navigation with custom bottom bar integrating mini player and tabs
//

import SwiftUI
import SwiftData

struct ContentView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(AppNavigation.self) private var appNavigation
    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(\.modelContext) private var modelContext
    @Environment(\.deepLinkBookId) private var deepLinkBookId
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var deepLinkedBook: DownloadedBook?
    @State private var showDataMigration = false

    var body: some View {
        Group {
            if !hasCompletedOnboarding {
                OnboardingView()
            } else if serverConfig.isConfigured && serverConfig.invalidatedProfileId != nil {
                ProfileInvalidatedView()
            } else if serverConfig.isConfigured && !serverConfig.isProfileSelected {
                ProfilePickerView()
            } else if serverConfig.isConfigured {
                @Bindable var nav = appNavigation
                @Bindable var player = audiobookPlayer
                VStack(spacing: 0) {
                    TabView(selection: $nav.selectedTab) {
                        DownloadsView()
                            .tabItem { Label("Home", systemImage: "house") }
                            .tag(0)
                            .toolbar(.hidden, for: .tabBar)

                        LibraryView()
                            .tabItem { Label("Library", systemImage: "books.vertical") }
                            .tag(1)
                            .toolbar(.hidden, for: .tabBar)

                        HighlightsView()
                            .tabItem { Label("Highlights", systemImage: "highlighter") }
                            .tag(2)
                            .toolbar(.hidden, for: .tabBar)

                        SettingsView()
                            .tabItem { Label("Settings", systemImage: "gear") }
                            .tag(3)
                            .toolbar(.hidden, for: .tabBar)
                    }

                    // Integrated bottom bar: mini player + tab icons
                    CustomBottomBar(selectedTab: $nav.selectedTab)
                }
                .sheet(isPresented: $player.isFullPlayerPresented) {
                    if let book = audiobookPlayer.currentBook {
                        AudiobookPlayerView(book: book)
                            .environment(readerSettings)
                    }
                }
                .onChange(of: deepLinkBookId.wrappedValue) { _, newBookId in
                    if let bookId = newBookId {
                        openBookFromDeepLink(bookId)
                    }
                }
                .fullScreenCover(item: $deepLinkedBook) { book in
                    ReaderContainerView(book: book)
                        .environment(readerSettings)
                }
                .sheet(isPresented: $showDataMigration) {
                    DataMigrationView()
                }
                .task(id: serverConfig.selectedProfileId) {
                    guard serverConfig.isProfileSelected else { return }
                    let descriptor = FetchDescriptor<DownloadedBook>(predicate: #Predicate { $0.profileId == "" })
                    if let count = try? modelContext.fetchCount(descriptor), count > 0 {
                        showDataMigration = true
                    }
                }
            } else {
                ServerSetupView()
            }
        }
    }

    private func openBookFromDeepLink(_ bookId: String) {
        let pid = serverConfig.selectedProfileId ?? ""
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId && ($0.profileId == pid || $0.profileId.isEmpty) }
        )

        if let book = try? modelContext.fetch(descriptor).first {
            if book.isAudiobook {
                Task {
                    await audiobookPlayer.loadBook(book)
                    audiobookPlayer.play()
                    audiobookPlayer.isFullPlayerPresented = true
                }
            } else {
                deepLinkedBook = book
            }
            appNavigation.selectedTab = 0
        }

        deepLinkBookId.wrappedValue = nil
    }
}

// MARK: - Custom Bottom Bar

struct CustomBottomBar: View {
    @Binding var selectedTab: Int
    @Environment(AudiobookPlayer.self) private var player
    @Environment(ThemeManager.self) private var themeManager

    private struct TabItem {
        let icon: String
        let activeIcon: String
        let label: String
    }

    private let tabs: [TabItem] = [
        TabItem(icon: "house", activeIcon: "house.fill", label: "Home"),
        TabItem(icon: "books.vertical", activeIcon: "books.vertical.fill", label: "Library"),
        TabItem(icon: "highlighter", activeIcon: "highlighter", label: "Highlights"),
        TabItem(icon: "gear", activeIcon: "gearshape.fill", label: "Settings"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Mini player (when active)
            if player.hasActiveSession && !player.isFullPlayerPresented {
                MiniPlayerView()
            }

            Divider()

            // Tab buttons
            HStack(spacing: 0) {
                ForEach(0..<tabs.count, id: \.self) { index in
                    Button {
                        selectedTab = index
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: selectedTab == index ? tabs[index].activeIcon : tabs[index].icon)
                                .font(.system(size: 20))

                            Text(tabs[index].label)
                                .font(.caption2)
                        }
                        .foregroundStyle(selectedTab == index ? themeManager.accentColor : .secondary)
                        .frame(maxWidth: .infinity)
                    }
                }
            }
            .padding(.top, 8)
            .padding(.bottom, 4)
        }
        .background(.ultraThinMaterial)
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
                        .foregroundStyle(.accent)

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
                        .background(serverURL.isEmpty ? Color.gray : Color.accentColor)
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
        .environment(AppNavigation())
        .environment(AudiobookPlayer())
        .environment(StorageManager())
        .modelContainer(for: DownloadedBook.self, inMemory: true)
}
