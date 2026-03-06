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

    @State private var selectedLockedProfile: Profile?

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
                .frame(maxWidth: 600)
            }

            Spacer()
        }
        .task {
            loadProfiles()
        }
        .sheet(item: $selectedLockedProfile) { (profile: Profile) in
            PinEntrySheet(
                profile: profile,
                onVerifyPin: { pin in
                    await verifyPin(for: profile, pin: pin)
                },
                onCancel: {
                    selectedLockedProfile = nil
                }
            )
            .presentationDetents([.height(560)])
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
        } else {
            selectProfile(profile)
        }
    }

    private func selectProfile(_ profile: Profile) {
        Task {
            do {
                let pin: String? = nil
                let selectedProfile = try await apiService.selectProfile(id: profile.id, pin: pin)
                await MainActor.run {
                    serverConfig.selectProfile(selectedProfile)
                }
            } catch {
                // Non-PIN profiles shouldn't fail auth
            }
        }
    }

    private func verifyPin(for profile: Profile, pin: String) async -> PinEntrySheet.PinVerificationResult {
        do {
            let selectedProfile = try await apiService.selectProfile(id: profile.id, pin: pin)
            await MainActor.run {
                serverConfig.selectProfile(selectedProfile)
                selectedLockedProfile = nil
            }
            return .success
        } catch let error as APIError {
            if case .serverError(401, _) = error {
                return .failure("Incorrect PIN. Please try again.")
            } else {
                return .failure(error.localizedDescription)
            }
        } catch {
            return .failure("Something went wrong. Please try again.")
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
    enum PinVerificationResult {
        case success
        case failure(String)
    }

    let profile: Profile
    let onVerifyPin: (String) async -> PinVerificationResult
    let onCancel: () -> Void

    @Environment(ServerConfig.self) private var serverConfig
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var enteredPIN: String = ""
    @State private var isLoading: Bool = false
    @State private var shakeOffset: CGFloat = 0
    @State private var showError: Bool = false
    @State private var errorMessage: String = ""

    private enum NumberPadKey: Hashable {
        case digit(Int)
        case delete
        case blank
    }

    private var numberPadRows: [[NumberPadKey]] {
        [
            [.digit(1), .digit(2), .digit(3)],
            [.digit(4), .digit(5), .digit(6)],
            [.digit(7), .digit(8), .digit(9)],
            [.blank,    .digit(0), .delete]
        ]
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                Spacer()
                    .frame(height: 20)

                ProfileAvatarView(profile: profile, serverConfig: serverConfig, size: 64)
                    .padding(.bottom, 8)

                Text(profile.name)
                    .font(.headline)
                    .padding(.bottom, 24)

                pinDotsView
                    .offset(x: shakeOffset)
                    .padding(.bottom, showError ? 12 : 32)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("PIN entry, \(enteredPIN.count) of 4 digits entered")

                if showError {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .transition(.opacity)
                        .padding(.bottom, 16)
                }

                if isLoading {
                    ProgressView()
                        .padding(.bottom, 32)
                } else {
                    numberPadView
                }

                Spacer()
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
            }
        }
    }

    // MARK: - PIN Dots

    private var pinDotsView: some View {
        HStack(spacing: 16) {
            ForEach(0..<4, id: \.self) { index in
                Circle()
                    .fill(index < enteredPIN.count ? Color.primary : Color.clear)
                    .overlay(
                        Circle()
                            .strokeBorder(Color.primary.opacity(0.3), lineWidth: 1.5)
                    )
                    .frame(width: 14, height: 14)
            }
        }
        .animation(.easeInOut(duration: 0.1), value: enteredPIN.count)
    }

    // MARK: - Number Pad

    private var numberPadView: some View {
        VStack(spacing: 12) {
            ForEach(numberPadRows, id: \.self) { row in
                HStack(spacing: 24) {
                    ForEach(row, id: \.self) { key in
                        numberPadButton(key)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func numberPadButton(_ key: NumberPadKey) -> some View {
        switch key {
        case .digit(let n):
            Button {
                appendDigit(n)
            } label: {
                Text("\(n)")
                    .font(.system(size: 28, weight: .regular))
                    .frame(width: 72, height: 72)
                    .background(Color.secondary.opacity(0.2))
                    .clipShape(Circle())
                    .foregroundStyle(.primary)
            }
            .buttonStyle(.plain)

        case .delete:
            Button {
                deleteLastDigit()
            } label: {
                Image(systemName: "delete.backward")
                    .font(.system(size: 22))
                    .frame(width: 72, height: 72)
                    .foregroundStyle(.primary)
            }
            .buttonStyle(.plain)
            .disabled(enteredPIN.isEmpty)
            .opacity(enteredPIN.isEmpty ? 0.3 : 1.0)
            .accessibilityLabel("Delete")

        case .blank:
            Color.clear
                .frame(width: 72, height: 72)
        }
    }

    // MARK: - Input Logic

    private func appendDigit(_ digit: Int) {
        guard enteredPIN.count < 4, !isLoading else { return }

        if showError {
            withAnimation { showError = false }
        }

        enteredPIN.append(String(digit))
        HapticFeedback.lightImpact()

        if enteredPIN.count == 4 {
            verifyPIN()
        }
    }

    private func deleteLastDigit() {
        guard !enteredPIN.isEmpty, !isLoading else { return }
        enteredPIN.removeLast()
    }

    private func verifyPIN() {
        isLoading = true

        Task {
            let result = await onVerifyPin(enteredPIN)

            await MainActor.run {
                switch result {
                case .success:
                    HapticFeedback.success()
                case .failure(let message):
                    isLoading = false
                    errorMessage = message
                    triggerErrorShake()
                    HapticFeedback.error()
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showError = true
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                        enteredPIN = ""
                    }
                }
            }
        }
    }

    // MARK: - Shake Animation

    private func triggerErrorShake() {
        guard !reduceMotion else { return }
        shakeOffset = 10
        withAnimation(.spring(response: 0.2, dampingFraction: 0.15, blendDuration: 0)) {
            shakeOffset = 0
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

                    HStack {
                        Text("Or pick any emoji")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Spacer()
                        EmojiTextField(selectedEmoji: $avatar)
                            .frame(width: 60, height: 44)
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
