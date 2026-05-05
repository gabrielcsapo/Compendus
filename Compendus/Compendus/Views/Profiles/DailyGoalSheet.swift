//
//  DailyGoalSheet.swift
//  Compendus
//
//  Lets the user pick their daily reading goal. Mirrors the web preset chips
//  on the Profile page so the UX feels the same on both platforms.
//

import SwiftUI

private let goalPresets = [5, 10, 15, 20, 30, 45, 60, 90]

struct DailyGoalSheet: View {
    let currentGoal: Int
    let profileId: String

    @Environment(\.dismiss) private var dismiss
    @Environment(APIService.self) private var apiService
    @AppStorage("compendus.dailyGoalMinutes") private var storedGoal: Int = 15

    @State private var selected: Int
    @State private var saving = false
    @State private var errorMessage: String?

    init(currentGoal: Int, profileId: String) {
        self.currentGoal = currentGoal
        self.profileId = profileId
        _selected = State(initialValue: currentGoal)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                VStack(spacing: 6) {
                    Text("\(selected)")
                        .font(.system(size: 64, weight: .bold, design: .rounded))
                        .contentTransition(.numericText())
                        .animation(.snappy, value: selected)
                    Text(selected == 1 ? "minute per day" : "minutes per day")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .padding(.top, 16)

                LazyVGrid(
                    columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: 4),
                    spacing: 10
                ) {
                    ForEach(goalPresets, id: \.self) { minutes in
                        Button {
                            selected = minutes
                        } label: {
                            Text("\(minutes)m")
                                .font(.subheadline.weight(.medium))
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 10)
                                .background(
                                    Capsule().fill(
                                        selected == minutes
                                            ? Color.accentColor.opacity(0.18)
                                            : Color(.tertiarySystemFill)
                                    )
                                )
                                .overlay(
                                    Capsule().strokeBorder(
                                        selected == minutes ? Color.accentColor : .clear,
                                        lineWidth: 1.5
                                    )
                                )
                                .foregroundStyle(selected == minutes ? .primary : .secondary)
                        }
                    }
                }

                Stepper("Custom (\(selected) min)", value: $selected, in: 1...240)
                    .labelsHidden()
                    .padding(.horizontal)

                if let errorMessage {
                    Text(errorMessage)
                        .font(.caption)
                        .foregroundStyle(.red)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Daily reading goal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task { await save() }
                    }
                    .disabled(saving || selected == currentGoal || profileId.isEmpty)
                }
            }
        }
    }

    private func save() async {
        guard !profileId.isEmpty else {
            errorMessage = "No profile selected"
            return
        }
        saving = true
        errorMessage = nil
        do {
            _ = try await apiService.updateDailyGoal(profileId: profileId, minutes: selected)
            // updateDailyGoal already mirrors into UserDefaults; @AppStorage views update.
            HapticFeedback.success()
            dismiss()
        } catch {
            errorMessage = "Couldn't save goal. Please try again."
        }
        saving = false
    }
}
