//
//  CarPlaySceneDelegate.swift
//  Compendus
//
//  CarPlay audio interface. Surfaces downloaded audiobooks as a two-tab
//  template: Continue (in-progress) and Library (all + series drill-down).
//  Playback is delegated to the shared AudiobookPlayer, so AirPlay, lock
//  screen controls, and CarPlay all share one engine.
//

import CarPlay
import Observation
import SwiftData
import UIKit

final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {

    private var interfaceController: CPInterfaceController?
    private var tabBarTemplate: CPTabBarTemplate?
    private var continueTemplate: CPListTemplate?
    private var libraryTemplate: CPListTemplate?
    private var saveObserver: NSObjectProtocol?
    private var activateObserver: NSObjectProtocol?
    private var refreshWorkItem: DispatchWorkItem?

    // MARK: - Scene lifecycle

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        let tabBar = makeTabBar()
        self.tabBarTemplate = tabBar
        interfaceController.setRootTemplate(tabBar, animated: false, completion: nil)
        startObserving()
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnectInterfaceController interfaceController: CPInterfaceController
    ) {
        stopObserving()
        self.interfaceController = nil
        self.tabBarTemplate = nil
        self.continueTemplate = nil
        self.libraryTemplate = nil
    }

    // MARK: - Tab bar

    private func makeTabBar() -> CPTabBarTemplate {
        let books = fetchAudiobooks()
        let continueTab = makeContinueTemplate(books: books)
        let libraryTab = makeLibraryTemplate(books: books)
        self.continueTemplate = continueTab
        self.libraryTemplate = libraryTab
        return CPTabBarTemplate(templates: [continueTab, libraryTab])
    }

    // MARK: - Live updates

    /// Rebuild the Continue and Library sections whenever the library changes
    /// (new download, finished book, progress saved) or playback flips, so
    /// CarPlay reflects current state without a disconnect/reconnect.
    private func startObserving() {
        saveObserver = NotificationCenter.default.addObserver(
            forName: ModelContext.didSave, object: nil, queue: .main
        ) { [weak self] _ in
            self?.scheduleRefresh()
        }
        activateObserver = NotificationCenter.default.addObserver(
            forName: UIScene.didActivateNotification, object: nil, queue: .main
        ) { [weak self] _ in
            self?.scheduleRefresh()
        }
        observePlayer()
    }

    private func stopObserving() {
        if let saveObserver { NotificationCenter.default.removeObserver(saveObserver) }
        if let activateObserver { NotificationCenter.default.removeObserver(activateObserver) }
        saveObserver = nil
        activateObserver = nil
        refreshWorkItem?.cancel()
        refreshWorkItem = nil
    }

    /// `@Observable` AudiobookPlayer isn't observed by CarPlay templates, so
    /// track play/pause + current book manually and re-arm after each change.
    private func observePlayer() {
        guard let player = AppDelegate.shared?.audiobookPlayer else { return }
        withObservationTracking {
            _ = player.isPlaying
            _ = player.currentBook?.id
        } onChange: { [weak self] in
            DispatchQueue.main.async {
                self?.scheduleRefresh()
                self?.observePlayer()
            }
        }
    }

    /// Coalesce bursts (a completing download can emit several saves) into a
    /// single rebuild.
    private func scheduleRefresh() {
        refreshWorkItem?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.refresh() }
        refreshWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4, execute: work)
    }

    private func refresh() {
        let books = fetchAudiobooks()
        continueTemplate?.updateSections(continueSections(books: books))
        libraryTemplate?.updateSections(librarySections(books: books))
    }

    // MARK: - Continue tab

    private func makeContinueTemplate(books: [DownloadedBook]) -> CPListTemplate {
        let template = CPListTemplate(title: "Continue", sections: continueSections(books: books))
        template.tabTitle = "Continue"
        template.tabImage = UIImage(systemName: "play.fill")
        return template
    }

    private func continueSections(books: [DownloadedBook]) -> [CPListSection] {
        let inProgress = books
            .filter { $0.lastReadAt != nil && $0.readingProgress > 0 && !$0.isRead }
            .sorted { ($0.lastReadAt ?? .distantPast) > ($1.lastReadAt ?? .distantPast) }
            .prefix(20)

        if inProgress.isEmpty {
            let empty = CPListItem(
                text: "No books in progress",
                detailText: "Pick one from Library to get started"
            )
            return [CPListSection(items: [empty])]
        }
        return [CPListSection(items: inProgress.map { bookItem(for: $0, showProgress: true) })]
    }

    // MARK: - Library tab

    private func makeLibraryTemplate(books: [DownloadedBook]) -> CPListTemplate {
        let template = CPListTemplate(title: "Library", sections: librarySections(books: books))
        template.tabTitle = "Library"
        template.tabImage = UIImage(systemName: "books.vertical.fill")
        return template
    }

    private func librarySections(books: [DownloadedBook]) -> [CPListSection] {
        var sections: [CPListSection] = []

        let seriesGroups = Dictionary(
            grouping: books.filter { ($0.series?.isEmpty == false) }
        ) { $0.series ?? "" }

        if !seriesGroups.isEmpty {
            let seriesItem = CPListItem(
                text: "Browse by Series",
                detailText: "\(seriesGroups.count) series"
            )
            seriesItem.accessoryType = .disclosureIndicator
            seriesItem.handler = { [weak self] _, completion in
                self?.pushSeriesList(groups: seriesGroups)
                completion()
            }
            sections.append(CPListSection(items: [seriesItem]))
        }

        let allItems = books
            .sorted { $0.title.localizedCaseInsensitiveCompare($1.title) == .orderedAscending }
            .map { bookItem(for: $0, showProgress: false) }

        if allItems.isEmpty {
            let empty = CPListItem(
                text: "No audiobooks downloaded",
                detailText: "Download from the Compendus app on your phone"
            )
            sections.append(CPListSection(items: [empty]))
        } else {
            sections.append(CPListSection(
                items: allItems,
                header: "All Audiobooks",
                sectionIndexTitle: nil
            ))
        }

        return sections
    }

    private func pushSeriesList(groups: [String: [DownloadedBook]]) {
        let names = groups.keys.sorted()
        let items = names.map { name -> CPListItem in
            let count = groups[name]?.count ?? 0
            let item = CPListItem(
                text: name,
                detailText: "\(count) book\(count == 1 ? "" : "s")"
            )
            item.accessoryType = .disclosureIndicator
            item.handler = { [weak self] _, completion in
                let series = groups[name] ?? []
                let sorted = series.sorted {
                    ($0.seriesNumber ?? .infinity) < ($1.seriesNumber ?? .infinity)
                }
                self?.pushBookList(title: name, books: sorted)
                completion()
            }
            return item
        }
        let template = CPListTemplate(title: "Series", sections: [CPListSection(items: items)])
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }

    private func pushBookList(title: String, books: [DownloadedBook]) {
        let items = books.map { bookItem(for: $0, showProgress: true) }
        let template = CPListTemplate(title: title, sections: [CPListSection(items: items)])
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }

    // MARK: - Shared row builder

    private func bookItem(for book: DownloadedBook, showProgress: Bool) -> CPListItem {
        var detail = book.authorsDisplay
        if showProgress, book.readingProgress > 0 {
            let pct = Int(book.readingProgress * 100)
            detail = detail.isEmpty ? "\(pct)%" : "\(detail) · \(pct)%"
        }

        let image = book.coverData.flatMap { UIImage(data: $0) }
        let item = CPListItem(text: book.title, detailText: detail, image: image)
        item.playbackProgress = CGFloat(book.readingProgress)

        let player = AppDelegate.shared?.audiobookPlayer
        if player?.currentBook?.id == book.id {
            item.isPlaying = player?.isPlaying == true
        }

        item.handler = { [weak self] _, completion in
            self?.play(book: book)
            completion()
        }
        return item
    }

    // MARK: - Playback handoff

    private func play(book: DownloadedBook) {
        guard let player = AppDelegate.shared?.audiobookPlayer else { return }
        Task { @MainActor in
            await player.loadBook(book)
            player.play()
            self.presentNowPlayingIfNeeded()
        }
    }

    private func presentNowPlayingIfNeeded() {
        guard let controller = interfaceController else { return }
        let nowPlaying = CPNowPlayingTemplate.shared

        if let chapters = AppDelegate.shared?.audiobookPlayer?.currentBook?.chapters,
           !chapters.isEmpty,
           let chapterIcon = UIImage(systemName: "list.bullet") {
            let chapterButton = CPNowPlayingImageButton(image: chapterIcon) { [weak self] _ in
                self?.pushChapterList(chapters: chapters)
            }
            nowPlaying.updateNowPlayingButtons([chapterButton])
        } else {
            nowPlaying.updateNowPlayingButtons([])
        }

        if controller.topTemplate !== nowPlaying {
            controller.pushTemplate(nowPlaying, animated: true, completion: nil)
        }
    }

    private func pushChapterList(chapters: [Chapter]) {
        guard let player = AppDelegate.shared?.audiobookPlayer else { return }
        let items = chapters.map { chapter -> CPListItem in
            let item = CPListItem(text: chapter.title, detailText: chapter.startTimeDisplay)
            item.handler = { _, completion in
                Task { @MainActor in
                    player.seek(to: chapter.startTime)
                    completion()
                }
            }
            return item
        }
        let template = CPListTemplate(title: "Chapters", sections: [CPListSection(items: items)])
        interfaceController?.pushTemplate(template, animated: true, completion: nil)
    }

    // MARK: - Data

    private func fetchAudiobooks() -> [DownloadedBook] {
        guard let container = AppDelegate.shared?.modelContainer else { return [] }
        let context = ModelContext(container)
        let descriptor = FetchDescriptor<DownloadedBook>()
        guard let books = try? context.fetch(descriptor) else { return [] }
        return books.filter { $0.isAudiobook }
    }
}
