//
//  ProfileInvalidatedView.swift
//  Compendus
//
//  Shown when the server rejects the current profile (deleted server-side).
//  Lets the user pick or create a new profile and migrates all local SwiftData
//  records from the old profileId to the new one.
//

import SwiftUI
import SwiftData

struct ProfileInvalidatedView: View {
    @Environment(ServerConfig.self) private var serverConfig
    @Environment(APIService.self) private var apiService
    @Environment(\.modelContext) private var modelContext

    @State private var profiles: [Profile] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var isMigrating = false

    @State private var selectedLockedProfile: Profile?

    @State private var showingCreateSheet = false

    private let columns = [
        GridItem(.adaptive(minimum: 120, maximum: 160), spacing: 24)
    ]

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            // Warning header
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(.orange)

                Text("Profile Removed")
                    .font(.largeTitle)
                    .fontWeight(.bold)

                Text("Your profile was deleted from the server. Select or create a new profile to keep your reading data.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }
            .padding(.bottom, 32)

            if isMigrating {
                VStack(spacing: 12) {
                    ProgressView()
                    Text("Migrating your data...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding()
            } else if isLoading {
                ProgressView("Loading profiles...")
                    .padding()
            } else if let error = errorMessage {
                VStack(spacing: 12) {
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
                        profileCard(profile)
                    }

                    // Add Profile card
                    addProfileCard
                }
                .padding(.horizontal, 32)
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
                    await verifyPinAndMigrate(for: profile, pin: pin)
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
                    selectAndMigrate(profile)
                },
                onCancel: {
                    showingCreateSheet = false
                }
            )
            .presentationDetents([.medium])
        }
    }

    // MARK: - Profile Card

    private func profileCard(_ profile: Profile) -> some View {
        Button {
            handleProfileTap(profile)
        } label: {
            VStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(Color.accentColor.opacity(0.15))
                        .frame(width: 80, height: 80)

                    if let avatar = profile.avatar, !avatar.isEmpty {
                        Text(avatar)
                            .font(.system(size: 36))
                    } else {
                        Text(profile.name.prefix(1).uppercased())
                            .font(.system(size: 32, weight: .semibold))
                            .foregroundStyle(.accent)
                    }

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
        .disabled(isMigrating)
    }

    private var addProfileCard: some View {
        Button {
            showingCreateSheet = true
        } label: {
            VStack(spacing: 10) {
                Circle()
                    .fill(Color(.systemGray5))
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
        .disabled(isMigrating)
    }

    // MARK: - Actions

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
            selectAndMigrate(profile)
        }
    }

    private func selectAndMigrate(_ profile: Profile) {
        Task {
            do {
                let pin: String? = nil
                let selectedProfile = try await apiService.selectProfile(id: profile.id, pin: pin)
                await MainActor.run {
                    serverConfig.selectProfile(selectedProfile)
                }
                await migrateData(to: selectedProfile.id)
            } catch {
                // Non-PIN profiles shouldn't fail auth
            }
        }
    }

    private func verifyPinAndMigrate(for profile: Profile, pin: String) async -> PinEntrySheet.PinVerificationResult {
        do {
            let selectedProfile = try await apiService.selectProfile(id: profile.id, pin: pin)
            await MainActor.run {
                serverConfig.selectProfile(selectedProfile)
                selectedLockedProfile = nil
            }
            await migrateData(to: selectedProfile.id)
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

    // MARK: - Data Migration

    @MainActor
    private func migrateData(to newProfileId: String) async {
        guard let oldProfileId = serverConfig.invalidatedProfileId else {
            serverConfig.clearInvalidatedProfile()
            return
        }

        isMigrating = true

        // Migrate DownloadedBook records
        let bookDescriptor = FetchDescriptor<DownloadedBook>(predicate: #Predicate { $0.profileId == oldProfileId })
        if let books = try? modelContext.fetch(bookDescriptor) {
            for book in books { book.profileId = newProfileId }
        }

        // Migrate BookHighlight records
        let highlightDescriptor = FetchDescriptor<BookHighlight>(predicate: #Predicate { $0.profileId == oldProfileId })
        if let highlights = try? modelContext.fetch(highlightDescriptor) {
            for highlight in highlights { highlight.profileId = newProfileId }
        }

        // Migrate BookBookmark records
        let bookmarkDescriptor = FetchDescriptor<BookBookmark>(predicate: #Predicate { $0.profileId == oldProfileId })
        if let bookmarks = try? modelContext.fetch(bookmarkDescriptor) {
            for bookmark in bookmarks { bookmark.profileId = newProfileId }
        }

        // Migrate ReadingSession records
        let sessionDescriptor = FetchDescriptor<ReadingSession>(predicate: #Predicate { $0.profileId == oldProfileId })
        if let sessions = try? modelContext.fetch(sessionDescriptor) {
            for session in sessions { session.profileId = newProfileId }
        }

        // Migrate PendingDownload records
        let pendingDownloadDescriptor = FetchDescriptor<PendingDownload>(predicate: #Predicate { $0.profileId == oldProfileId })
        if let pendingDownloads = try? modelContext.fetch(pendingDownloadDescriptor) {
            for pending in pendingDownloads { pending.profileId = newProfileId }
        }

        // Migrate PendingBookEdit records
        let pendingEditDescriptor = FetchDescriptor<PendingBookEdit>(predicate: #Predicate { $0.profileId == oldProfileId })
        if let pendingEdits = try? modelContext.fetch(pendingEditDescriptor) {
            for edit in pendingEdits { edit.profileId = newProfileId }
        }

        try? modelContext.save()

        serverConfig.clearInvalidatedProfile()
        isMigrating = false
    }
}
