//
//  AppNavigation.swift
//  Compendus
//
//  Shared navigation state for cross-tab navigation
//

import SwiftUI

@Observable
class AppNavigation {
    var selectedTab: Int = 0 // 0 = Home, 1 = Library, 2 = Highlights, 3 = Settings
    var pendingSeriesFilter: String? = nil
}
