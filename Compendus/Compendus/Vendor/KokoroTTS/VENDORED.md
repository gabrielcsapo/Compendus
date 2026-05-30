# Vendored: soniqo/speech-swift — KokoroTTS

This directory vendors the **KokoroTTS** module (and the minimal subset of
**AudioCommon** it needs) from [soniqo/speech-swift](https://github.com/soniqo/speech-swift),
so Compendus can run on-device Kokoro-82M TTS via CoreML without an SPM/MLX dependency.

- **Source repo:** https://github.com/soniqo/speech-swift
- **Pinned commit:** `e8f459d9b3689fe324125eeaafcf2617799808a5`
- **License:** Apache-2.0 (see `LICENSE`)

## What was copied

- `KokoroTTS/` — all of `Sources/KokoroTTS/*` (Swift + `Resources/dict_*.json`).
- `AudioCommon/` — only the 4 files KokoroTTS references:
  `Protocols.swift`, `Logging.swift`, `AudioModelError.swift`, `CoreMLComputeUnits.swift`.

## Local modifications (keep when re-syncing)

1. `import AudioCommon` removed from the KokoroTTS sources — everything compiles in
   the single app target, so AudioCommon's types are already in scope.
2. `HuggingFaceDownloader.swift` was **not** copied. `KokoroTTSModel.fromPretrained(...)`
   was repointed to load the model from the app bundle (`KokoroModel/`) instead of
   downloading from HuggingFace — see `KokoroTTS.swift`.
3. `synthesizeWithTimings(...)` was **added** to expose the model's `pred_dur`
   per-token durations as word-level timestamps (the stock `synthesize()` discards them).

## Re-syncing upstream

Diff against the pinned commit, re-apply the 3 modifications above. The CoreML model
assets live separately under the app bundle's `KokoroModel/` (not in this folder).
