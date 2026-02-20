//
//  HapticFeedback.swift
//  Compendus
//
//  Haptic feedback utilities for user interactions
//

import UIKit

/// Centralized haptic feedback utilities
/// On Mac Catalyst, all methods are no-ops since haptic hardware is unavailable.
enum HapticFeedback {
    /// Success haptic (download complete, action successful)
    static func success() {
        #if !targetEnvironment(macCatalyst)
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.success)
        #endif
    }

    /// Warning haptic (caution needed)
    static func warning() {
        #if !targetEnvironment(macCatalyst)
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.warning)
        #endif
    }

    /// Error haptic (action failed)
    static func error() {
        #if !targetEnvironment(macCatalyst)
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.error)
        #endif
    }

    /// Light impact haptic (subtle feedback)
    static func lightImpact() {
        #if !targetEnvironment(macCatalyst)
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.prepare()
        generator.impactOccurred()
        #endif
    }

    /// Medium impact haptic (standard feedback)
    static func mediumImpact() {
        #if !targetEnvironment(macCatalyst)
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.prepare()
        generator.impactOccurred()
        #endif
    }

    /// Heavy impact haptic (strong feedback)
    static func heavyImpact() {
        #if !targetEnvironment(macCatalyst)
        let generator = UIImpactFeedbackGenerator(style: .heavy)
        generator.prepare()
        generator.impactOccurred()
        #endif
    }

    /// Soft impact haptic (gentle feedback)
    static func softImpact() {
        #if !targetEnvironment(macCatalyst)
        let generator = UIImpactFeedbackGenerator(style: .soft)
        generator.prepare()
        generator.impactOccurred()
        #endif
    }

    /// Rigid impact haptic (firm feedback)
    static func rigidImpact() {
        #if !targetEnvironment(macCatalyst)
        let generator = UIImpactFeedbackGenerator(style: .rigid)
        generator.prepare()
        generator.impactOccurred()
        #endif
    }

    /// Selection changed haptic (picker changes, tab switches)
    static func selectionChanged() {
        #if !targetEnvironment(macCatalyst)
        let generator = UISelectionFeedbackGenerator()
        generator.prepare()
        generator.selectionChanged()
        #endif
    }
}
