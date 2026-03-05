//
//  EmojiTextField.swift
//  Compendus
//
//  A text field that forces the system emoji keyboard for full emoji selection.
//

import SwiftUI
import UIKit

struct EmojiTextField: UIViewRepresentable {
    @Binding var selectedEmoji: String
    var onEmojiSelected: ((String) -> Void)?

    func makeUIView(context: Context) -> EmojiInputTextField {
        let textField = EmojiInputTextField()
        textField.delegate = context.coordinator
        textField.textAlignment = .center
        textField.font = .systemFont(ofSize: 44)
        textField.tintColor = .clear
        textField.text = selectedEmoji.isEmpty ? nil : selectedEmoji
        textField.placeholder = "😀"
        return textField
    }

    func updateUIView(_ uiView: EmojiInputTextField, context: Context) {
        uiView.text = selectedEmoji.isEmpty ? nil : selectedEmoji
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(selectedEmoji: $selectedEmoji, onEmojiSelected: onEmojiSelected)
    }

    class Coordinator: NSObject, UITextFieldDelegate {
        @Binding var selectedEmoji: String
        var onEmojiSelected: ((String) -> Void)?

        init(selectedEmoji: Binding<String>, onEmojiSelected: ((String) -> Void)?) {
            _selectedEmoji = selectedEmoji
            self.onEmojiSelected = onEmojiSelected
        }

        func textField(
            _ textField: UITextField,
            shouldChangeCharactersIn range: NSRange,
            replacementString string: String
        ) -> Bool {
            guard !string.isEmpty else {
                selectedEmoji = ""
                return true
            }
            if let firstChar = string.first, firstChar.isEmoji {
                selectedEmoji = String(firstChar)
                onEmojiSelected?(selectedEmoji)
                return false
            }
            return false
        }
    }
}

/// A UITextField subclass that forces the emoji keyboard.
class EmojiInputTextField: UITextField {
    override var textInputMode: UITextInputMode? {
        for mode in UITextInputMode.activeInputModes {
            if mode.primaryLanguage == "emoji" {
                return mode
            }
        }
        return super.textInputMode
    }

    override var textInputContextIdentifier: String? { "" }
}

extension Character {
    var isEmoji: Bool {
        guard let scalar = unicodeScalars.first else { return false }
        return scalar.properties.isEmoji
            && (scalar.properties.isEmojiPresentation || unicodeScalars.count > 1)
    }
}
