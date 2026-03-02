import { useState } from "react";
import { CodeBlock, TabButton } from "@app/components/docs";

type TabId = "transcription" | "tts" | "playback";

function PlatformBadge({ platform }: { platform: "web" | "ios" }) {
  const styles =
    platform === "web"
      ? "bg-primary-light text-primary border-primary/20"
      : "bg-accent-light text-accent border-accent/20";
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border ${styles}`}
    >
      {platform === "web" ? "Web" : "iOS"}
    </span>
  );
}

function SectionHeading({
  children,
  platform,
}: {
  children: React.ReactNode;
  platform?: "web" | "ios";
}) {
  return (
    <h3 className="text-lg font-semibold text-foreground mb-3 flex items-center gap-2">
      {platform && <PlatformBadge platform={platform} />}
      {children}
    </h3>
  );
}

export default function AudioSpeech() {
  const [activeTab, setActiveTab] = useState<TabId>("transcription");

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-foreground mb-2">
          Audio & Speech
        </h1>
        <p className="text-foreground-muted">
          Compendus can transcribe audiobooks to text, read EPUBs aloud with
          text-to-speech, and play audiobooks with synchronized karaoke-style
          lyrics.
        </p>
      </div>

      {/* Platform Overview */}
      <div className="mb-8 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-foreground-muted border-b border-border">
              <th className="pr-6 py-2">Feature</th>
              <th className="pr-6 py-2">Web</th>
              <th className="py-2">iOS</th>
            </tr>
          </thead>
          <tbody className="text-foreground">
            {[
              [
                "Audiobook Transcription",
                "whisper.cpp (server-side)",
                "whisper.cpp (on-device)",
              ],
              [
                "Text-to-Speech",
                "Web Speech API",
                "PocketTTS (Rust engine)",
              ],
              [
                "Audiobook Playback",
                "HTML5 audio",
                "AVAudioPlayer",
              ],
              [
                "Karaoke Lyrics",
                "DOM highlighting",
                "Native text view",
              ],
              [
                "Background Processing",
                "Server job queue",
                "BGProcessingTask",
              ],
              [
                "Offline Capable",
                "No (server-side)",
                "Yes (on-device)",
              ],
            ].map(([feature, web, ios]) => (
              <tr key={feature} className="border-b border-border/50">
                <td className="pr-6 py-2 font-medium">{feature}</td>
                <td className="pr-6 py-2 text-foreground-muted">{web}</td>
                <td className="py-2 text-foreground-muted">{ios}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Tab Navigation */}
      <div className="flex flex-wrap gap-2 mb-6 pb-4 border-b border-border">
        <TabButton
          active={activeTab === "transcription"}
          onClick={() => setActiveTab("transcription")}
        >
          Transcription
        </TabButton>
        <TabButton
          active={activeTab === "tts"}
          onClick={() => setActiveTab("tts")}
        >
          Text-to-Speech
        </TabButton>
        <TabButton
          active={activeTab === "playback"}
          onClick={() => setActiveTab("playback")}
        >
          Audiobook Playback
        </TabButton>
      </div>

      {/* Transcription Tab */}
      {activeTab === "transcription" && (
        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              Audiobook Transcription
            </h2>
            <p className="text-foreground-muted mb-4">
              Compendus uses{" "}
              <code className="bg-surface-elevated px-1.5 py-0.5 rounded border border-border text-foreground">
                whisper.cpp
              </code>{" "}
              to transcribe audiobooks into text with word-level timestamps.
              Transcripts enable searchable audiobook content, karaoke-style
              lyrics during playback, and synced text highlighting.
            </p>
          </section>

          <section>
            <SectionHeading platform="web">
              Server-Side Transcription
            </SectionHeading>
            <p className="text-foreground-muted mb-3">
              The server processes audiobooks through whisper.cpp in 30-minute
              chunks to prevent memory issues. Models are automatically
              downloaded from HuggingFace on first use.
            </p>
            <div className="space-y-3 mb-4">
              {[
                {
                  label: "Processing",
                  value:
                    "Audio split into 30-minute WAV chunks (16 kHz mono), processed sequentially",
                },
                {
                  label: "Output",
                  value:
                    "JSON transcript with segments and word-level timing (3 decimal places)",
                },
                {
                  label: "Timeout",
                  value: "2 hours per chunk",
                },
                {
                  label: "Prerequisites",
                  value: "whisper-cli and ffmpeg on PATH",
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex gap-3 text-sm"
                >
                  <span className="font-medium text-foreground shrink-0 w-28">
                    {label}
                  </span>
                  <span className="text-foreground-muted">{value}</span>
                </div>
              ))}
            </div>
            <h4 className="text-sm font-semibold text-foreground mb-2">
              Environment Variables
            </h4>
            <CodeBlock language="bash">{`# Whisper model size (default: "small")
# Options: tiny, base, small, medium, large
WHISPER_MODEL=small`}</CodeBlock>
          </section>

          <section>
            <SectionHeading platform="ios">
              On-Device Transcription
            </SectionHeading>
            <p className="text-foreground-muted mb-3">
              The iOS app runs whisper.cpp entirely on-device using the GGML
              runtime. No audio data is sent to external services.
            </p>
            <div className="space-y-3 mb-4">
              {[
                {
                  label: "Processing",
                  value:
                    "Audio split into 30-second chunks to manage memory on mobile",
                },
                {
                  label: "Background",
                  value:
                    "Uses BGProcessingTask for transcription while the app is backgrounded",
                },
                {
                  label: "Resume",
                  value:
                    "Transcription state is persisted to disk and resumes across app sessions",
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex gap-3 text-sm"
                >
                  <span className="font-medium text-foreground shrink-0 w-28">
                    {label}
                  </span>
                  <span className="text-foreground-muted">{value}</span>
                </div>
              ))}
            </div>
            <h4 className="text-sm font-semibold text-foreground mb-2">
              Transcription Modes
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="border border-border rounded-lg p-4">
                <h5 className="font-medium text-foreground mb-1">
                  Live Transcription
                </h5>
                <p className="text-sm text-foreground-muted">
                  Transcribes in sync with audio playback. Pauses playback when
                  the transcript buffer falls behind, then auto-resumes once
                  30 seconds ahead.
                </p>
              </div>
              <div className="border border-border rounded-lg p-4">
                <h5 className="font-medium text-foreground mb-1">
                  Full Transcription
                </h5>
                <p className="text-sm text-foreground-muted">
                  Processes the entire audiobook offline in the background.
                  Progress is tracked and the transcript is persisted to disk
                  when complete.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              Transcript API
            </h2>
            <p className="text-foreground-muted mb-4">
              The server exposes REST endpoints for managing audiobook
              transcripts. The iOS app uses the PUT endpoint to upload
              on-device transcripts for server-side storage.
            </p>
            <div className="space-y-3">
              {[
                {
                  method: "POST",
                  path: "/api/books/:id/transcribe",
                  description:
                    "Start a server-side transcription job. Accepts optional force parameter to re-transcribe.",
                  color: "bg-primary-light text-primary",
                },
                {
                  method: "GET",
                  path: "/api/books/:id/transcript",
                  description:
                    "Retrieve the saved transcript JSON for an audiobook.",
                  color: "bg-success-light text-success",
                },
                {
                  method: "PUT",
                  path: "/api/books/:id/transcript",
                  description:
                    "Upload or update a transcript (used by iOS to sync on-device transcripts).",
                  color: "bg-warning-light text-warning",
                },
                {
                  method: "DELETE",
                  path: "/api/books/:id/transcript",
                  description: "Remove a saved transcript.",
                  color: "bg-danger-light text-danger",
                },
                {
                  method: "GET",
                  path: "/api/books/:id/transcript-status",
                  description:
                    "Quick check for whether a transcript exists for a book.",
                  color: "bg-success-light text-success",
                },
              ].map((endpoint) => (
                <div
                  key={`${endpoint.method}-${endpoint.path}`}
                  className="border border-border rounded-lg overflow-hidden"
                >
                  <div className="px-4 py-3 flex items-center gap-3 bg-surface-elevated">
                    <span
                      className={`px-2 py-1 text-xs font-mono font-semibold rounded ${endpoint.color}`}
                    >
                      {endpoint.method}
                    </span>
                    <code className="text-sm font-mono text-foreground">
                      {endpoint.path}
                    </code>
                  </div>
                  <div className="px-4 py-3 border-t border-border">
                    <p className="text-sm text-foreground-muted">
                      {endpoint.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              Transcript Data Model
            </h2>
            <p className="text-foreground-muted mb-3">
              Both server and iOS produce the same transcript format with
              word-level timing information.
            </p>
            <CodeBlock language="typescript">{`interface Transcript {
  duration: number;      // total duration in seconds
  language: string;      // detected language code
  segments: TranscriptSegment[];
}

interface TranscriptSegment {
  start: number;         // segment start time (seconds)
  end: number;           // segment end time (seconds)
  text: string;          // segment text content
  words: TranscriptWord[];
}

interface TranscriptWord {
  word: string;          // individual word
  start: number;         // word start time (seconds)
  end: number;           // word end time (seconds)
}`}</CodeBlock>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              Karaoke Lyrics
            </h2>
            <p className="text-foreground-muted mb-3">
              When a transcript is available, the audiobook player displays
              synchronized lyrics with word-level highlighting that follows
              playback in real time.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  title: "Word-Level Sync",
                  description:
                    "Each word highlights precisely when spoken, using binary search for efficient segment lookup.",
                },
                {
                  title: "Auto-Scrolling",
                  description:
                    "The lyrics view automatically scrolls to keep the current line visible as playback progresses.",
                },
                {
                  title: "Tap to Seek",
                  description:
                    "Tap any word in the transcript to jump playback to that exact timestamp.",
                },
                {
                  title: "Theme Support",
                  description:
                    "Lyrics adapt to the current reading theme and color scheme.",
                },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="border border-border rounded-lg p-4"
                >
                  <h5 className="font-medium text-foreground mb-1">
                    {feature.title}
                  </h5>
                  <p className="text-sm text-foreground-muted">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Text-to-Speech Tab */}
      {activeTab === "tts" && (
        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              Text-to-Speech
            </h2>
            <p className="text-foreground-muted mb-4">
              Compendus can read EPUB content aloud using text-to-speech. The
              web app uses the browser's built-in Web Speech API while the iOS
              app uses PocketTTS, a Rust-based neural TTS engine bundled as an
              xcframework.
            </p>
          </section>

          <section>
            <SectionHeading platform="web">Web Read Aloud</SectionHeading>
            <p className="text-foreground-muted mb-3">
              The web reader includes a read-aloud bar that uses the browser's
              native Web Speech API for text-to-speech with sentence-level
              tracking.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {[
                {
                  title: "Voice Selection",
                  description:
                    "Choose from any system voice installed on the device. Selection persists in localStorage.",
                },
                {
                  title: "Speed Control",
                  description:
                    "Adjustable playback speed from 0.5x to 2.0x with fine-grained control.",
                },
                {
                  title: "Sentence Highlighting",
                  description:
                    "The currently spoken sentence is highlighted in the DOM with automatic smooth scrolling.",
                },
                {
                  title: "Progress Tracking",
                  description:
                    "Displays current sentence number and total count. Triggers page turn on completion.",
                },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="border border-border rounded-lg p-4"
                >
                  <h5 className="font-medium text-foreground mb-1">
                    {feature.title}
                  </h5>
                  <p className="text-sm text-foreground-muted">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
            <h4 className="text-sm font-semibold text-foreground mb-2">
              Sentence Splitting
            </h4>
            <p className="text-sm text-foreground-muted mb-3">
              Text is split into sentences using a regex that handles
              abbreviations (Mr., Mrs., Dr., etc.), decimal numbers, and
              ellipses to avoid premature breaks. Each sentence is spoken
              individually with the corresponding text highlighted in the
              reader.
            </p>
          </section>

          <section>
            <SectionHeading platform="ios">iOS PocketTTS Engine</SectionHeading>
            <p className="text-foreground-muted mb-3">
              The iOS app uses PocketTTS, a Rust-based neural text-to-speech
              engine compiled as an xcframework. It generates high-quality
              speech entirely on-device with no network requests.
            </p>
            <div className="space-y-3 mb-4">
              {[
                {
                  label: "Voices",
                  value:
                    "8 built-in voices (selectable by index)",
                },
                {
                  label: "Output",
                  value: "24 kHz mono Float32 PCM audio",
                },
                {
                  label: "Streaming",
                  value:
                    "Audio is generated and played in real time with streaming playback",
                },
                {
                  label: "Parameters",
                  value:
                    "Configurable speed, temperature, and top-P for voice quality tuning",
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex gap-3 text-sm"
                >
                  <span className="font-medium text-foreground shrink-0 w-28">
                    {label}
                  </span>
                  <span className="text-foreground-muted">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionHeading platform="ios">Audio Caching</SectionHeading>
            <p className="text-foreground-muted mb-3">
              Generated TTS audio is cached to disk so chapters only need to
              be synthesized once. The cache stores raw PCM data alongside
              sentence timing metadata for efficient playback and text
              synchronization.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  title: "Per-Chapter Storage",
                  description:
                    "Each chapter's PCM audio is cached separately on disk with Float32 raw format.",
                },
                {
                  title: "Sentence Timings",
                  description:
                    "Word-level timing metadata is stored alongside audio for synchronized highlighting.",
                },
                {
                  title: "Voice Tracking",
                  description:
                    "Cache tracks the voice ID used, automatically invalidating when the voice changes.",
                },
                {
                  title: "Efficient Loading",
                  description:
                    "Supports sample-range loading so only the needed portion of audio is read into memory.",
                },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="border border-border rounded-lg p-4"
                >
                  <h5 className="font-medium text-foreground mb-1">
                    {feature.title}
                  </h5>
                  <p className="text-sm text-foreground-muted">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionHeading platform="ios">
              Pre-Generation & Read-Along
            </SectionHeading>
            <p className="text-foreground-muted mb-3">
              The iOS app can pre-generate TTS audio for entire books in the
              background, and coordinate text highlighting with audio playback
              for a read-along experience.
            </p>
            <div className="space-y-3">
              {[
                {
                  label: "Pre-Gen",
                  value:
                    "TTSPreGenerationService synthesizes chapters via BGProcessingTask, resumable across sessions",
                },
                {
                  label: "Read-Along",
                  value:
                    "ReadAlongService coordinates PocketTTS playback with page-level text highlighting",
                },
                {
                  label: "Transcript",
                  value:
                    "TTSTranscriptBuilder converts TTS sentence timings into the same Transcript format used by whisper",
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex gap-3 text-sm"
                >
                  <span className="font-medium text-foreground shrink-0 w-28">
                    {label}
                  </span>
                  <span className="text-foreground-muted">{value}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* Audiobook Playback Tab */}
      {activeTab === "playback" && (
        <div className="space-y-8">
          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              Audiobook Playback
            </h2>
            <p className="text-foreground-muted mb-4">
              Compendus provides full audiobook playback with chapter
              navigation, speed control, sleep timers, and synchronized
              transcript display. The iOS app offers a rich native player
              with system integration.
            </p>
          </section>

          <section>
            <SectionHeading platform="ios">Player Features</SectionHeading>
            <p className="text-foreground-muted mb-3">
              The iOS audiobook player is built on AVAudioPlayer with full
              system integration for background playback and media controls.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                {
                  title: "Speed Control",
                  description:
                    "Adjustable from 0.5x to 2.0x playback speed.",
                },
                {
                  title: "Sleep Timer",
                  description:
                    "Preset timers for 15, 30, 45, or 60 minutes.",
                },
                {
                  title: "Chapter Navigation",
                  description:
                    "Jump between chapters with progress indicators for each.",
                },
                {
                  title: "Now Playing",
                  description:
                    "Integrates with iOS Now Playing, showing cover art, title, and controls on the lock screen.",
                },
                {
                  title: "Remote Controls",
                  description:
                    "Hardware buttons and Control Center playback controls work automatically.",
                },
                {
                  title: "Background Audio",
                  description:
                    "Continues playing when the app is backgrounded or the device is locked.",
                },
                {
                  title: "Progress Saving",
                  description:
                    "Playback position is saved every 30 seconds and restored on reopen.",
                },
                {
                  title: "Reading Sessions",
                  description:
                    "Listening time is tracked as reading sessions with format 'audiobook'.",
                },
                {
                  title: "Widget",
                  description:
                    "WidgetKit integration shows the currently playing audiobook on the home screen.",
                },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="border border-border rounded-lg p-4"
                >
                  <h5 className="font-medium text-foreground mb-1">
                    {feature.title}
                  </h5>
                  <p className="text-sm text-foreground-muted">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionHeading platform="ios">Player Interface</SectionHeading>
            <p className="text-foreground-muted mb-3">
              The audiobook player view displays cover art with a blurred
              background, playback controls, and an optional synchronized
              transcript overlay.
            </p>
            <div className="space-y-3">
              {[
                {
                  label: "Cover Art",
                  value:
                    "Displays the book cover with a blurred background effect. Falls back to a gradient placeholder.",
                },
                {
                  label: "Transcript",
                  value:
                    "Toggle button to show/hide karaoke lyrics over the player. Offers live or full transcription if none exists.",
                },
                {
                  label: "Chapters",
                  value:
                    "Sheet-based chapter picker showing all chapters with duration and current progress.",
                },
                {
                  label: "Controls",
                  value:
                    "Play/pause, skip forward/back 15 seconds, chapter skip, and scrubber with time display.",
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex gap-3 text-sm"
                >
                  <span className="font-medium text-foreground shrink-0 w-28">
                    {label}
                  </span>
                  <span className="text-foreground-muted">{value}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              Audio File Processing
            </h2>
            <p className="text-foreground-muted mb-3">
              When audiobooks are uploaded, the server extracts metadata,
              chapters, and cover art automatically.
            </p>
            <div className="space-y-3 mb-4">
              {[
                {
                  label: "Metadata",
                  value:
                    "Title, artist, duration, narrator, publisher, and language from ID3/M4A tags",
                },
                {
                  label: "Chapters",
                  value:
                    "Extracted from M4B chpl atoms or ID3v2 CHAP frames. Falls back to a single 'Full Audio' chapter.",
                },
                {
                  label: "Covers",
                  value:
                    "Embedded artwork is extracted and processed with dominant color detection.",
                },
                {
                  label: "Multi-File",
                  value:
                    "Multiple MP3/M4A files can be merged into a single audiobook via ffmpeg with auto-generated chapters.",
                },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="flex gap-3 text-sm"
                >
                  <span className="font-medium text-foreground shrink-0 w-28">
                    {label}
                  </span>
                  <span className="text-foreground-muted">{value}</span>
                </div>
              ))}
            </div>
            <h4 className="text-sm font-semibold text-foreground mb-2">
              Supported Formats
            </h4>
            <div className="flex flex-wrap gap-2">
              {["M4B", "M4A", "MP3"].map((fmt) => (
                <span
                  key={fmt}
                  className="px-3 py-1.5 bg-accent-light text-accent border border-accent/20 rounded-lg text-sm font-mono font-medium"
                >
                  .{fmt.toLowerCase()}
                </span>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-foreground mb-3">
              Chapter Data Model
            </h2>
            <CodeBlock language="typescript">{`interface AudioChapter {
  index: number;       // chapter order
  title: string;       // chapter title
  startTime: number;   // start time in seconds
  endTime: number;     // end time in seconds
}`}</CodeBlock>
          </section>
        </div>
      )}
    </div>
  );
}
