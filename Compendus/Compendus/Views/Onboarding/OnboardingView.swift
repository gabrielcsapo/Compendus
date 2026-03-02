//
//  OnboardingView.swift
//  Compendus
//
//  Welcome onboarding flow shown on first launch before server setup.
//

import SwiftUI

struct OnboardingView: View {
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false
    @State private var currentPage = 0

    private let pages: [OnboardingPage] = [
        OnboardingPage(
            icon: "books.vertical.fill",
            title: "Your Library, Everywhere",
            description: "Connect to your personal book server and access your entire collection of ebooks, audiobooks, and comics."
        ),
        OnboardingPage(
            icon: "book.fill",
            title: "Read Your Way",
            description: "Customize fonts, themes, and layouts. Highlight passages, take notes, and pick up right where you left off."
        ),
        OnboardingPage(
            icon: "chart.bar.fill",
            title: "Track Your Progress",
            description: "See your reading streaks, time spent reading, and build a consistent reading habit."
        ),
    ]

    var body: some View {
        VStack(spacing: 0) {
            TabView(selection: $currentPage) {
                ForEach(Array(pages.enumerated()), id: \.offset) { index, page in
                    VStack(spacing: Spacing.xxl) {
                        Spacer()

                        ZStack {
                            Circle()
                                .fill(Color.accentColor.opacity(Opacity.light))
                                .frame(width: 140, height: 140)

                            Image(systemName: page.icon)
                                .font(.system(size: 60))
                                .foregroundStyle(.accent)
                                .symbolRenderingMode(.hierarchical)
                        }

                        VStack(spacing: Spacing.sm) {
                            Text(page.title)
                                .font(.title)
                                .fontWeight(.bold)
                                .multilineTextAlignment(.center)

                            Text(page.description)
                                .font(.body)
                                .foregroundStyle(.secondary)
                                .multilineTextAlignment(.center)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.horizontal, Spacing.xxxl)

                        Spacer()
                        Spacer()
                    }
                    .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .animation(.easeInOut, value: currentPage)

            // Bottom action area
            VStack(spacing: Spacing.lg) {
                Button {
                    if currentPage < pages.count - 1 {
                        withAnimation { currentPage += 1 }
                    } else {
                        hasCompletedOnboarding = true
                    }
                } label: {
                    Text(currentPage < pages.count - 1 ? "Continue" : "Get Started")
                        .fontWeight(.semibold)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, Spacing.md)
                }
                .buttonStyle(.borderedProminent)

                if currentPage < pages.count - 1 {
                    Button("Skip") {
                        hasCompletedOnboarding = true
                    }
                    .foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, Spacing.xl)
            .padding(.bottom, Spacing.xxxl)
        }
    }
}

private struct OnboardingPage {
    let icon: String
    let title: String
    let description: String
}

#Preview {
    OnboardingView()
}
