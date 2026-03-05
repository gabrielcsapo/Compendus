//
//  ProfileView.swift
//  Compendus
//
//  Profile management page with avatar upload via PhotosPicker
//

import SwiftUI
import PhotosUI

struct ProfileView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(APIService.self) private var apiService

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

    private let emojiSuggestions = [
        "\u{1F60A}", "\u{1F4DA}", "\u{1F98A}", "\u{1F31F}", "\u{1F3A8}", "\u{1F3B5}",
        "\u{1F308}", "\u{1F680}", "\u{1F431}", "\u{1F33A}", "\u{1F989}", "\u{1F340}",
    ]

    var body: some View {
        Form {
            avatarSection
            profileInfoSection
            actionsSection
        }
        .navigationTitle("Profile")
        .task { await loadProfile() }
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
            PinChangeSheet(hasExistingPin: currentProfile?.hasPin == true) { newPin in
                Task { await updatePin(newPin) }
            }
        }
        .sheet(isPresented: $showingNameSheet) {
            NameChangeSheet(currentName: currentProfile?.name ?? serverConfig.selectedProfileName ?? "") { newName in
                Task { await updateName(newName) }
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
                        ProgressView("Uploading...")
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

    // MARK: - Actions

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
        guard let profileId = serverConfig.selectedProfileId else { return }
        do {
            let updated = try await apiService.updateProfile(id: profileId, avatar: .some(emoji))
            await MainActor.run {
                serverConfig.selectProfile(updated)
                currentProfile = updated
            }
        } catch {
            await MainActor.run {
                errorMessage = "Failed to update avatar"
                showingError = true
            }
        }
    }

    private func updateName(_ newName: String) async {
        guard let profileId = serverConfig.selectedProfileId else { return }
        do {
            let updated = try await apiService.updateProfile(id: profileId, name: newName)
            await MainActor.run {
                serverConfig.selectProfile(updated)
                currentProfile = updated
            }
        } catch {
            await MainActor.run {
                errorMessage = "Failed to update name"
                showingError = true
            }
        }
    }

    private func updatePin(_ newPin: String?) async {
        guard let profileId = serverConfig.selectedProfileId else { return }
        do {
            let updated = try await apiService.updateProfile(id: profileId, pin: .some(newPin))
            await MainActor.run {
                serverConfig.selectProfile(updated)
                currentProfile = updated
            }
        } catch {
            await MainActor.run {
                errorMessage = "Failed to update PIN"
                showingError = true
            }
        }
    }

    private func removeAvatar() async {
        guard let profileId = serverConfig.selectedProfileId else { return }
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
            }
        } catch {
            await MainActor.run {
                errorMessage = "Failed to remove avatar"
                showingError = true
            }
        }
    }
}

// MARK: - Name Change Sheet

private struct NameChangeSheet: View {
    let currentName: String
    let onSave: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .textInputAutocapitalization(.words)
                        .autocorrectionDisabled()
                }
            }
            .navigationTitle("Change Name")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        dismiss()
                        onSave(name.trimmingCharacters(in: .whitespaces))
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || name.trimmingCharacters(in: .whitespaces) == currentName)
                }
            }
            .onAppear { name = currentName }
        }
        .presentationDetents([.medium])
    }
}

// MARK: - PIN Change Sheet

private struct PinChangeSheet: View {
    let hasExistingPin: Bool
    let onSave: (String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var pin = ""
    @State private var confirmPin = ""
    @State private var showingRemoveConfirmation = false

    private var isValid: Bool {
        pin.count == 4 && pin == confirmPin && pin.allSatisfy(\.isNumber)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    SecureField("New 4-digit PIN", text: $pin)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)

                    SecureField("Confirm PIN", text: $confirmPin)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
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
                    }
                }
            }
            .navigationTitle(hasExistingPin ? "Change PIN" : "Set PIN")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        dismiss()
                        onSave(pin)
                    }
                    .disabled(!isValid)
                }
            }
            .confirmationDialog("Remove PIN?", isPresented: $showingRemoveConfirmation) {
                Button("Remove PIN", role: .destructive) {
                    dismiss()
                    onSave(nil)
                }
            } message: {
                Text("Anyone will be able to access this profile without a PIN.")
            }
        }
        .presentationDetents([.medium])
    }
}
