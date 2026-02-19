//
//  SettingsView.swift
//  Compendus
//
//  App settings and storage management
//

import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(StorageManager.self) private var storageManager
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(\.modelContext) private var modelContext

    @State private var appSettings = AppSettings()
    @State private var editedServerURL = ""
    @State private var isTestingConnection = false
    @State private var connectionStatus: ConnectionStatus = .unknown
    @State private var showingDeleteAllConfirmation = false
    @State private var showingClearCacheConfirmation = false
    @State private var showingDisconnectConfirmation = false
    @State private var showingStorageChart = false

    enum ConnectionStatus {
        case unknown, testing, connected, failed
    }

    var body: some View {
        NavigationStack {
            Form {
                // Server section
                Section {
                    HStack {
                        TextField("Server URL", text: $editedServerURL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)

                        if editedServerURL != serverConfig.serverURL {
                            Button("Save") {
                                testAndSaveConnection()
                            }
                            .disabled(editedServerURL.isEmpty || isTestingConnection)
                        }
                    }

                    HStack {
                        Text("Status")
                        Spacer()
                        connectionStatusView
                    }

                    if let lastSync = appSettings.lastSyncTime {
                        HStack {
                            Text("Last Synced")
                            Spacer()
                            Text(lastSync.relativeString)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Button("Test Connection") {
                        testConnection()
                    }
                    .disabled(isTestingConnection || editedServerURL.isEmpty)
                } header: {
                    Text("Server")
                } footer: {
                    Text("Enter the IP address or hostname of your Compendus server (e.g., 192.168.1.100:3000)")
                }

                // Appearance section
                Section {
                    Picker("Theme", selection: $appSettings.colorSchemePreference) {
                        ForEach(ColorSchemePreference.allCases) { scheme in
                            Label(scheme.displayName, systemImage: scheme.icon)
                                .tag(scheme)
                        }
                    }

                    Picker("Grid Density", selection: $appSettings.gridDensity) {
                        ForEach(GridDensity.allCases) { density in
                            Text(density.displayName)
                                .tag(density)
                        }
                    }

                    Toggle("Haptic Feedback", isOn: $appSettings.hapticsEnabled)
                } header: {
                    Text("Appearance")
                }

                // Storage section
                Section {
                    Button {
                        showingStorageChart = true
                    } label: {
                        HStack {
                            Text("Storage Breakdown")
                            Spacer()
                            Text(storageManager.totalStorageUsedDisplay())
                                .foregroundStyle(.secondary)
                            Image(systemName: "chevron.right")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                        }
                        .foregroundStyle(.primary)
                    }

                    HStack {
                        Text("Books")
                        Spacer()
                        Text(ByteCountFormatter.string(fromByteCount: storageManager.totalBooksStorageUsed(), countStyle: .file))
                            .foregroundStyle(.secondary)
                    }

                    HStack {
                        Text("Comic Cache")
                        Spacer()
                        Text(ByteCountFormatter.string(fromByteCount: storageManager.comicCacheSize(), countStyle: .file))
                            .foregroundStyle(.secondary)
                    }

                    HStack {
                        Text("Available")
                        Spacer()
                        Text(storageManager.availableDiskSpaceDisplay())
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Storage")
                }

                // Actions section
                Section {
                    Button(role: .destructive) {
                        showingClearCacheConfirmation = true
                    } label: {
                        Label("Clear Comic Cache", systemImage: "trash")
                    }

                    Button(role: .destructive) {
                        showingDeleteAllConfirmation = true
                    } label: {
                        Label("Delete All Downloads", systemImage: "trash.fill")
                    }
                } header: {
                    Text("Actions")
                }

                // Account section
                Section {
                    Button(role: .destructive) {
                        showingDisconnectConfirmation = true
                    } label: {
                        Label("Disconnect from Server", systemImage: "wifi.slash")
                    }
                } header: {
                    Text("Account")
                } footer: {
                    Text("This will clear the server URL and return to the setup screen. Your downloaded books will be preserved.")
                }

                // About section
                Section {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                            .foregroundStyle(.secondary)
                    }

                    HStack {
                        Text("Build")
                        Spacer()
                        Text(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1")
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("About")
                }

                #if DEBUG
                // Developer section
                Section {
                    NavigationLink {
                        SampleEPUBListView()
                    } label: {
                        Label("Sample EPUBs", systemImage: "books.vertical")
                    }
                } header: {
                    Text("Developer")
                }
                #endif
            }
            .navigationTitle("Settings")
            .onAppear {
                editedServerURL = serverConfig.serverURL
                if serverConfig.isConfigured {
                    testConnection()
                }
            }
            .confirmationDialog("Delete All Downloads?", isPresented: $showingDeleteAllConfirmation, titleVisibility: .visible) {
                Button("Delete All", role: .destructive) {
                    deleteAllDownloads()
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This will remove all downloaded books from your device. You can download them again from your library.")
            }
            .confirmationDialog("Clear Comic Cache?", isPresented: $showingClearCacheConfirmation, titleVisibility: .visible) {
                Button("Clear Cache", role: .destructive) {
                    clearComicCache()
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This will clear cached comic pages. They will be re-downloaded when you open comics.")
            }
            .confirmationDialog("Disconnect from Server?", isPresented: $showingDisconnectConfirmation, titleVisibility: .visible) {
                Button("Disconnect", role: .destructive) {
                    disconnect()
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("This will clear the server URL. Your downloaded books will be preserved.")
            }
            .sheet(isPresented: $showingStorageChart) {
                NavigationStack {
                    StorageRingChart(
                        segments: [
                            StorageSegment(
                                category: "Books",
                                bytes: storageManager.totalBooksStorageUsed(),
                                color: .blue
                            ),
                            StorageSegment(
                                category: "Comic Cache",
                                bytes: storageManager.comicCacheSize(),
                                color: .purple
                            )
                        ],
                        availableBytes: storageManager.availableDiskSpace()
                    )
                    .navigationTitle("Storage")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") {
                                showingStorageChart = false
                            }
                        }
                    }
                }
                .presentationDetents([.medium])
            }
            .preferredColorScheme(appSettings.colorScheme)
        }
    }

    @ViewBuilder
    private var connectionStatusView: some View {
        switch connectionStatus {
        case .unknown:
            Text("Unknown")
                .foregroundStyle(.secondary)
        case .testing:
            HStack(spacing: 4) {
                ProgressView()
                    .scaleEffect(0.8)
                Text("Testing...")
            }
            .foregroundStyle(.secondary)
        case .connected:
            HStack(spacing: 4) {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Connected")
                    .foregroundStyle(.green)
            }
        case .failed:
            HStack(spacing: 4) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(.red)
                Text("Failed")
                    .foregroundStyle(.red)
            }
        }
    }

    private func testConnection() {
        connectionStatus = .testing

        Task {
            let tempConfig = ServerConfig()
            tempConfig.serverURL = editedServerURL
            let success = await tempConfig.testConnection()

            await MainActor.run {
                connectionStatus = success ? .connected : .failed
                if success {
                    appSettings.updateLastSyncTime()
                }
            }
        }
    }

    private func testAndSaveConnection() {
        isTestingConnection = true
        connectionStatus = .testing

        Task {
            let tempConfig = ServerConfig()
            tempConfig.serverURL = editedServerURL
            let success = await tempConfig.testConnection()

            await MainActor.run {
                isTestingConnection = false
                connectionStatus = success ? .connected : .failed

                if success {
                    serverConfig.serverURL = editedServerURL
                }
            }
        }
    }

    private func deleteAllDownloads() {
        try? downloadManager.deleteAllBooks(modelContext: modelContext)
    }

    private func clearComicCache() {
        try? storageManager.clearComicCache()
    }

    private func disconnect() {
        serverConfig.serverURL = ""
        editedServerURL = ""
        connectionStatus = .unknown
    }
}

#Preview {
    SettingsView()
        .environment(ServerConfig())
        .environment(StorageManager())
        .environment(DownloadManager(config: ServerConfig(), apiService: APIService(config: ServerConfig())))
        .modelContainer(for: DownloadedBook.self, inMemory: true)
}
