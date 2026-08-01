//
//  ContentView.swift
//  Compendus
//
//  Main navigation with custom bottom bar integrating mini player and tabs
//

import SwiftUI
import SwiftData
import CCReader

// MARK: - Mac Catalyst Sidebar Navigation

#if targetEnvironment(macCatalyst)
private enum MacSidebarItem: Hashable {
    // On Device (downloaded books — DownloadsView)
    case deviceAll, deviceEbooks, deviceAudiobooks, deviceComics, deviceSeries
    // Library (server — LibraryView)
    case libraryAll, libraryEbooks, libraryAudiobooks, libraryComics, librarySeries
    // Other
    case highlights
    case wander
    case settings
    case profile

    var chipId: String {
        switch self {
        case .deviceAll, .libraryAll: return "all"
        case .deviceEbooks, .libraryEbooks: return "ebooks"
        case .deviceAudiobooks, .libraryAudiobooks: return "audiobooks"
        case .deviceComics, .libraryComics: return "comics"
        case .deviceSeries, .librarySeries: return "series"
        default: return "all"
        }
    }

    var isLibrarySection: Bool {
        switch self {
        case .libraryAll, .libraryEbooks, .libraryAudiobooks, .libraryComics, .librarySeries:
            return true
        default:
            return false
        }
    }
}
#endif

struct ContentView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(ReaderSettings.self) private var readerSettings
    @Environment(AppNavigation.self) private var appNavigation
    @Environment(AudiobookPlayer.self) private var audiobookPlayer
    @Environment(APIService.self) private var apiService
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(StorageManager.self) private var storageManager
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(\.modelContext) private var modelContext
    @Environment(\.deepLinkBookId) private var deepLinkBookId
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var deepLinkedBook: DownloadedBook?
    @State private var showDataMigration = false
    #if targetEnvironment(macCatalyst)
    @State private var macSidebarSelection: MacSidebarItem = .deviceAll
    @State private var columnVisibility: NavigationSplitViewVisibility = .all
    #endif

    var body: some View {
        Group {
            if !hasCompletedOnboarding {
                OnboardingView()
            } else if serverConfig.isConfigured && serverConfig.invalidatedProfileId != nil {
                ProfileInvalidatedView()
            } else if serverConfig.isConfigured && !serverConfig.isProfileSelected {
                ProfilePickerView()
            } else if serverConfig.isConfigured {
                configuredView
            } else {
                ServerSetupView()
            }
        }
    }

    // MARK: - Configured View

    @ViewBuilder
    private var configuredView: some View {
        @Bindable var player = audiobookPlayer
        mainNavigationView
            .sheet(isPresented: $player.isFullPlayerPresented) {
                if let book = audiobookPlayer.currentBook {
                    AudiobookPlayerView(book: book)
                        .environment(serverConfig)
                        .environment(readerSettings)
                        .environment(apiService)
                        .environment(audiobookPlayer)
                        .environment(downloadManager)
                        .environment(storageManager)
                        .environment(appNavigation)
                        .environment(highlightColorManager)
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
                    .environment(highlightColorManager)
            }
            .sheet(isPresented: $showDataMigration) {
                DataMigrationView()
                    .environment(serverConfig)
            }
            .task(id: serverConfig.selectedProfileId) {
                guard serverConfig.isProfileSelected else { return }
                let descriptor = FetchDescriptor<DownloadedBook>(predicate: #Predicate { $0.profileId == "" })
                if let count = try? modelContext.fetchCount(descriptor), count > 0 {
                    showDataMigration = true
                }
            }
    }

    // MARK: - Main Navigation (Mac vs iOS)

    @ViewBuilder
    private var mainNavigationView: some View {
        #if targetEnvironment(macCatalyst)
        CelebrationOverlay {
            NavigationSplitView(columnVisibility: $columnVisibility) {
                macSidebarContent
            } detail: {
                macDetailContent
            }
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        withAnimation {
                            columnVisibility = columnVisibility == .detailOnly ? .all : .detailOnly
                        }
                    } label: {
                        Image(systemName: "sidebar.left")
                    }
                }
            }
            .onChange(of: macSidebarSelection) { _, selection in
                if selection.isLibrarySection {
                    appNavigation.libraryFilterChipId = selection.chipId
                } else {
                    appNavigation.homeFilterChipId = selection.chipId
                }
            }
        }
        #else
        CelebrationOverlay {
            iOSTabView
        }
        #endif
    }

    // MARK: - Mac Catalyst Sidebar

    #if targetEnvironment(macCatalyst)
    @ViewBuilder
    private var macSidebarContent: some View {
        List {
            Section("On Device") {
                macSidebarButton("All", icon: "books.vertical.fill", item: .deviceAll)
                macSidebarButton("Ebooks", icon: "book.closed", item: .deviceEbooks)
                macSidebarButton("Audiobooks", icon: "headphones", item: .deviceAudiobooks)
                macSidebarButton("Comics", icon: "book.pages", item: .deviceComics)
                macSidebarButton("Series", icon: "books.vertical", item: .deviceSeries)
            }
            Section("Library") {
                macSidebarButton("All", icon: "books.vertical.fill", item: .libraryAll)
                macSidebarButton("Ebooks", icon: "book.closed", item: .libraryEbooks)
                macSidebarButton("Audiobooks", icon: "headphones", item: .libraryAudiobooks)
                macSidebarButton("Comics", icon: "book.pages", item: .libraryComics)
                macSidebarButton("Series", icon: "books.vertical", item: .librarySeries)
            }
            Section {
                macSidebarButton("Highlights", icon: "highlighter", item: .highlights)
                macSidebarButton(
                    "Wander",
                    icon: "point.topleft.down.curvedto.point.bottomright.up",
                    item: .wander
                )
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .bottom) {
            macProfileRow
        }
    }

    private func macSidebarButton(_ label: String, icon: String, item: MacSidebarItem) -> some View {
        Button {
            macSidebarSelection = item
        } label: {
            Label(label, systemImage: icon)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(macSidebarSelection == item ? Color.accentColor : .primary)
        .listRowBackground(
            macSidebarSelection == item
                ? RoundedRectangle(cornerRadius: 6).fill(Color.accentColor.opacity(0.18))
                : nil
        )
    }

    @ViewBuilder
    private var macProfileRow: some View {
        HStack(spacing: 10) {
            Button {
                macSidebarSelection = .profile
            } label: {
                HStack(spacing: 10) {
                    ProfileAvatarView(serverConfig: serverConfig, size: 32)
                    Text(serverConfig.selectedProfileName ?? "Profile")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .lineLimit(1)
                        .foregroundStyle(.primary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            Spacer()

            Button {
                macSidebarSelection = .settings
            } label: {
                Image(systemName: "gearshape")
                    .foregroundStyle(.secondary)
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(.bar)
    }

    @ViewBuilder
    private var macDetailContent: some View {
        if macSidebarSelection.isLibrarySection {
            LibraryView()
        } else if macSidebarSelection == .highlights {
            HighlightsView()
        } else if macSidebarSelection == .wander {
            WanderView()
        } else if macSidebarSelection == .settings {
            NavigationStack { SettingsView() }
        } else if macSidebarSelection == .profile {
            NavigationStack { ProfileView() }
        } else {
            DownloadsView()
        }
    }
    #endif

    // MARK: - iOS Tab View

    @ViewBuilder
    private var iOSTabView: some View {
        @Bindable var nav = appNavigation
        VStack(spacing: 0) {
            TabView(selection: $nav.selectedTab) {
                DownloadsView()
                    .tabItem { Label("Today", systemImage: "house") }
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

                NavigationStack {
                    ProfileView()
                }
                    .tabItem { Label("Me", systemImage: "person") }
                    .tag(3)
                    .toolbar(.hidden, for: .tabBar)

                WanderView()
                    .tabItem {
                        Label("Explore", systemImage: "point.topleft.down.curvedto.point.bottomright.up")
                    }
                    .tag(4)
                    .toolbar(.hidden, for: .tabBar)
            }

            // Integrated bottom bar: mini player + five clear destinations.
            // Hidden on Explore (tag 4) for a full-screen, immersive experience.
            if nav.selectedTab != 4 {
                CustomBottomBar(selectedTab: $nav.selectedTab)
                    .transition(.move(edge: .bottom))
            }
        }
        .animation(.easeInOut(duration: 0.25), value: nav.selectedTab)
    }

    // MARK: - Deep Link

    private func openBookFromDeepLink(_ bookId: String) {
        let pid = serverConfig.selectedProfileId ?? ""
        let descriptor = FetchDescriptor<DownloadedBook>(
            predicate: #Predicate { $0.id == bookId && ($0.profileId == pid || $0.profileId.isEmpty) }
        )

        if let book = try? modelContext.fetch(descriptor).first {
            if book.isAudiobook {
                Task {
                    await audiobookPlayer.loadBook(book)
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
    @Environment(ServerConfig.self) private var serverConfig

    private struct TabItem {
        let icon: String
        let activeIcon: String
        let label: String
    }

    private static let profileTabIndex = 3

    private let tabs: [TabItem] = [
        TabItem(icon: "house", activeIcon: "house.fill", label: "Today"),
        TabItem(icon: "books.vertical", activeIcon: "books.vertical.fill", label: "Library"),
        TabItem(icon: "highlighter", activeIcon: "highlighter", label: "Highlights"),
        TabItem(icon: "person", activeIcon: "person.fill", label: "Me"),
        TabItem(
            icon: "point.topleft.down.curvedto.point.bottomright.up",
            activeIcon: "point.topleft.down.curvedto.point.bottomright.up",
            label: "Explore"
        ),
    ]

    var body: some View {
        VStack(spacing: 0) {
            // Mini player (when active) — its progress bar acts as the divider
            if player.hasActiveSession && !player.isFullPlayerPresented {
                MiniPlayerView()
            } else {
                Divider()
            }

            // Tab buttons
            HStack(spacing: 0) {
                ForEach(0..<tabs.count, id: \.self) { index in
                    let active = selectedTab == index
                    Button {
                        selectedTab = index
                    } label: {
                        VStack(spacing: 4) {
                            if index == Self.profileTabIndex {
                                ProfileTabIcon(
                                    isActive: active,
                                    accentColor: themeManager.accentColor,
                                    serverConfig: serverConfig
                                )
                            } else {
                                Image(systemName: active ? tabs[index].activeIcon : tabs[index].icon)
                                    .font(.system(size: 20))
                            }

                            Text(tabs[index].label)
                                .font(.caption2)
                        }
                        .foregroundStyle(active ? themeManager.accentColor : .secondary)
                        .frame(maxWidth: .infinity)
                    }
                    .accessibilityLabel(tabs[index].label)
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
            .padding(.top, 8)
            .padding(.bottom, 4)
        }
        .background(.ultraThinMaterial)
    }
}

/// Profile tab icon: avatar wrapped in a daily-goal progress ring with a streak
/// flame badge. Mirrors the web nav avatar so reading momentum is visible at a
/// glance from anywhere in the app.
private struct ProfileTabIcon: View {
    let isActive: Bool
    let accentColor: Color
    let serverConfig: ServerConfig

    @Query(sort: \ReadingSession.startedAt, order: .reverse) private var sessions: [ReadingSession]
    @AppStorage("compendus.dailyGoalMinutes") private var dailyGoalMinutes: Int = 15

    var body: some View {
        let s = StreakCalculator.compute(
            sessions: sessions,
            profileId: serverConfig.selectedProfileId ?? ""
        )
        ZStack(alignment: .bottomTrailing) {
            GoalRing(
                value: Double(s.todayMinutes),
                goal: Double(dailyGoalMinutes),
                size: 30,
                lineWidth: 2,
                progressColor: accentColor
            ) {
                ProfileAvatarView(serverConfig: serverConfig, size: 22)
                    .overlay(
                        Circle()
                            .stroke(isActive ? accentColor : .clear, lineWidth: 1.5)
                            .frame(width: 26, height: 26)
                    )
            }

            if s.streak > 0 {
                // Streak count capsule. When a freeze is propping up the
                // streak we tint blue + show a tiny shield, to match web's
                // shield indicator.
                HStack(spacing: 1) {
                    if s.hasFreeze {
                        Image(systemName: "shield.fill")
                            .font(.system(size: 7, weight: .bold))
                    }
                    Text("\(s.streak)")
                        .font(.system(size: 9, weight: .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .background(Capsule().fill(s.hasFreeze ? Color.blue : Color.orange))
                .overlay(Capsule().stroke(Color(.systemBackground), lineWidth: 1.5))
                .offset(x: 4, y: 4)
            }
        }
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

                    Text("Connect to your library server")
                        .font(.title3)
                        .fontWeight(.semibold)
                        .multilineTextAlignment(.center)
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
