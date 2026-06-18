//
//  SettingsView.swift
//  Compendus
//
//  App settings and storage management
//

import SwiftUI
import SwiftData
import CCReader

struct SettingsView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(StorageManager.self) private var storageManager
    @Environment(DownloadManager.self) private var downloadManager
    @Environment(\.modelContext) private var modelContext

    @Environment(AppSettings.self) private var appSettings
    @Environment(ThemeManager.self) private var themeManager
    @Environment(HighlightColorManager.self) private var highlightColorManager
    @Environment(BackgroundProcessingManager.self) private var backgroundProcessingManager
    @Environment(FleetWorkerService.self) private var fleetWorkerService
    @Environment(KokoroModelManager.self) private var kokoroModelManager
    @State private var editedServerURL = ""
    @State private var isTestingConnection = false
    @State private var connectionStatus: ConnectionStatus = .unknown
    @State private var showingDeleteAllConfirmation = false
    @State private var showingClearCacheConfirmation = false
    @State private var showingDisconnectConfirmation = false
    @State private var showingSwitchProfileConfirmation = false
    @State private var showingStorageChart = false
    @State private var editedDeviceName = DeviceIdentity.deviceName

    // P2.2 — user-configurable audiobook skip intervals
    @AppStorage("compendus.audiobook.skipBackward") private var skipBackwardSeconds: Double = 15
    @AppStorage("compendus.audiobook.skipForward") private var skipForwardSeconds: Double = 30

    enum ConnectionStatus {
        case unknown, testing, connected, failed
    }

    var body: some View {
        @Bindable var appSettings = appSettings
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

                // This device — name used when showing per-device reading position
                Section {
                    HStack {
                        Image(systemName: DeviceIdentity.icon(for: DeviceIdentity.deviceType))
                            .foregroundStyle(.secondary)
                        TextField("Device Name", text: $editedDeviceName)
                            .autocorrectionDisabled()
                        if editedDeviceName != DeviceIdentity.deviceName {
                            Button("Save") {
                                DeviceIdentity.setDeviceNameOverride(editedDeviceName)
                                editedDeviceName = DeviceIdentity.deviceName
                            }
                            .disabled(editedDeviceName.trimmingCharacters(in: .whitespaces).isEmpty)
                        }
                    }
                } header: {
                    Text("This Device")
                } footer: {
                    Text("How this device appears when you view reading progress across your devices.")
                }

                // Appearance section
                Section {
                    NavigationLink {
                        ThemePickerView()
                    } label: {
                        HStack {
                            Text("App Theme")
                            Spacer()
                            Circle()
                                .fill(themeManager.accentColor)
                                .frame(width: 20, height: 20)
                            Text(themeManager.activeTheme.name)
                                .foregroundStyle(.secondary)
                        }
                    }

                    NavigationLink {
                        HighlightColorsSettingsView()
                    } label: {
                        HStack(spacing: 8) {
                            Text("Highlight Colors")
                            Spacer()
                            HStack(spacing: -4) {
                                ForEach(highlightColorManager.colors.prefix(3)) { preset in
                                    Circle()
                                        .fill(Color(uiColor: UIColor(hex: preset.hex) ?? .yellow))
                                        .frame(width: 16, height: 16)
                                        .overlay {
                                            Circle()
                                                .strokeBorder(Color.primary.opacity(0.15), lineWidth: 1)
                                        }
                                }
                            }
                            if highlightColorManager.colors.count > 3 {
                                Text("+\(highlightColorManager.colors.count - 3)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    Picker("Appearance", selection: $appSettings.colorSchemePreference) {
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

                // Audiobook section (P2.2 — configurable skip intervals)
                Section {
                    Picker("Skip backward", selection: $skipBackwardSeconds) {
                        ForEach([5.0, 10.0, 15.0, 30.0, 45.0, 60.0], id: \.self) { v in
                            Text("\(Int(v))s").tag(v)
                        }
                    }
                    Picker("Skip forward", selection: $skipForwardSeconds) {
                        ForEach([10.0, 15.0, 30.0, 45.0, 60.0, 90.0], id: \.self) { v in
                            Text("\(Int(v))s").tag(v)
                        }
                    }
                } header: {
                    Text("Audiobook")
                } footer: {
                    Text("How far the transport buttons jump. Apple Books and Audible default to 15s back / 30s forward.")
                }

                // Background Processing section
                Section {
                    Toggle("Auto-generate read-along for eBooks", isOn: $appSettings.autoGenerateTTS)
                        .disabled(!kokoroModelManager.isModelAvailable)

                    Toggle("Auto-transcribe audiobooks", isOn: $appSettings.autoTranscribeAudiobooks)

                    Toggle("Only while charging", isOn: $appSettings.backgroundProcessingChargingOnly)

                    if case .processing(let task, let progress, let message) = backgroundProcessingManager.state {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(taskLabel(task))
                                    .font(.subheadline)
                                Spacer()
                                Text("\(Int(progress * 100))%")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            ProgressView(value: progress)
                            Text(message)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if !backgroundProcessingManager.pendingTasks.isEmpty {
                        HStack {
                            Text("Queued tasks")
                            Spacer()
                            Text("\(backgroundProcessingManager.pendingTasks.count)")
                                .foregroundStyle(.secondary)
                        }
                    }

                    NavigationLink {
                        TTSCacheBreakdownView()
                    } label: {
                        HStack {
                            Text("Generated Data")
                            Spacer()
                            Text(ByteCountFormatter.string(fromByteCount: storageManager.ttsCacheSize(), countStyle: .file))
                                .foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Background Processing")
                } footer: {
                    if !kokoroModelManager.isModelAvailable {
                        Text("TTS model not available. Download it to enable read-along generation.")
                    } else {
                        Text("Automatically generate read-along audio or transcripts when books are downloaded. Processing runs on-device while connected to power.")
                    }
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

                // Profile section
                if serverConfig.isProfileSelected {
                    Section {
                        HStack(spacing: 12) {
                            ProfileAvatarView(serverConfig: serverConfig, size: 44)

                            VStack(alignment: .leading, spacing: 2) {
                                Text(serverConfig.selectedProfileName ?? "Unknown")
                                    .font(.headline)
                                if serverConfig.selectedProfileIsAdmin {
                                    Text("Admin")
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                }
                            }

                            Spacer()
                        }
                        .padding(.vertical, 4)

                        Button {
                            showingSwitchProfileConfirmation = true
                        } label: {
                            Label("Switch Profile", systemImage: "person.2")
                        }
                    } header: {
                        Text("Profile")
                    }
                }

                // Idle Fleet section — this device works for the library while
                // it charges (compute jobs leased from the server; see the
                // semantic substrate proposal, §12).
                if serverConfig.isProfileSelected {
                    Section {
                        if fleetWorkerService.isEnrolled {
                            Toggle(isOn: Binding(
                                get: { fleetWorkerService.isEnabled },
                                set: { fleetWorkerService.isEnabled = $0 }
                            )) {
                                Label("Work While Charging", systemImage: "bolt.badge.clock")
                            }
                            HStack {
                                Text("Status")
                                Spacer()
                                Text(
                                    fleetWorkerService.isRunning
                                        ? "Working…"
                                        : fleetWorkerService.isOnExternalPower
                                            ? "Ready (plugged in)"
                                            : "Waiting for power"
                                )
                                .foregroundStyle(.secondary)
                            }
                            if fleetWorkerService.jobsCompleted > 0 {
                                HStack {
                                    Text("Jobs This Session")
                                    Spacer()
                                    Text("\(fleetWorkerService.jobsCompleted)")
                                        .foregroundStyle(.secondary)
                                }
                            }
                            if let secs = fleetWorkerService.avgJobSeconds {
                                HStack {
                                    Text("Speed")
                                    Spacer()
                                    Text(secs >= 1
                                        ? "~\(Int(secs.rounded()))s per job"
                                        : String(format: "~%.1fs per job", secs))
                                        .foregroundStyle(.secondary)
                                }
                            }
                            if let remaining = fleetWorkerService.queueRemaining {
                                HStack {
                                    Text("Queue Remaining")
                                    Spacer()
                                    Text("\(remaining) job\(remaining == 1 ? "" : "s")")
                                        .foregroundStyle(.secondary)
                                }
                                if remaining > 0, let secs = fleetWorkerService.avgJobSeconds, secs > 0 {
                                    HStack {
                                        Text("Est. Time Left")
                                        Spacer()
                                        Text(fleetEtaText(Double(remaining) * secs))
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                            if let activity = fleetWorkerService.lastActivity {
                                Text(activity)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Button(role: .destructive) {
                                fleetWorkerService.unenroll()
                            } label: {
                                Label("Remove This Device", systemImage: "minus.circle")
                            }
                        } else if serverConfig.selectedProfileIsAdmin {
                            Button {
                                Task {
                                    await fleetWorkerService.enroll(
                                        deviceName: fleetWorkerService.defaultDeviceName
                                    )
                                }
                            } label: {
                                Label("Enroll This Device", systemImage: "plus.circle")
                            }
                            if let error = fleetWorkerService.lastError {
                                Text(error)
                                    .font(.caption)
                                    .foregroundStyle(.red)
                            }
                        } else {
                            Text("An admin profile can enroll this device to help with library work while it charges.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } header: {
                        Text("Idle Fleet")
                    } footer: {
                        Text("When enrolled and plugged in, this device quietly handles background work for your library — nothing runs on battery.")
                    }
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
                        SampleCCDListView()
                    } label: {
                        Label("Sample CCDs", systemImage: "books.vertical")
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
            .confirmationDialog("Switch Profile?", isPresented: $showingSwitchProfileConfirmation, titleVisibility: .visible) {
                Button("Switch Profile") {
                    serverConfig.clearProfile()
                }
                Button("Cancel", role: .cancel) { }
            } message: {
                Text("You will be returned to the profile picker. Your downloaded books and reading data will be preserved.")
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
                StorageBreakdownView()
            }
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

    private func taskLabel(_ task: BackgroundProcessingManager.ProcessingTask) -> String {
        switch task {
        case .transcription:
            return "Transcribing audiobook"
        case .ttsGeneration:
            return "Generating read-along"
        }
    }
}

#Preview {
    SettingsView()
        .environment(ServerConfig())
        .environment(StorageManager())
        .environment(DownloadManager(config: ServerConfig(), apiService: APIService(config: ServerConfig())))
        .environment(AppSettings())
        .environment(ThemeManager())
        .environment(HighlightColorManager())
        .environment(BackgroundProcessingManager())
        .environment(KokoroModelManager())
        .modelContainer(for: DownloadedBook.self, inMemory: true)
}

/// Compact human ETA for the fleet queue ("~2h 10m", "~5m", "~30s"). This is an
/// upper bound at this device's current rate — other fleet devices drain the
/// shared queue in parallel, so the real time is usually shorter.
private func fleetEtaText(_ seconds: Double) -> String {
    let s = Int(seconds.rounded())
    if s >= 3600 {
        let h = s / 3600
        let m = (s % 3600) / 60
        return m > 0 ? "~\(h)h \(m)m" : "~\(h)h"
    }
    if s >= 60 {
        return "~\(s / 60)m"
    }
    return "~\(max(s, 1))s"
}
