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
    /// Drives the active filter chip in DownloadsView (shared between Mac sidebar and iOS chip bar)
    var homeFilterChipId: String = "all"
    /// Drives the active filter chip in LibraryView (shared between Mac sidebar and iOS chip bar)
    var libraryFilterChipId: String = "explore"
}
