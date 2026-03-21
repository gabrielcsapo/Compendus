//
//  SortBottomSheet.swift
//  Compendus
//
//  Bottom sheet for selecting sort order in the library
//

import SwiftUI

struct SortBottomSheet: View {
    @Binding var selectedSort: BookSort
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(BookSort.allCases, id: \.self) { sort in
                    Button {
                        selectedSort = sort
                        dismiss()
                    } label: {
                        HStack {
                            Label(sort.rawValue, systemImage: sort.icon)
                                .foregroundStyle(Color.primary)
                            Spacer()
                            if selectedSort == sort {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(Color.accentColor)
                                    .fontWeight(.semibold)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Sort By")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
        .presentationDragIndicator(.visible)
    }
}
