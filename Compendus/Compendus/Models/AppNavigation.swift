//
//  AppNavigation.swift
//  Compendus
//
//  Shared navigation state for cross-tab navigation
//

import SwiftUI

@Observable
class AppNavigation {
    /// 0 = Today, 1 = Library, 2 = Highlights, 3 = Me, 4 = Explore
    var selectedTab: Int = 0 {
        didSet {
            if selectedTab == 4, oldValue != 4 {
                previousTabBeforeExplore = oldValue
            } else if selectedTab != 4 {
                previousTabBeforeExplore = selectedTab
            }
        }
    }
    private(set) var previousTabBeforeExplore: Int = 0
    var pendingSeriesFilter: String? = nil
    /// Drives the active filter chip in DownloadsView (shared between Mac sidebar and iOS chip bar)
    var homeFilterChipId: String = "all"
    /// Drives the active filter chip in LibraryView (shared between Mac sidebar and iOS chip bar)
    var libraryFilterChipId: String = "all"

    /// Explore is intentionally immersive, but closing it should preserve the
    /// reader's place instead of always resetting navigation to Today.
    func exitExplore() {
        selectedTab = previousTabBeforeExplore
    }
}
