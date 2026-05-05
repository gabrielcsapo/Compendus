//
//  ShareSheet.swift
//  Compendus
//
//  Wraps UIActivityViewController so SwiftUI views can present the system
//  share sheet (used by selection toolbar Share, highlight Share, etc.).
//

import SwiftUI
import UIKit

struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]
    var applicationActivities: [UIActivity]? = nil

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: applicationActivities)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}
