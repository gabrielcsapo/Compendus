//
//  DeviceIdentity.swift
//  Compendus
//
//  Stable identity for THIS device/install, used to attribute reading progress
//  to a specific device when syncing so each device's position is preserved
//  independently (one device on page 50, another on page 80 of the same book).
//

import Foundation
import UIKit

enum DeviceIdentity {
    private static let idKey = "compendus.deviceId"
    private static let nameOverrideKey = "compendus.deviceNameOverride"

    /// Stable per-install identifier. Persisted in UserDefaults (more stable for
    /// our needs than identifierForVendor, which can change across reinstalls).
    static var deviceId: String {
        if let existing = UserDefaults.standard.string(forKey: idKey) {
            return existing
        }
        let new = UUID().uuidString
        UserDefaults.standard.set(new, forKey: idKey)
        return new
    }

    /// User-friendly name shown in cross-device UI. Uses the user's override if
    /// set, otherwise the system device name (which on modern iOS may be a generic
    /// model name unless the app is entitled — hence the override option).
    static var deviceName: String {
        if let override = UserDefaults.standard.string(forKey: nameOverrideKey),
           !override.trimmingCharacters(in: .whitespaces).isEmpty {
            return override
        }
        let systemName = UIDevice.current.name.trimmingCharacters(in: .whitespaces)
        return systemName.isEmpty ? defaultDeviceName : systemName
    }

    /// Set or clear the user's device-name override.
    static func setDeviceNameOverride(_ name: String?) {
        let trimmed = name?.trimmingCharacters(in: .whitespaces)
        if let trimmed, !trimmed.isEmpty {
            UserDefaults.standard.set(trimmed, forKey: nameOverrideKey)
        } else {
            UserDefaults.standard.removeObject(forKey: nameOverrideKey)
        }
    }

    static var nameOverride: String? {
        UserDefaults.standard.string(forKey: nameOverrideKey)
    }

    /// "iPhone" | "iPad" | "Mac" | "Vision" | "other"
    static var deviceType: String {
        switch UIDevice.current.userInterfaceIdiom {
        case .phone: return "iPhone"
        case .pad: return "iPad"
        case .mac: return "Mac"
        case .vision: return "Vision"
        default: return "other"
        }
    }

    private static var defaultDeviceName: String {
        switch deviceType {
        case "iPhone": return "iPhone"
        case "iPad": return "iPad"
        case "Mac": return "Mac"
        case "Vision": return "Apple Vision Pro"
        default: return "This device"
        }
    }

    /// SF Symbol name for a device type, for use in cross-device UI.
    static func icon(for type: String) -> String {
        switch type {
        case "iPhone": return "iphone"
        case "iPad": return "ipad"
        case "Mac": return "laptopcomputer"
        case "Vision": return "visionpro"
        default: return "rectangle.on.rectangle"
        }
    }
}
