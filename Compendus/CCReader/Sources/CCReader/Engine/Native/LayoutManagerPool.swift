//
//  LayoutManagerPool.swift
//  Compendus
//
//  Actor-based pool of NSLayoutManager instances for background chapter pagination.
//  Reusing layout managers avoids repeated alloc/dealloc overhead when paginating
//  many chapters in parallel during initial EPUB load.
//

import UIKit

/// Pool of reusable `NSLayoutManager` instances.
/// Maximum pool size is capped at `maxSize`; requests beyond that create a temporary instance.
/// All NSLayoutManager interactions are serialised through this actor to satisfy TextKit's
/// single-thread requirement on the object graph setup phase.
public actor LayoutManagerPool {

    // MARK: - Configuration

    public let maxSize: Int

    // MARK: - State

    private var available: [NSLayoutManager] = []

    // MARK: - Init

    public init(maxSize: Int = 4) {
        self.maxSize = maxSize
        // Pre-warm the pool
        for _ in 0..<maxSize {
            available.append(NSLayoutManager())
        }
    }

    // MARK: - Acquire / Release

    /// Borrow a layout manager from the pool.
    /// If the pool is empty a fresh instance is returned (and will be discarded on release
    /// if the pool is already at `maxSize`).
    public func acquire() -> NSLayoutManager {
        if !available.isEmpty {
            return available.removeLast()
        }
        return NSLayoutManager()
    }

    /// Return a layout manager to the pool.
    /// The caller must not use the instance after releasing it.
    public func release(_ lm: NSLayoutManager) {
        guard available.count < maxSize else { return }
        // Detach all text containers and text storage so the LM is clean for reuse
        for container in lm.textContainers {
            lm.removeTextContainer(at: 0)
            _ = container // silence unused warning
        }
        if let storage = lm.textStorage {
            storage.removeLayoutManager(lm)
        }
        available.append(lm)
    }
}
