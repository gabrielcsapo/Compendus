//
//  AppNavigation.swift
//  Compendus
//
//  Shared navigation state for cross-tab navigation
//

import SwiftUI

@Observable
class AppNavigation {
    /// 0 = Today, 1 = Library, 2 = Wander, 3 = You
    var selectedTab: Int = 0 {
        didSet {
            if selectedTab == 2, oldValue != 2 {
                previousTabBeforeExplore = oldValue
            } else if selectedTab != 2 {
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

    init() {
        let environment = ProcessInfo.processInfo.environment
        if let tab = environment["COMPENDUS_SHOWCASE_TAB"].flatMap(Int.init) {
            selectedTab = tab
        }
        if let filter = environment["COMPENDUS_SHOWCASE_FILTER"],
           ["all", "ebooks", "audiobooks", "comics"].contains(filter) {
            libraryFilterChipId = filter
        }
    }

    /// Explore is intentionally immersive, but closing it should preserve the
    /// reader's place instead of always resetting navigation to Today.
    func exitExplore() {
        selectedTab = previousTabBeforeExplore
    }
}
