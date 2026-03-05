//
//  ProfilePickerView.swift
//  Compendus
//
//  Netflix-style profile picker for multi-user support
//

import SwiftUI

struct ProfilePickerView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(APIService.self) private var apiService

    @State private var profiles: [Profile] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    @State private var showingPinEntry = false
    @State private var selectedLockedProfile: Profile?
    @State private var pinInput = ""
    @State private var pinError: String?
    @State private var isSelectingProfile = false

    @State private var showingCreateSheet = false

    private let columns = [
        GridItem(.adaptive(minimum: 120, maximum: 160), spacing: 24)
    ]

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 16) {
                Image(systemName: "books.vertical.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.accent)

                Text("Who's Reading?")
                    .font(.largeTitle)
                    .fontWeight(.bold)
            }
            .padding(.bottom, 40)

            if isLoading {
                ProgressView("Loading profiles...")
                    .padding()
            } else if let error = errorMessage {
                VStack(spacing: 12) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 36))
                        .foregroundStyle(.secondary)

                    Text(error)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)

                    Button("Try Again") {
                        loadProfiles()
                    }
                    .buttonStyle(.bordered)
                }
                .padding()
            } else {
                LazyVGrid(columns: columns, spacing: 24) {
                    ForEach(profiles) { profile in
                        ProfileCard(profile: profile) {
                            handleProfileTap(profile)
                        }
                    }

                    // Add Profile card
                    AddProfileCard {
                        showingCreateSheet = true
                    }
                }
                .padding(.horizontal, 32)
            }

            Spacer()
        }
        .task {
            loadProfiles()
        }
        .sheet(isPresented: $showingPinEntry) {
            PinEntrySheet(
                profileName: selectedLockedProfile?.name ?? "",
                pin: $pinInput,
                error: $pinError,
                isLoading: $isSelectingProfile,
                onSubmit: { submitPin() },
                onCancel: {
                    showingPinEntry = false
                    pinInput = ""
                    pinError = nil
                    selectedLockedProfile = nil
                }
            )
            .presentationDetents([.height(280)])
        }
        .sheet(isPresented: $showingCreateSheet) {
            CreateProfileSheet(
                onCreated: { profile in
                    profiles.append(profile)
                    showingCreateSheet = false
                },
                onCancel: {
                    showingCreateSheet = false
                }
            )
            .presentationDetents([.medium])
        }
    }

    private func loadProfiles() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                let fetched = try await apiService.fetchProfiles()
                await MainActor.run {
                    profiles = fetched
                    isLoading = false
                }
            } catch {
                await MainActor.run {
                    errorMessage = "Could not load profiles. Please check your connection."
                    isLoading = false
                }
            }
        }
    }

    private func handleProfileTap(_ profile: Profile) {
        if profile.hasPin {
            selectedLockedProfile = profile
            pinInput = ""
            pinError = nil
            showingPinEntry = true
        } else {
            selectProfile(profile, pin: nil)
        }
    }

    private func submitPin() {
        guard let profile = selectedLockedProfile else { return }
        selectProfile(profile, pin: pinInput)
    }

    private func selectProfile(_ profile: Profile, pin: String?) {
        isSelectingProfile = true

        Task {
            do {
                let selectedProfile = try await apiService.selectProfile(id: profile.id, pin: pin)
                await MainActor.run {
                    serverConfig.selectProfile(selectedProfile)
                    isSelectingProfile = false
                    showingPinEntry = false
                    pinInput = ""
                    pinError = nil
                    selectedLockedProfile = nil
                }
            } catch let error as APIError {
                await MainActor.run {
                    isSelectingProfile = false
                    if case .serverError(401, _) = error {
                        pinError = "Incorrect PIN. Please try again."
                        pinInput = ""
                    } else {
                        pinError = error.localizedDescription
                    }
                }
            } catch {
                await MainActor.run {
                    isSelectingProfile = false
                    pinError = "Something went wrong. Please try again."
                }
            }
        }
    }
}

// MARK: - Profile Card

private struct ProfileCard: View {
    let profile: Profile
    @Environment(ServerConfig.self) private var serverConfig
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 10) {
                ZStack {
                    ProfileAvatarView(profile: profile, serverConfig: serverConfig, size: 80)

                    if profile.hasPin {
                        Image(systemName: "lock.fill")
                            .font(.caption)
                            .foregroundStyle(.white)
                            .padding(4)
                            .background(Color.secondary)
                            .clipShape(Circle())
                            .offset(x: 28, y: 28)
                    }
                }

                Text(profile.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)
                    .foregroundStyle(.primary)
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Add Profile Card

private struct AddProfileCard: View {
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(spacing: 10) {
                Circle()
                    .strokeBorder(Color.secondary.opacity(0.4), style: StrokeStyle(lineWidth: 2, dash: [6]))
                    .frame(width: 80, height: 80)
                    .overlay {
                        Image(systemName: "plus")
                            .font(.system(size: 28))
                            .foregroundStyle(.secondary)
                    }

                Text("Add Profile")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - PIN Entry Sheet

struct PinEntrySheet: View {
    let profileName: String
    @Binding var pin: String
    @Binding var error: String?
    @Binding var isLoading: Bool
    let onSubmit: () -> Void
    let onCancel: () -> Void

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                Text("Enter PIN for \(profileName)")
                    .font(.headline)

                SecureField("PIN", text: $pin)
                    .textFieldStyle(.roundedBorder)
                    .keyboardType(.numberPad)
                    .padding(.horizontal)

                if let error = error {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                Button {
                    onSubmit()
                } label: {
                    HStack {
                        if isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        }
                        Text(isLoading ? "Verifying..." : "Continue")
                    }
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(pin.isEmpty ? Color.gray : Color.accentColor)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                }
                .disabled(pin.isEmpty || isLoading)
                .padding(.horizontal)
            }
            .padding(.vertical)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
            }
        }
    }
}

// MARK: - Create Profile Sheet

struct CreateProfileSheet: View {
    @Environment(APIService.self) private var apiService

    @State private var name = ""
    @State private var avatar = ""
    @State private var pin = ""
    @State private var usePin = false
    @State private var isCreating = false
    @State private var errorMessage: String?

    let onCreated: (Profile) -> Void
    let onCancel: () -> Void

    private let emojiSuggestions = ["😊", "📚", "🦊", "🌟", "🎨", "🎵", "🌈", "🚀", "🐱", "🌺", "🦉", "🍀"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name", text: $name)
                        .textInputAutocapitalization(.words)
                } header: {
                    Text("Profile Name")
                }

                Section {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(emojiSuggestions, id: \.self) { emoji in
                                Button {
                                    avatar = emoji
                                } label: {
                                    Text(emoji)
                                        .font(.system(size: 28))
                                        .padding(6)
                                        .background(
                                            avatar == emoji
                                                ? Color.accentColor.opacity(0.2)
                                                : Color.clear
                                        )
                                        .clipShape(RoundedRectangle(cornerRadius: 8))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text("Avatar")
                }

                Section {
                    Toggle("Require PIN", isOn: $usePin)

                    if usePin {
                        SecureField("4-digit PIN", text: $pin)
                            .keyboardType(.numberPad)
                    }
                } header: {
                    Text("Security")
                } footer: {
                    Text("A PIN prevents others from accidentally using your profile.")
                }

                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("New Profile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        createProfile()
                    } label: {
                        if isCreating {
                            ProgressView()
                        } else {
                            Text("Create")
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || isCreating)
                }
            }
        }
    }

    private func createProfile() {
        isCreating = true
        errorMessage = nil

        let trimmedName = name.trimmingCharacters(in: .whitespaces)
        let profileAvatar = avatar.isEmpty ? nil : avatar
        let profilePin = usePin && !pin.isEmpty ? pin : nil

        Task {
            do {
                let profile = try await apiService.createProfile(
                    name: trimmedName,
                    avatar: profileAvatar,
                    pin: profilePin
                )
                await MainActor.run {
                    isCreating = false
                    onCreated(profile)
                }
            } catch {
                await MainActor.run {
                    isCreating = false
                    errorMessage = "Failed to create profile. Please try again."
                }
            }
        }
    }
}
