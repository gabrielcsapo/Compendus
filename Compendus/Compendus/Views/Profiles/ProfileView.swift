//
//  ProfileView.swift
//  Compendus
//
//  Profile management page with avatar upload via PhotosPicker
//

import SwiftUI
import SwiftData
import PhotosUI

struct ProfileView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(APIService.self) private var apiService
    @Environment(\.modelContext) private var modelContext

    @State private var selectedPhoto: PhotosPickerItem?
    @State private var isUploading = false
    @State private var errorMessage: String?
    @State private var showingError = false
    @State private var showingEmojiPicker = false
    @State private var currentProfile: Profile?
    @State private var isLoading = true
    @State private var showingRemoveConfirmation = false
    @State private var showingPhotoPicker = false
    @State private var showingPinSheet = false
    @State private var showingNameSheet = false
    @State private var customEmoji = ""
    @State private var streakDays: Int = 0
    @State private var todayMinutes: Int = 0
    @State private var streakHasFreeze: Bool = false
    @State private var showingStreakStats = false

    private let emojiSuggestions = [
        "\u{1F60A}", "\u{1F4DA}", "\u{1F98A}", "\u{1F31F}", "\u{1F3A8}", "\u{1F3B5}",
        "\u{1F308}", "\u{1F680}", "\u{1F431}", "\u{1F33A}", "\u{1F989}", "\u{1F340}",
    ]

    @State private var showingGoalEditor = false

    var body: some View {
        Form {
            streakSliverSection
            dailyGoalRowSection
            avatarSection
            profileInfoSection
            actionsSection
        }
        .navigationTitle("Profile")
        .task {
            await loadProfile()
            await calculateStreak()
        }
        .sheet(isPresented: $showingStreakStats) {
            ReadingDashboardView()
        }
        .onChange(of: selectedPhoto) { _, newItem in
            if let newItem {
                Task { await uploadPhoto(newItem) }
            }
        }
        .alert("Error", isPresented: $showingError) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(errorMessage ?? "An error occurred")
        }
        .confirmationDialog("Remove Avatar", isPresented: $showingRemoveConfirmation) {
            Button("Remove", role: .destructive) {
                Task { await removeAvatar() }
            }
        } message: {
            Text("Your avatar will be removed and replaced with your initial.")
        }
        .photosPicker(isPresented: $showingPhotoPicker, selection: $selectedPhoto, matching: .images)
        .sheet(isPresented: $showingEmojiPicker) {
            emojiPickerSheet
        }
        .sheet(isPresented: $showingPinSheet) {
            PinChangeSheet(hasExistingPin: currentProfile?.hasPin == true) { currentPin, newPin in
                await updatePin(currentPin: currentPin, newPin: newPin)
            }
        }
        .sheet(isPresented: $showingNameSheet) {
            NameChangeSheet(currentName: currentProfile?.name ?? serverConfig.selectedProfileName ?? "") { newName in
                await updateName(newName)
            }
        }
    }

    // MARK: - Sections

    @ViewBuilder
    private var avatarSection: some View {
        Section {
            HStack {
                Spacer()
                VStack(spacing: 12) {
                    if let profile = currentProfile {
                        ProfileAvatarView(profile: profile, serverConfig: serverConfig, size: 100)
                    } else {
                        ProfileAvatarView(serverConfig: serverConfig, size: 100)
                    }

                    if isUploading {
                        ProgressView("Updating...")
                            .font(.subheadline)
                    } else {
                        Menu {
                            Section {
                                Button {
                                    showingPhotoPicker = true
                                } label: {
                                    Label("Choose from Library", systemImage: "photo.on.rectangle")
                                }
                                Button {
                                    showingEmojiPicker = true
                                } label: {
                                    Label("Choose Emoji", systemImage: "face.smiling")
                                }
                            }
                            if serverConfig.selectedProfileAvatar != nil {
                                Section {
                                    Button(role: .destructive) {
                                        showingRemoveConfirmation = true
                                    } label: {
                                        Label("Remove Avatar", systemImage: "trash")
                                    }
                                }
                            }
                        } label: {
                            Text("Change Avatar")
                                .font(.subheadline)
                        }
                    }
                }
                Spacer()
            }
            .listRowBackground(Color.clear)
        }
    }

    @ViewBuilder
    private var profileInfoSection: some View {
        Section("Profile") {
            Button {
                showingNameSheet = true
            } label: {
                HStack {
                    Text("Name")
                    Spacer()
                    Text(currentProfile?.name ?? serverConfig.selectedProfileName ?? "Unknown")
                        .foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .foregroundStyle(.primary)
            }

            if currentProfile?.isAdmin ?? serverConfig.selectedProfileIsAdmin {
                HStack {
                    Text("Role")
                    Spacer()
                    Text("Admin")
                        .foregroundStyle(.orange)
                }
            }

            Button {
                showingPinSheet = true
            } label: {
                HStack {
                    Text("PIN Protection")
                    Spacer()
                    Text(currentProfile?.hasPin == true ? "Enabled" : "Not set")
                        .foregroundStyle(.secondary)
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .foregroundStyle(.primary)
            }

            if let createdAt = currentProfile?.createdAt,
               let date = ISO8601DateFormatter().date(from: createdAt) {
                HStack {
                    Text("Member since")
                    Spacer()
                    Text(date, style: .date)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var actionsSection: some View {
        Section {
            // Push the full Settings view onto the Profile nav stack. Mirrors
            // web's "Settings is under the profile avatar dropdown" pattern so
            // there's one Profile surface across both platforms.
            NavigationLink {
                SettingsView()
            } label: {
                Label("Settings", systemImage: "gear")
            }

            Button {
                serverConfig.clearProfile()
            } label: {
                Label("Switch Profile", systemImage: "person.2")
            }
        }
    }

    @ViewBuilder
    private var emojiPickerSheet: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 20) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 6), spacing: 12) {
                        ForEach(emojiSuggestions, id: \.self) { emoji in
                            Button {
                                showingEmojiPicker = false
                                Task { await selectEmoji(emoji) }
                            } label: {
                                Text(emoji)
                                    .font(.system(size: 36))
                                    .frame(width: 52, height: 52)
                                    .background(Color(.systemGray6))
                                    .clipShape(RoundedRectangle(cornerRadius: 10))
                            }
                        }
                    }

                    Divider()

                    VStack(spacing: 8) {
                        Text("Or pick any emoji")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        EmojiTextField(selectedEmoji: $customEmoji) { emoji in
                            showingEmojiPicker = false
                            Task { await selectEmoji(emoji) }
                        }
                        .frame(height: 60)
                        .frame(maxWidth: 80)
                    }
                }
                .padding()
            }
            .navigationTitle("Choose Emoji")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        showingEmojiPicker = false
                    }
                }
            }
        }
        .presentationDetents([.medium])
        .onDisappear { customEmoji = "" }
    }

    /// User-set daily reading goal in minutes. Mirrored from the server profile
    /// (see `APIService.fetchCurrentProfile`) and persisted in @AppStorage so
    /// every view reads the same value reactively.
    @AppStorage("compendus.dailyGoalMinutes") private var dailyGoalMinutes: Int = 15

    @ViewBuilder
    private var streakSliverSection: some View {
        Section {
            Button {
                showingStreakStats = true
            } label: {
                HStack(spacing: 14) {
                    GoalRing(
                        value: Double(todayMinutes),
                        goal: Double(dailyGoalMinutes),
                        size: 44,
                        lineWidth: 3
                    ) {
                        Image(systemName: streakDays > 0 ? "flame.fill" : "flame")
                            .font(.callout)
                            .foregroundStyle(streakDays > 0 ? .orange : .secondary)
                    }

                    VStack(alignment: .leading, spacing: 1) {
                        HStack(spacing: 4) {
                            Text(streakDays == 1 ? "1 day streak" : "\(streakDays) day streak")
                                .font(.subheadline)
                                .fontWeight(.semibold)
                                .foregroundStyle(.primary)
                            if streakHasFreeze {
                                Image(systemName: "shield.fill")
                                    .font(.caption)
                                    .foregroundStyle(.blue)
                                    .accessibilityLabel("Streak protected by freeze")
                            }
                        }
                        Text(streakSubtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if streakHasFreeze {
                            Text("Streak protected by freeze (1 missed day forgiven)")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
            .foregroundStyle(.primary)
        }
    }

    @ViewBuilder
    private var dailyGoalRowSection: some View {
        Section {
            Button {
                showingGoalEditor = true
            } label: {
                HStack {
                    Image(systemName: "target")
                        .foregroundStyle(.secondary)
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Daily reading goal")
                            .font(.subheadline)
                            .foregroundStyle(.primary)
                        Text("\(dailyGoalMinutes) minutes per day")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .sheet(isPresented: $showingGoalEditor) {
            DailyGoalSheet(
                currentGoal: dailyGoalMinutes,
                profileId: currentProfile?.id ?? serverConfig.selectedProfileId ?? ""
            )
            .presentationDetents([.medium])
        }
    }

    /// Goal-aware subtitle: tells the user how close they are to the day's goal,
    /// celebrates when they finish, and nudges when they haven't started.
    private var streakSubtitle: String {
        if todayMinutes >= dailyGoalMinutes {
            return "\u{1F389} Daily goal complete · \(todayMinutes)m today"
        }
        if todayMinutes > 0 {
            let remaining = dailyGoalMinutes - todayMinutes
            return "\(remaining)m to today's \(dailyGoalMinutes)m goal"
        }
        return "Read \(dailyGoalMinutes)m today to keep your streak"
    }

    // MARK: - Actions

    private func calculateStreak() async {
        let descriptor = FetchDescriptor<ReadingSession>(
            sortBy: [SortDescriptor(\.startedAt, order: .reverse)]
        )
        guard let allSessions = try? modelContext.fetch(descriptor), !allSessions.isEmpty else {
            streakDays = 0; todayMinutes = 0; streakHasFreeze = false; return
        }
        let pid = serverConfig.selectedProfileId ?? ""
        let result = StreakCalculator.compute(sessions: allSessions, profileId: pid)
        streakDays = result.streak
        todayMinutes = result.todayMinutes
        streakHasFreeze = result.hasFreeze
    }

    private func loadProfile() async {
        do {
            let profile = try await apiService.fetchCurrentProfile()
            await MainActor.run {
                currentProfile = profile
                isLoading = false
            }
        } catch {
            await MainActor.run {
                isLoading = false
            }
        }
    }

    private func uploadPhoto(_ item: PhotosPickerItem) async {
        isUploading = true
        selectedPhoto = nil

        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                throw APIError.invalidResponse
            }

            // Convert to JPEG for upload
            guard let uiImage = UIImage(data: data),
                  let jpegData = uiImage.jpegData(compressionQuality: 0.9) else {
                throw APIError.invalidResponse
            }

            guard let profileId = serverConfig.selectedProfileId else { return }
            let updated = try await apiService.uploadProfileAvatar(profileId: profileId, imageData: jpegData)

            await MainActor.run {
                serverConfig.selectProfile(updated)
                currentProfile = updated
                isUploading = false
            }
        } catch {
            await MainActor.run {
                isUploading = false
                errorMessage = "Failed to upload avatar"
                showingError = true
            }
        }
    }

    private func selectEmoji(_ emoji: String) async {
        isUploading = true
        guard let profileId = serverConfig.selectedProfileId else {
            isUploading = false
            return
        }
        do {
            let updated = try await apiService.updateProfile(id: profileId, avatar: .some(emoji))
            await MainActor.run {
                serverConfig.selectProfile(updated)
                currentProfile = updated
                isUploading = false
            }
        } catch {
            await MainActor.run {
                isUploading = false
                errorMessage = "Failed to update avatar"
                showingError = true
            }
        }
    }

    private func updateName(_ newName: String) async -> Bool {
        guard let profileId = serverConfig.selectedProfileId else { return false }
        do {
            let updated = try await apiService.updateProfile(id: profileId, name: newName)
            await MainActor.run {
                serverConfig.selectProfile(updated)
                currentProfile = updated
            }
            return true
        } catch {
            await MainActor.run {
                errorMessage = "Failed to update name"
                showingError = true
            }
            return false
        }
    }

    private func updatePin(currentPin: String?, newPin: String?) async -> Bool {
        guard let profileId = serverConfig.selectedProfileId else { return false }
        do {
            // Verify current PIN before allowing change
            if let currentPin {
                _ = try await apiService.selectProfile(id: profileId, pin: currentPin)
            }
            let updated = try await apiService.updateProfile(id: profileId, pin: .some(newPin))
            await MainActor.run {
                serverConfig.selectProfile(updated)
                currentProfile = updated
            }
            return true
        } catch {
            await MainActor.run {
                errorMessage = currentPin != nil ? "Current PIN is incorrect" : "Failed to update PIN"
                showingError = true
            }
            return false
        }
    }

    private func removeAvatar() async {
        isUploading = true
        guard let profileId = serverConfig.selectedProfileId else {
            isUploading = false
            return
        }
        do {
            let profile: Profile
            if serverConfig.hasImageAvatar {
                profile = try await apiService.deleteProfileAvatar(profileId: profileId)
            } else {
                profile = try await apiService.updateProfile(id: profileId, avatar: .some(nil))
            }
            await MainActor.run {
                serverConfig.selectProfile(profile)
                currentProfile = profile
                isUploading = false
            }
        } catch {
            await MainActor.run {
                isUploading = false
                errorMessage = "Failed to remove avatar"
                showingError = true
            }
        }
    }
}

// MARK: - Name Change Sheet

private struct NameChangeSheet: View {
    let currentName: String
    let onSave: (String) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                        .disabled(isSaving)
                }
            }
            .navigationTitle("Change Name")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            isSaving = true
                            Task {
                                let success = await onSave(name.trimmingCharacters(in: .whitespaces))
                                isSaving = false
                                if success { dismiss() }
                            }
                        }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name.trimmingCharacters(in: .whitespaces) == currentName)
                    }
                }
            }
            .onAppear { name = currentName }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(isSaving)
    }
}

// MARK: - PIN Change Sheet

private struct PinChangeSheet: View {
    let hasExistingPin: Bool
    let onSave: (String?, String?) async -> Bool

    @Environment(\.dismiss) private var dismiss
    @State private var currentPin = ""
    @State private var pin = ""
    @State private var confirmPin = ""
    @State private var showingRemoveConfirmation = false
    @State private var isSaving = false

    private var isValid: Bool {
        (!hasExistingPin || currentPin.count == 4) &&
        pin.count == 4 && pin == confirmPin && pin.allSatisfy(\.isNumber)
    }

    var body: some View {
        NavigationStack {
            Form {
                if hasExistingPin {
                    Section("Current PIN") {
                        SecureField("Current 4-digit PIN", text: $currentPin)
                            .keyboardType(.numberPad)
                            .textContentType(.password)
                            .disabled(isSaving)
                    }
                }

                Section {
                    SecureField("New 4-digit PIN", text: $pin)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .disabled(isSaving)

                    SecureField("Confirm PIN", text: $confirmPin)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .disabled(isSaving)
                } footer: {
                    if !pin.isEmpty && pin.count < 4 {
                        Text("PIN must be 4 digits")
                            .foregroundStyle(.red)
                    } else if !confirmPin.isEmpty && pin != confirmPin {
                        Text("PINs do not match")
                            .foregroundStyle(.red)
                    }
                }

                if hasExistingPin {
                    Section {
                        Button("Remove PIN", role: .destructive) {
                            showingRemoveConfirmation = true
                        }
                        .disabled(isSaving)
                    }
                }
            }
            .navigationTitle(hasExistingPin ? "Change PIN" : "Set PIN")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") {
                            isSaving = true
                            Task {
                                let current = hasExistingPin ? currentPin : nil
                                let success = await onSave(current, pin)
                                isSaving = false
                                if success { dismiss() }
                            }
                        }
                        .disabled(!isValid)
                    }
                }
            }
            .confirmationDialog("Remove PIN?", isPresented: $showingRemoveConfirmation) {
                Button("Remove PIN", role: .destructive) {
                    isSaving = true
                    Task {
                        let current = hasExistingPin ? currentPin : nil
                        let success = await onSave(current, nil)
                        isSaving = false
                        if success { dismiss() }
                    }
                }
            } message: {
                Text("Anyone will be able to access this profile without a PIN.")
            }
        }
        .presentationDetents([.medium])
        .interactiveDismissDisabled(isSaving)
    }
}
