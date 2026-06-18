//
//  FleetWorkerService.swift
//  Compendus
//
//  The Idle Fleet worker built into the app (proposal §12, F2/F3): this device
//  leases batch jobs from the server while it charges and posts validated
//  results back. One service serves both platforms —
//
//   • Mac Catalyst: a foreground polling loop, gated on AC power via IOKit
//     power sources. Docked Macs are the fleet's workhorse.
//   • iOS/iPadOS: a BGProcessingTask with requiresExternalPower, so iOS runs
//     the same loop during overnight charging windows (the F3 path).
//
//  Backpressure is physical: one lease at a time, and we only lease while
//  eligible (charging/AC). The server validates every result structurally, so
//  a bad result is just a failed attempt that re-queues elsewhere.
//

import Foundation
import BackgroundTasks
import UIKit
#if targetEnvironment(macCatalyst)
import IOKit.ps
#endif
#if canImport(FoundationModels)
import FoundationModels
#endif

@Observable
@MainActor
class FleetWorkerService {
    static let backgroundTaskIdentifier = "com.compendus.fleet-worker"

    private let serverConfig: ServerConfig
    private let session: URLSession

    /// Kinds this device can run. Grows as handlers land (kokoro render, OCR…).
    /// foundation-models is advertised only when the on-device model is
    /// actually available (Apple Intelligence enabled, OS support) — the
    /// opportunistic tier of the model strategy.
    private var runtimes: [String] {
        var list = ["echo"]
        if foundationModelAvailable {
            list.append("foundation-models")
            // Generic local-LLM runtime: lets this device take LLM jobs (e.g.
            // classify-book) that the Mac runs via Ollama, since both advertise "llm".
            list.append("llm")
        }
        if KokoroModelManager.findModelDirectory() != nil { list.append("kokoro") }
        return list
    }

    /// kind → contract version this build implements — sent with every lease,
    /// so an out-of-date app never leases jobs it can't run, and a server-side
    /// contract bump cleanly stops stale builds from matching.
    private var handledKinds: [String: Int] {
        var kinds: [String: Int] = ["echo": 1]
        if foundationModelAvailable {
            kinds["curriculum-scaffold"] = 1
            kinds["realm-label"] = 2
            kinds["topic-label"] = 2
            kinds["classify-book"] = 1
            kinds["name-topic"] = 1
            kinds["judge-tension"] = 1
        }
        if KokoroModelManager.findModelDirectory() != nil { kinds["tts-render-trail"] = 1 }
        return kinds
    }

    /// Lazily-loaded Kokoro engine for tts-render-trail jobs (CoreML load is
    /// expensive; one context serves the whole worker session).
    private var kokoroContext: KokoroTTSContext?

    private var foundationModelAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, macCatalyst 26.0, *) {
            return SystemLanguageModel.default.availability == .available
        }
        #endif
        return false
    }

    // Persisted enrollment (household trust model; token identifies the device).
    private let defaults = UserDefaults.standard
    private let deviceIdKey = "fleetDeviceId"
    private let tokenKey = "fleetDeviceToken"
    private let enabledKey = "fleetWorkerEnabled"

    private(set) var deviceId: String?
    var isEnabled: Bool {
        didSet {
            defaults.set(isEnabled, forKey: enabledKey)
            if isEnabled { startForegroundLoopIfEligible() } else { stopForegroundLoop() }
        }
    }

    // Status surfaced in Settings.
    private(set) var isRunning = false
    private(set) var jobsCompleted = 0
    /// Smoothed wall-time per job (seconds) — drives the throughput/ETA readout.
    private(set) var avgJobSeconds: Double?
    /// Pending jobs in the shared queue this device is capable of (from /status).
    private(set) var queueRemaining: Int?
    private(set) var lastActivity: String?
    private(set) var lastError: String?

    private var loopTask: Task<Void, Never>?

    init(serverConfig: ServerConfig) {
        self.serverConfig = serverConfig
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 600
        self.session = URLSession(
            configuration: configuration,
            delegate: LocalNetworkSessionDelegate.shared,
            delegateQueue: nil
        )
        self.deviceId = defaults.string(forKey: deviceIdKey)
        self.isEnabled = defaults.bool(forKey: enabledKey)
        #if !targetEnvironment(macCatalyst)
        UIDevice.current.isBatteryMonitoringEnabled = true
        #endif
    }

    var isEnrolled: Bool { deviceId != nil && defaults.string(forKey: tokenKey) != nil }

    /// Catalyst's UIDevice.name reports "iPad"; the hostname is the Mac's real name.
    var defaultDeviceName: String {
        #if targetEnvironment(macCatalyst)
        ProcessInfo.processInfo.hostName.replacingOccurrences(of: ".local", with: "")
        #else
        UIDevice.current.name
        #endif
    }

    // MARK: - Eligibility (the plug is the throttle)

    var isOnExternalPower: Bool {
        #if targetEnvironment(macCatalyst)
        // IOKit power sources: desktops report no battery → treat as plugged in.
        guard let snapshot = IOPSCopyPowerSourcesInfo()?.takeRetainedValue(),
              let sources = IOPSCopyPowerSourcesList(snapshot)?.takeRetainedValue() as? [CFTypeRef],
              !sources.isEmpty
        else { return true }
        for source in sources {
            if let info = IOPSGetPowerSourceDescription(snapshot, source)?
                .takeUnretainedValue() as? [String: Any],
                let state = info[kIOPSPowerSourceStateKey] as? String
            {
                return state == kIOPSACPowerValue
            }
        }
        return true
        #else
        switch UIDevice.current.batteryState {
        case .charging, .full: return true
        case .unplugged: return false
        case .unknown: return false
        @unknown default: return false
        }
        #endif
    }

    private var isEligible: Bool {
        isEnabled && isEnrolled && serverConfig.isConfigured && isOnExternalPower
    }

    // MARK: - Enrollment (admin profile enrolls this device once)

    func enroll(deviceName: String) async {
        lastError = nil
        guard let url = serverConfig.apiURL("/api/fabric/devices"),
              let profileId = serverConfig.selectedProfileId
        else {
            lastError = "Server or profile not configured"
            return
        }
        #if targetEnvironment(macCatalyst)
        let platform = "macos"
        #else
        let platform = UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios"
        #endif
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(profileId, forHTTPHeaderField: "X-Profile-Id")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "name": deviceName,
            "platform": platform,
            "capabilities": ["runtimes": runtimes, "kinds": handledKinds, "ramClass": ramClass],
        ])
        do {
            let (data, _) = try await session.data(for: request)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  json["success"] as? Bool == true,
                  let id = json["deviceId"] as? String,
                  let token = json["token"] as? String
            else {
                lastError = "Enrollment rejected"
                return
            }
            defaults.set(id, forKey: deviceIdKey)
            defaults.set(token, forKey: tokenKey)
            deviceId = id
            lastActivity = "Enrolled as \(deviceName)"
            if isEnabled { startForegroundLoopIfEligible() }
        } catch {
            lastError = "Enrollment failed: \(error.localizedDescription)"
        }
    }

    func unenroll() {
        defaults.removeObject(forKey: deviceIdKey)
        defaults.removeObject(forKey: tokenKey)
        deviceId = nil
        stopForegroundLoop()
    }

    private var ramClass: Int {
        Int(ProcessInfo.processInfo.physicalMemory / (1024 * 1024 * 1024))
    }

    // MARK: - Worker loop

    /// Poll while the app is open and the device is on power. Catalyst Macs are
    /// the workhorse; an iPhone on a charger with the app open contributes the
    /// same way (the F3 BGProcessingTask covers it when the app is closed).
    func startForegroundLoopIfEligible() {
        guard loopTask == nil, isEnabled, isEnrolled else { return }
        loopTask = Task { [weak self] in
            await self?.refreshQueue()
            while let self, !Task.isCancelled, self.isEnabled {
                if self.isEligible {
                    let didWork = await self.runOne()
                    if !didWork {
                        try? await Task.sleep(for: .seconds(30))
                    }
                } else {
                    try? await Task.sleep(for: .seconds(120))
                }
            }
            self?.isRunning = false
        }
    }

    func stopForegroundLoop() {
        loopTask?.cancel()
        loopTask = nil
        isRunning = false
    }

    /// One lease → handle → result/release cycle. Returns false when the queue
    /// has nothing for this device.
    @discardableResult
    func runOne() async -> Bool {
        guard isEligible else { return false }
        isRunning = true
        defer { isRunning = false }
        do {
            guard let job = try await lease() else { return false }
            lastActivity = "Working: \(job.kind)"
            do {
                let started = Date()
                let result = try await handle(job)
                try await submitResult(jobId: job.id, result: result)
                let elapsed = Date().timeIntervalSince(started)
                // Exponential moving average so the readout tracks current speed.
                avgJobSeconds = avgJobSeconds.map { $0 * 0.7 + elapsed * 0.3 } ?? elapsed
                jobsCompleted += 1
                lastActivity = "Completed \(job.kind)"
                if queueRemaining != nil { queueRemaining = max(0, (queueRemaining ?? 0) - 1) }
                // Re-sync the shared queue depth periodically (other devices drain it too).
                if jobsCompleted % 5 == 0 { await refreshQueue() }
            } catch {
                try await release(jobId: job.id, reason: error.localizedDescription)
                lastActivity = "Released \(job.kind): \(error.localizedDescription)"
            }
            return true
        } catch {
            lastError = error.localizedDescription
            return false
        }
    }

    // MARK: - Handlers (the capability registry)

    private struct FleetJob {
        let id: String
        let kind: String
        let payload: [String: Any]
    }

    private enum FleetError: LocalizedError {
        case noHandler(String)
        case badPayload
        var errorDescription: String? {
            switch self {
            case .noHandler(let kind): return "no handler for \(kind)"
            case .badPayload: return "malformed payload"
            }
        }
    }

    private func handle(_ job: FleetJob) async throws -> [String: Any] {
        switch job.kind {
        case "echo":
            guard let text = job.payload["text"] as? String else { throw FleetError.badPayload }
            return ["echoed": text.uppercased()]
        case "curriculum-scaffold":
            return try await scaffoldCurriculum(job.payload)
        case "realm-label":
            return try await labelRealm(job.payload)
        case "topic-label":
            return try await labelTopic(job.payload)
        case "classify-book":
            return try await classifyBook(job.payload)
        case "name-topic":
            return try await nameTopic(job.payload)
        case "judge-tension":
            return try await judgeTension(job.payload)
        case "tts-render-trail":
            return try await renderTrail(job)
        default:
            throw FleetError.noHandler(job.kind)
        }
    }

    // MARK: - realm-label (name a territory of themes, like a bookstore section)

    #if canImport(FoundationModels)
    @available(iOS 26.0, macCatalyst 26.0, *)
    @Generable
    struct RealmName: Sendable {
        @Guide(description: "A bookstore-section name for this territory of themes: 1-4 words, title case, no punctuation, no quotes. E.g. 'Gardening & Growing', 'War & Memory'.")
        var label: String
        @Guide(description: "One inviting sentence (under 140 characters) describing what a reader finds along these roads.")
        var blurb: String
    }
    #endif

    private func labelRealm(_ payload: [String: Any]) async throws -> [String: Any] {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, macCatalyst 26.0, *), foundationModelAvailable else {
            throw FleetError.noHandler("realm-label (model unavailable)")
        }
        guard let topics = payload["topics"] as? [[String: Any]], !topics.isEmpty else {
            throw FleetError.badPayload
        }
        let topicLines = topics.map { topic -> String in
            let label = (topic["label"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let books = (topic["books"] as? [String] ?? []).prefix(3).joined(separator: ", ")
            return "- \(label ?? "an unlabeled theme") (from: \(books))"
        }.joined(separator: "\n")
        let samples = (payload["samples"] as? [String] ?? []).prefix(4)
            .map { "“\($0.prefix(220))…”" }
            .joined(separator: "\n")

        let session = LanguageModelSession(
            instructions: """
            You name sections of a personal library, the way a beloved bookstore \
            names its shelves: short, warm, concrete. Never invent topics that \
            aren't in the evidence.
            """
        )
        let siblings = (payload["siblings"] as? [String] ?? []).joined(separator: " · ")
        let avoid = (payload["avoid"] as? [String] ?? []).joined(separator: " · ")
        var guidance = ""
        if !siblings.isEmpty {
            guidance += "\n\nNeighboring sections are already named: \(siblings). Choose a clearly different name that captures what makes THIS section distinct."
        }
        if !avoid.isEmpty {
            guidance += "\nDo NOT use a name resembling: \(avoid)."
        }
        let prompt = """
        This territory of the library holds these themes:

        \(topicLines)

        Sample passages from its books:

        \(samples)\(guidance)

        Name the section in Title Case and write its one-line shelf card.
        """
        let output = try await session.respond(generating: RealmName.self) { prompt }
        return ["label": output.content.label, "blurb": output.content.blurb]
        #else
        throw FleetError.noHandler("realm-label (FoundationModels not in SDK)")
        #endif
    }

    // MARK: - topic-label (name one road through a theme)

    #if canImport(FoundationModels)
    @available(iOS 26.0, macCatalyst 26.0, *)
    @Generable
    struct RoadName: Sendable {
        @Guide(description: "A short evocative title for this single thread of reading: 2-5 words, title case, no punctuation or quotes. Specific to the passages, e.g. 'The Duel at Weehawken', 'Pruning for Winter'.")
        var label: String
        @Guide(description: "One sentence (under 140 characters) saying what these passages are about.")
        var blurb: String
    }
    #endif

    private func labelTopic(_ payload: [String: Any]) async throws -> [String: Any] {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, macCatalyst 26.0, *), foundationModelAvailable else {
            throw FleetError.noHandler("topic-label (model unavailable)")
        }
        guard let samples = payload["samples"] as? [String], !samples.isEmpty else {
            throw FleetError.badPayload
        }
        let books = (payload["books"] as? [String] ?? []).joined(separator: ", ")
        let evidence = samples.prefix(3).map { "“\($0.prefix(260))…”" }.joined(separator: "\n\n")
        let session = LanguageModelSession(
            instructions: """
            You title threads of reading from a personal library — short, specific, \
            grounded only in the given passages. Never generic, never invented.
            """
        )
        let siblings = (payload["siblings"] as? [String] ?? []).joined(separator: " · ")
        let avoid = (payload["avoid"] as? [String] ?? []).joined(separator: " · ")
        var guidance = ""
        if !siblings.isEmpty {
            guidance += "\n\nNearby threads from the same books are already titled: \(siblings). Choose a clearly different title that names what is distinct about THIS thread."
        }
        if !avoid.isEmpty {
            guidance += "\nDo NOT use a title resembling: \(avoid)."
        }
        let prompt = """
        These passages (from: \(books)) form one thread:

        \(evidence)\(guidance)

        Title the thread in Title Case and write its one-line description.
        """
        let output = try await session.respond(generating: RoadName.self) { prompt }
        return ["label": output.content.label, "blurb": output.content.blurb]
        #else
        throw FleetError.noHandler("topic-label (FoundationModels not in SDK)")
        #endif
    }

    // MARK: - classify-book (fiction/nonfiction labelling for Reckoning mining)

    #if canImport(FoundationModels)
    @available(iOS 26.0, macCatalyst 26.0, *)
    @Generable
    struct BookClass: Sendable {
        @Guide(description: "Exactly \"fiction\" or \"nonfiction\". fiction = novels, short stories, any narrative invented work (fantasy, sci-fi, romance, children's chapter books, comics, LitRPG). nonfiction = factual/expository works (history, science, biography/memoir, how-to, reference, philosophy, religion, self-help, textbooks).")
        var category: String
        @Guide(description: "Confidence from 0.0 to 1.0 that the category is correct.")
        var confidence: Double
        @Guide(description: "One short sentence (under 160 characters) explaining the call.")
        var reason: String
    }
    #endif

    /// Label a book fiction|nonfiction from its title, author, and a short sample.
    /// Mirrors the Mac worker's Ollama classify-book handler so the box's mining
    /// nonfiction allowlist can be built by any fleet device with a local LLM.
    private func classifyBook(_ payload: [String: Any]) async throws -> [String: Any] {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, macCatalyst 26.0, *), foundationModelAvailable else {
            throw FleetError.noHandler("classify-book (model unavailable)")
        }
        let title = (payload["title"] as? String) ?? ""
        let author = (payload["author"] as? String) ?? ""
        let sample = String(((payload["sample"] as? String) ?? "").prefix(1200))

        let session = LanguageModelSession(
            instructions: """
            You are a librarian classifying a book as fiction or nonfiction from its \
            title, author, and a short text sample. fiction = novels, short stories, \
            and any narrative invented work (any genre). nonfiction = factual or \
            expository works (history, science, biography/memoir, how-to, reference, \
            philosophy, religion, self-help, textbooks). The sample may be empty — \
            then judge from the title and author alone.
            """
        )
        let prompt = """
        TITLE: \(title)
        AUTHOR: \(author.isEmpty ? "(unknown)" : author)
        SAMPLE: \(sample.isEmpty ? "(none)" : sample)

        Classify this book as fiction or nonfiction.
        """
        let output = try await session.respond(generating: BookClass.self) { prompt }

        // Coerce to the strict contract the server validator enforces.
        let raw = output.content.category.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        let category: String
        if raw.contains("non") {
            category = "nonfiction"
        } else if raw.contains("fiction") {
            category = "fiction"
        } else {
            category = "nonfiction"
        }
        let confidence = min(max(output.content.confidence, 0.0), 1.0)
        let reason = String(output.content.reason.prefix(200))
        return ["category": category, "confidence": confidence, "reason": reason]
        #else
        throw FleetError.noHandler("classify-book (FoundationModels not in SDK)")
        #endif
    }

    // MARK: - name-topic (name a journey topic across nonfiction books)

    #if canImport(FoundationModels)
    @available(iOS 26.0, macCatalyst 26.0, *)
    @Generable
    struct TopicName: Sendable {
        @Guide(description: "A Title Case section name for this theme: 2-6 words, no quotes, no punctuation. Specific and evocative, grounded only in the given concepts and excerpts.")
        var label: String
        @Guide(description: "One sentence (under 160 characters) describing what this theme is about — its shelf card.")
        var blurb: String
    }
    #endif

    private func nameTopic(_ payload: [String: Any]) async throws -> [String: Any] {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, macCatalyst 26.0, *), foundationModelAvailable else {
            throw FleetError.noHandler("name-topic (model unavailable)")
        }
        let concepts = (payload["concepts"] as? [String] ?? []).prefix(8).joined(separator: ", ")
        let samples = (payload["samples"] as? [String] ?? []).prefix(3)
            .map { "“\($0.prefix(400))”" }.joined(separator: "\n\n")
        let session = LanguageModelSession(
            instructions: """
            You name a section of a personal library — a theme that runs across several \
            nonfiction books — the way a thoughtful bookstore names a shelf: short, \
            specific, evocative, grounded ONLY in the given material. Never invent a \
            topic the concepts and excerpts don't support.
            """
        )
        let prompt = """
        Distinctive concepts in this theme: \(concepts)

        Sample passages:

        \(samples)

        Name this theme in Title Case (2-6 words) and write its one-line shelf card.
        """
        let output = try await session.respond(generating: TopicName.self) { prompt }
        var label = output.content.label.trimmingCharacters(in: .whitespacesAndNewlines)
        // clamp to the server validator: <=7 words, <=60 chars
        let words = label.split(separator: " ")
        if words.count > 7 { label = words.prefix(7).joined(separator: " ") }
        label = String(label.prefix(60))
        let blurb = String(output.content.blurb.prefix(200))
        return ["label": label, "blurb": blurb]
        #else
        throw FleetError.noHandler("name-topic (FoundationModels not in SDK)")
        #endif
    }

    // MARK: - judge-tension (Reckoning adjudication: how two passages relate)

    #if canImport(FoundationModels)
    @available(iOS 26.0, macCatalyst 26.0, *)
    @Generable
    struct TensionVerdict: Sendable {
        @Guide(description: "Exactly one of: \"agree\", \"contradict\", \"qualify\", \"neutral\". neutral when the two passages make no real, specific claim relating them, OR when the shared word is used in DIFFERENT SENSES (a coincidental word match is NOT a relationship).")
        var verdict: String
        @Guide(description: "One sentence (>= 8 characters) naming the relationship, or \"\" for neutral.")
        var tension: String
        @Guide(description: "One sentence question the reader could take a position on, or \"\" for neutral.")
        var stanceQuestion: String
    }

    @available(iOS 26.0, macCatalyst 26.0, *)
    @Generable
    struct TensionSpans: Sendable {
        @Guide(description: "A span COPIED VERBATIM from Passage A (8-30 words, exact characters, no edits) that carries the relationship.")
        var spanA: String
        @Guide(description: "A span COPIED VERBATIM from Passage B (8-30 words, exact characters, no edits) that carries the relationship.")
        var spanB: String
    }
    #endif

    /// Two-stage judge, mirroring the Mac worker (scripts/fleet-worker.ts):
    /// stage 1 decides the relationship with a focused, polysemy-guarded prompt
    /// (no spans — span-hunting in the verdict step causes false positives);
    /// stage 2 extracts verbatim grounding spans only for a real relationship,
    /// then downgrades to neutral if they can't be grounded so the server
    /// validator never rejects the result.
    private func judgeTension(_ payload: [String: Any]) async throws -> [String: Any] {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, macCatalyst 26.0, *), foundationModelAvailable else {
            throw FleetError.noHandler("judge-tension (model unavailable)")
        }
        let subject = (payload["subject"] as? String) ?? ""
        let textA = (payload["textA"] as? String) ?? ""
        let textB = (payload["textB"] as? String) ?? ""
        let clipA = String(textA.prefix(800))
        let clipB = String(textB.prefix(800))
        let valid: Set<String> = ["agree", "contradict", "qualify", "neutral"]

        // STAGE 1 — verdict only.
        let verdictSession = LanguageModelSession(
            instructions: """
            You are a careful librarian deciding how two NONFICTION book passages \
            relate ON ONE shared idea. Judge ONLY the relationship between the two \
            passages about that idea; never introduce outside facts. Most pairs have \
            NO real relationship; default to neutral. A real relationship is one where \
            BOTH passages make a substantive claim about the SAME idea in the SAME \
            sense — they may corroborate it (agree), refine/condition it (qualify), or \
            conflict (contradict). CRITICAL: if the shared word is used in DIFFERENT \
            SENSES (e.g. 'change' as reform vs modifying code; 'signal' as an omen vs a \
            software signal), that is NOT a relationship — choose neutral.
            """
        )
        let verdictPrompt = """
        SHARED SUBJECT: \(subject)

        Passage A:
        \"\"\"\(clipA)\"\"\"

        Passage B:
        \"\"\"\(clipB)\"\"\"

        Decide the relationship of the two passages about the shared subject.
        """
        let v = try await verdictSession.respond(generating: TensionVerdict.self) { verdictPrompt }
        var verdict = v.content.verdict.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
        if !valid.contains(verdict) { verdict = "neutral" }
        var tension = v.content.tension
        var stanceQuestion = v.content.stanceQuestion
        var spanA = ""
        var spanB = ""

        // STAGE 2 — grounding spans, only for a real relationship.
        if verdict != "neutral" && tension.trimmingCharacters(in: .whitespaces).count >= 8 {
            func askSpans(emphasize: Bool) async throws -> (String, String) {
                let spanSession = LanguageModelSession(
                    instructions: "You copy verbatim spans from passages — exact characters, no paraphrase, no edits."
                )
                let note = emphasize
                    ? "IMPORTANT: your previous spans were not exact quotes. Copy them VERBATIM, character for character."
                    : "Copy each span VERBATIM — exact characters, no edits."
                let spanPrompt = """
                SHARED SUBJECT: \(subject)
                These two passages \(verdict.uppercased()) about it: \(tension)

                Passage A:
                \"\"\"\(clipA)\"\"\"

                Passage B:
                \"\"\"\(clipB)\"\"\"

                Copy the 8-30 word span from EACH passage that carries this relationship. \(note)
                """
                let s = try await spanSession.respond(generating: TensionSpans.self) { spanPrompt }
                return (s.content.spanA, s.content.spanB)
            }
            (spanA, spanB) = try await askSpans(emphasize: false)
            if !(spanGrounded(spanA, textA) && spanGrounded(spanB, textB)) {
                (spanA, spanB) = try await askSpans(emphasize: true)
            }
        }

        // Downgrade to neutral if a non-neutral verdict can't be grounded.
        if verdict != "neutral" {
            if !spanGrounded(spanA, textA) || !spanGrounded(spanB, textB)
                || tension.trimmingCharacters(in: .whitespaces).count < 8 {
                verdict = "neutral"
            }
        }
        if verdict == "neutral" {
            spanA = ""; spanB = ""; tension = ""; stanceQuestion = ""
        }
        return [
            "verdict": verdict, "tension": tension, "stanceQuestion": stanceQuestion,
            "spanA": spanA, "spanB": spanB,
        ]
        #else
        throw FleetError.noHandler("judge-tension (FoundationModels not in SDK)")
        #endif
    }

    /// Normalize for the server's grounding check (kinds.ts spanGrounded): lower,
    /// straighten curly quotes, collapse whitespace, trim.
    private func normForGround(_ s: String) -> String {
        var t = s.lowercased()
        for q in ["\u{2018}", "\u{2019}", "\u{201C}", "\u{201D}"] {
            t = t.replacingOccurrences(of: q, with: "'")
        }
        t = t.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
        return t.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// True if `span` is a verbatim (normalized) substring of `text`, >= 8 chars.
    private func spanGrounded(_ span: String, _ text: String) -> Bool {
        let s = normForGround(span)
        return s.count >= 8 && normForGround(text).contains(s)
    }

    // MARK: - tts-render-trail (audio wander, S5)

    /// Render a saved trail's passages to one WAV with the local Kokoro voice,
    /// upload it as a content-addressed artifact, and return its hash. A short
    /// silence separates stops so the narration breathes between books.
    private func renderTrail(_ job: FleetJob) async throws -> [String: Any] {
        guard let segments = job.payload["segments"] as? [[String: Any]], !segments.isEmpty else {
            throw FleetError.badPayload
        }
        if kokoroContext == nil {
            let voiceIndex = UInt32(job.payload["voiceIndex"] as? Int ?? 0)
            kokoroContext = try KokoroTTSContext.createFromBundle(voiceIndex: voiceIndex)
        }
        guard let context = kokoroContext else { throw FleetError.noHandler("kokoro") }

        let gap = [Float](repeating: 0, count: KokoroTTSContext.sampleRate / 2) // 0.5 s
        var samples: [Float] = []
        for (index, segment) in segments.enumerated() {
            guard let text = segment["text"] as? String, !text.isEmpty else { continue }
            let result = try await context.generateAudioStreaming(text: text, onChunk: { _ in })
            samples.append(contentsOf: result.audioSamples)
            if index < segments.count - 1 { samples.append(contentsOf: gap) }
            // Long render: keep the lease alive between stops.
            if let heartbeat = try? fabricRequest("/api/fabric/work/\(job.id)/heartbeat", body: [:]) {
                _ = try? await session.data(for: heartbeat)
            }
        }
        guard !samples.isEmpty else { throw FleetError.badPayload }

        let wav = Self.encodeWAV(samples: samples, sampleRate: KokoroTTSContext.sampleRate)
        let artifactHash = try await uploadArtifact(jobId: job.id, data: wav)
        return [
            "artifactHash": artifactHash,
            "durationSec": Double(samples.count) / Double(KokoroTTSContext.sampleRate),
            "sampleCount": samples.count,
        ]
    }

    /// Minimal mono 16-bit PCM WAV encoding (Kokoro output is 24 kHz mono).
    static func encodeWAV(samples: [Float], sampleRate: Int) -> Data {
        var pcm = Data(capacity: samples.count * 2)
        for sample in samples {
            let clamped = max(-1, min(1, sample))
            var value = Int16(clamped * Float(Int16.max))
            withUnsafeBytes(of: &value) { pcm.append(contentsOf: $0) }
        }
        var data = Data()
        func append(_ string: String) { data.append(string.data(using: .ascii)!) }
        func append32(_ v: UInt32) { var x = v.littleEndian; withUnsafeBytes(of: &x) { data.append(contentsOf: $0) } }
        func append16(_ v: UInt16) { var x = v.littleEndian; withUnsafeBytes(of: &x) { data.append(contentsOf: $0) } }
        append("RIFF")
        append32(UInt32(36 + pcm.count))
        append("WAVE")
        append("fmt ")
        append32(16)
        append16(1) // PCM
        append16(1) // mono
        append32(UInt32(sampleRate))
        append32(UInt32(sampleRate * 2)) // byte rate
        append16(2) // block align
        append16(16) // bits per sample
        append("data")
        append32(UInt32(pcm.count))
        data.append(pcm)
        return data
    }

    private func uploadArtifact(jobId: String, data: Data) async throws -> String {
        guard let url = serverConfig.apiURL("/api/fabric/work/\(jobId)/artifact"),
              let token = defaults.string(forKey: tokenKey)
        else { throw FleetError.badPayload }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(token, forHTTPHeaderField: "X-Fabric-Token")
        request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
        let (responseData, _) = try await session.upload(for: request, from: data)
        guard let json = try JSONSerialization.jsonObject(with: responseData) as? [String: Any],
              let hash = json["artifactHash"] as? String
        else { throw FleetError.badPayload }
        return hash
    }

    // MARK: - curriculum-scaffold (Tier B, on-device generation)

    // Not `private`: the @Generable macro emits a same-file extension that
    // can't see a private nested type.
    #if canImport(FoundationModels)
    @available(iOS 26.0, macCatalyst 26.0, *)
    @Generable
    struct ScaffoldOutput: Sendable {
        @Guide(description: "A short, inviting study-path title for this theme, 3-8 words, no quotes.")
        var title: String
        @Guide(description: "One transition sentence per passage, in the given order — why this passage comes next. 10-25 words each, warm and concrete, never quoting the passage.")
        var transitions: [String]
    }
    #endif

    /// Generate module title + transitions with the on-device model. Output is
    /// scaffolding only (Rule 2) — the server validates structure (ordinal
    /// coverage, length caps) before anything lands; a refusal or junk output
    /// here just re-queues the job for another worker.
    private func scaffoldCurriculum(_ payload: [String: Any]) async throws -> [String: Any] {
        #if canImport(FoundationModels)
        guard #available(iOS 26.0, macCatalyst 26.0, *), foundationModelAvailable else {
            throw FleetError.noHandler("curriculum-scaffold (model unavailable)")
        }
        guard let items = payload["items"] as? [[String: Any]], !items.isEmpty else {
            throw FleetError.badPayload
        }
        let topicLabel = payload["topicLabel"] as? String ?? "this theme"
        let listing = items.enumerated().map { index, item -> String in
            let role = item["role"] as? String ?? "passage"
            let book = item["bookTitle"] as? String ?? "a book"
            let text = (item["text"] as? String ?? "").prefix(400)
            return "\(index + 1). [\(role), from “\(book)”] \(text)"
        }.joined(separator: "\n\n")

        let session = LanguageModelSession(
            instructions: """
            You write gentle, concrete connective tissue for a reading study path \
            built from real book passages. Never invent facts; refer only to what \
            the passages say and which book they come from.
            """
        )
        let prompt = """
        Theme: \(topicLabel)

        The study path shows these \(items.count) passages in order:

        \(listing)

        Write the study-path title and exactly \(items.count) transition sentences, \
        one per passage in order. Each transition tells the reader why this passage \
        comes next (e.g. a new framing from another book, a concrete example, putting \
        the idea to work).
        """
        let output = try await session.respond(generating: ScaffoldOutput.self) { prompt }
        let ordinals = items.compactMap { $0["ordinal"] as? Int }
        let transitions = zip(ordinals, output.content.transitions).map { ordinal, text in
            ["ordinal": ordinal, "text": text] as [String: Any]
        }
        return ["title": output.content.title, "transitions": transitions]
        #else
        throw FleetError.noHandler("curriculum-scaffold (FoundationModels not in SDK)")
        #endif
    }

    private var modelId: String {
        #if targetEnvironment(macCatalyst)
        let os = "macos"
        #else
        let os = UIDevice.current.systemName.lowercased()
        #endif
        return "device/\(os)-\(UIDevice.current.systemVersion)"
    }

    // MARK: - Fabric API

    private func fabricRequest(_ path: String, body: [String: Any]) throws -> URLRequest {
        guard let url = serverConfig.apiURL(path), let token = defaults.string(forKey: tokenKey)
        else { throw FleetError.badPayload }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(token, forHTTPHeaderField: "X-Fabric-Token")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }

    /// Fetch the shared queue depth and keep the count of jobs THIS device can do.
    /// Best-effort: a failure just leaves the last known value.
    private func refreshQueue() async {
        guard let url = serverConfig.apiURL("/api/fabric/status") else { return }
        var request = URLRequest(url: url)
        if let token = defaults.string(forKey: tokenKey) {
            request.setValue(token, forHTTPHeaderField: "X-Fabric-Token")
        }
        do {
            let (data, _) = try await session.data(for: request)
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let byKind = json["byKind"] as? [String: Any] else { return }
            var total = 0
            for kind in handledKinds.keys where kind != "echo" {
                if let n = byKind[kind] as? Int { total += n }
            }
            queueRemaining = total
        } catch {
            // leave stale
        }
    }

    private func lease() async throws -> FleetJob? {
        let request = try fabricRequest(
            "/api/fabric/lease",
            body: [
                "capabilities": ["runtimes": runtimes, "kinds": handledKinds, "ramClass": ramClass],
                "deviceName": defaultDeviceName,
            ]
        )
        let (data, _) = try await session.data(for: request)
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let job = json["job"] as? [String: Any],
              let id = job["id"] as? String,
              let kind = job["kind"] as? String
        else { return nil }
        return FleetJob(id: id, kind: kind, payload: job["payload"] as? [String: Any] ?? [:])
    }

    private func submitResult(jobId: String, result: [String: Any]) async throws {
        let request = try fabricRequest(
            "/api/fabric/work/\(jobId)/result",
            body: ["result": result, "modelId": modelId]
        )
        _ = try await session.data(for: request)
    }

    private func release(jobId: String, reason: String) async throws {
        let request = try fabricRequest(
            "/api/fabric/work/\(jobId)/release",
            body: ["reason": reason]
        )
        _ = try await session.data(for: request)
    }

    // MARK: - iOS background path (F3): run during charging windows

    nonisolated static func registerBackgroundTask(service: FleetWorkerService) {
        BGTaskScheduler.shared.register(
            forTaskWithIdentifier: backgroundTaskIdentifier,
            using: nil
        ) { task in
            guard let processingTask = task as? BGProcessingTask else {
                task.setTaskCompleted(success: false)
                return
            }
            Task { @MainActor in
                service.handleBackgroundTask(processingTask)
            }
        }
    }

    func scheduleBackgroundTaskIfNeeded() {
        guard isEnabled, isEnrolled else { return }
        let request = BGProcessingTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.requiresExternalPower = true
        request.requiresNetworkConnectivity = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do {
            try BGTaskScheduler.shared.submit(request)
        } catch {
            // Duplicate submissions are fine; anything else is non-fatal.
        }
    }

    private func handleBackgroundTask(_ task: BGProcessingTask) {
        scheduleBackgroundTaskIfNeeded() // keep the chain alive for tomorrow night
        let work = Task { @MainActor in
            // Chew through jobs until the grant expires or the queue is dry.
            while !Task.isCancelled {
                let didWork = await runOne()
                if !didWork { break }
            }
            task.setTaskCompleted(success: true)
        }
        task.expirationHandler = {
            work.cancel()
            task.setTaskCompleted(success: true)
        }
    }
}
