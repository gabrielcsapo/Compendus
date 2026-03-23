//
//  BannerToast.swift
//  Compendus
//
//  Lightweight overlay banner for brief feedback (save success, save failure).
//  Usage: add @State var toastMessage: String? and @State var toastIsError = false
//  to your view, then attach .bannerToast($toastMessage, isError: toastIsError).
//

import SwiftUI

enum BannerToastType {
    case success
    case error
}

struct BannerToastModifier: ViewModifier {
    @Binding var message: String?
    let type: BannerToastType
    let duration: TimeInterval

    func body(content: Content) -> some View {
        content.overlay(alignment: .top) {
            if let message {
                BannerToastView(message: message, type: type) {
                    self.message = nil
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .animation(.spring(response: 0.4, dampingFraction: 0.75), value: message)
                .onAppear {
                    DispatchQueue.main.asyncAfter(deadline: .now() + duration) {
                        self.message = nil
                    }
                }
                .padding(.top, 8)
                .zIndex(999)
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.75), value: message)
    }
}

struct BannerToastView: View {
    let message: String
    let type: BannerToastType
    let onDismiss: () -> Void

    private var backgroundColor: Color {
        switch type {
        case .success: return Color(.systemGreen).opacity(0.15)
        case .error: return Color(.systemRed).opacity(0.15)
        }
    }

    private var borderColor: Color {
        switch type {
        case .success: return Color(.systemGreen).opacity(0.4)
        case .error: return Color(.systemRed).opacity(0.4)
        }
    }

    private var iconName: String {
        switch type {
        case .success: return "checkmark.circle.fill"
        case .error: return "exclamationmark.circle.fill"
        }
    }

    private var iconColor: Color {
        switch type {
        case .success: return Color(.systemGreen)
        case .error: return Color(.systemRed)
        }
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: iconName)
                .foregroundStyle(iconColor)
                .font(.system(size: 16, weight: .semibold))

            Text(message)
                .font(.subheadline)
                .foregroundStyle(.primary)
                .multilineTextAlignment(.leading)

            Spacer(minLength: 0)

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(backgroundColor)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(borderColor, lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.08), radius: 8, x: 0, y: 2)
        )
        .padding(.horizontal, 16)
    }
}

extension View {
    /// Attach a banner toast that auto-dismisses after `duration` seconds.
    func bannerToast(_ message: Binding<String?>, type: BannerToastType = .success, duration: TimeInterval = 2.5) -> some View {
        modifier(BannerToastModifier(message: message, type: type, duration: duration))
    }
}
