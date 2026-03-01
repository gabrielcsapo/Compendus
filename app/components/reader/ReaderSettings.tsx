"use client";

import type { ReaderSettings as ReaderSettingsType } from "@/lib/reader/settings";
import {
  THEMES,
  FONTS,
  COMIC_FIT_MODES,
  PLAYBACK_SPEEDS,
  SETTINGS_CONSTRAINTS,
  type ThemeName,
  type FontFamily,
  type ComicFitMode,
  type PdfPageLayout,
} from "@/lib/reader/settings";

interface ReaderSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ReaderSettingsType;
  onUpdateSetting: <K extends keyof ReaderSettingsType>(
    key: K,
    value: ReaderSettingsType[K],
  ) => void;
  theme: {
    background: string;
    foreground: string;
    muted: string;
    accent: string;
  };
}

export function ReaderSettings({
  isOpen,
  onClose,
  settings,
  onUpdateSetting,
  theme,
}: ReaderSettingsProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />

      {/* Settings panel */}
      <div
        className="fixed right-0 inset-y-0 w-80 z-50 flex flex-col shadow-xl overflow-auto"
        style={{ backgroundColor: theme.background }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: `${theme.foreground}20` }}
        >
          <h2 className="text-lg font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-black/10"
            aria-label="Close settings"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Settings content */}
        <div className="flex-1 p-4 space-y-6">
          {/* Theme */}
          <SettingSection title="Theme">
            <div className="grid grid-cols-4 gap-2">
              {(Object.keys(THEMES) as ThemeName[]).map((themeName) => (
                <button
                  key={themeName}
                  onClick={() => onUpdateSetting("theme", themeName)}
                  className="flex flex-col items-center gap-1 p-2 rounded-md border transition-colors"
                  style={{
                    borderColor:
                      settings.theme === themeName ? theme.accent : `${theme.foreground}20`,
                    backgroundColor:
                      settings.theme === themeName ? `${theme.accent}10` : "transparent",
                  }}
                >
                  <div
                    className="w-8 h-8 rounded-full border"
                    style={{
                      backgroundColor: THEMES[themeName].background,
                      borderColor: THEMES[themeName].foreground,
                    }}
                  />
                  <span className="text-xs capitalize">{themeName}</span>
                </button>
              ))}
            </div>
          </SettingSection>

          {/* Font */}
          <SettingSection title="Font">
            <div className="space-y-2">
              {(Object.keys(FONTS) as FontFamily[]).map((fontKey) => (
                <button
                  key={fontKey}
                  onClick={() => onUpdateSetting("fontFamily", fontKey)}
                  className="w-full text-left px-3 py-2 rounded-md border transition-colors"
                  style={{
                    fontFamily: FONTS[fontKey].value,
                    borderColor:
                      settings.fontFamily === fontKey ? theme.accent : `${theme.foreground}20`,
                    backgroundColor:
                      settings.fontFamily === fontKey ? `${theme.accent}10` : "transparent",
                  }}
                >
                  <div className="font-medium">{FONTS[fontKey].name}</div>
                  <div className="text-xs" style={{ color: theme.muted }}>
                    {FONTS[fontKey].description}
                  </div>
                </button>
              ))}
            </div>
          </SettingSection>

          {/* Font Size */}
          <SettingSection title={`Font Size: ${settings.fontSize}px`}>
            <input
              type="range"
              min={SETTINGS_CONSTRAINTS.fontSize.min}
              max={SETTINGS_CONSTRAINTS.fontSize.max}
              step={SETTINGS_CONSTRAINTS.fontSize.step}
              value={settings.fontSize}
              onChange={(e) => onUpdateSetting("fontSize", parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="flex justify-between text-xs" style={{ color: theme.muted }}>
              <span>{SETTINGS_CONSTRAINTS.fontSize.min}px</span>
              <span>{SETTINGS_CONSTRAINTS.fontSize.max}px</span>
            </div>
          </SettingSection>

          {/* Line Height */}
          <SettingSection title={`Line Height: ${settings.lineHeight}`}>
            <input
              type="range"
              min={SETTINGS_CONSTRAINTS.lineHeight.min}
              max={SETTINGS_CONSTRAINTS.lineHeight.max}
              step={SETTINGS_CONSTRAINTS.lineHeight.step}
              value={settings.lineHeight}
              onChange={(e) => onUpdateSetting("lineHeight", parseFloat(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-xs" style={{ color: theme.muted }}>
              <span>Tight</span>
              <span>Loose</span>
            </div>
          </SettingSection>

          {/* Max Width */}
          <SettingSection title={`Max Width: ${settings.maxWidth}px`}>
            <input
              type="range"
              min={SETTINGS_CONSTRAINTS.maxWidth.min}
              max={SETTINGS_CONSTRAINTS.maxWidth.max}
              step={SETTINGS_CONSTRAINTS.maxWidth.step}
              value={settings.maxWidth}
              onChange={(e) => onUpdateSetting("maxWidth", parseInt(e.target.value, 10))}
              className="w-full"
            />
            <div className="flex justify-between text-xs" style={{ color: theme.muted }}>
              <span>Narrow</span>
              <span>Wide</span>
            </div>
          </SettingSection>

          {/* Text Align */}
          <SettingSection title="Text Alignment">
            <div className="flex gap-2">
              <button
                onClick={() => onUpdateSetting("textAlign", "left")}
                className="flex-1 px-3 py-2 rounded-md border transition-colors"
                style={{
                  borderColor:
                    settings.textAlign === "left" ? theme.accent : `${theme.foreground}20`,
                  backgroundColor:
                    settings.textAlign === "left" ? `${theme.accent}10` : "transparent",
                }}
              >
                Left
              </button>
              <button
                onClick={() => onUpdateSetting("textAlign", "justify")}
                className="flex-1 px-3 py-2 rounded-md border transition-colors"
                style={{
                  borderColor:
                    settings.textAlign === "justify" ? theme.accent : `${theme.foreground}20`,
                  backgroundColor:
                    settings.textAlign === "justify" ? `${theme.accent}10` : "transparent",
                }}
              >
                Justify
              </button>
            </div>
          </SettingSection>

          {/* Publisher Styles */}
          <SettingSection title="Publisher Styles">
            <button
              onClick={() => onUpdateSetting("usePublisherStyles", !settings.usePublisherStyles)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-md border transition-colors"
              style={{
                borderColor: settings.usePublisherStyles ? theme.accent : `${theme.foreground}20`,
                backgroundColor: settings.usePublisherStyles ? `${theme.accent}10` : "transparent",
              }}
            >
              <div className="text-left">
                <div className="font-medium">Use EPUB Styles</div>
                <div className="text-xs" style={{ color: theme.muted }}>
                  Apply the book's own CSS formatting
                </div>
              </div>
              <div
                className="w-10 h-6 rounded-full relative transition-colors"
                style={{
                  backgroundColor: settings.usePublisherStyles ? theme.accent : `${theme.foreground}30`,
                }}
              >
                <div
                  className="w-4 h-4 rounded-full bg-white absolute top-1 transition-all"
                  style={{
                    left: settings.usePublisherStyles ? "22px" : "4px",
                  }}
                />
              </div>
            </button>
          </SettingSection>

          {/* Page Layout */}
          <SettingSection title="Page Layout">
            <div className="space-y-2">
              {(["single", "spread", "auto"] as PdfPageLayout[]).map((mode) => {
                const labels: Record<PdfPageLayout, { name: string; desc: string }> = {
                  single: { name: "Single Page", desc: "Show one page at a time" },
                  spread: { name: "Two-Page Spread", desc: "Show two pages side by side" },
                  auto: { name: "Auto", desc: "Single on mobile, spread on desktop" },
                };
                return (
                  <button
                    key={mode}
                    onClick={() => onUpdateSetting("pdfPageLayout", mode)}
                    className="w-full text-left px-3 py-2 rounded-md border transition-colors"
                    style={{
                      borderColor:
                        settings.pdfPageLayout === mode ? theme.accent : `${theme.foreground}20`,
                      backgroundColor:
                        settings.pdfPageLayout === mode ? `${theme.accent}10` : "transparent",
                    }}
                  >
                    <div className="font-medium">{labels[mode].name}</div>
                    <div className="text-xs" style={{ color: theme.muted }}>
                      {labels[mode].desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </SettingSection>

          {/* Comic Fit Mode */}
          <SettingSection title="Comic Fit Mode">
            <div className="space-y-2">
              {(Object.keys(COMIC_FIT_MODES) as ComicFitMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onUpdateSetting("comicFitMode", mode)}
                  className="w-full text-left px-3 py-2 rounded-md border transition-colors"
                  style={{
                    borderColor:
                      settings.comicFitMode === mode ? theme.accent : `${theme.foreground}20`,
                    backgroundColor:
                      settings.comicFitMode === mode ? `${theme.accent}10` : "transparent",
                  }}
                >
                  <div className="font-medium">{COMIC_FIT_MODES[mode].name}</div>
                  <div className="text-xs" style={{ color: theme.muted }}>
                    {COMIC_FIT_MODES[mode].description}
                  </div>
                </button>
              ))}
            </div>
          </SettingSection>

          {/* Manga Mode */}
          <SettingSection title="Reading Direction">
            <div className="flex gap-2">
              <button
                onClick={() => onUpdateSetting("comicRtl", false)}
                className="flex-1 px-3 py-2 rounded-md border transition-colors"
                style={{
                  borderColor: !settings.comicRtl ? theme.accent : `${theme.foreground}20`,
                  backgroundColor: !settings.comicRtl ? `${theme.accent}10` : "transparent",
                }}
              >
                Left to Right
              </button>
              <button
                onClick={() => onUpdateSetting("comicRtl", true)}
                className="flex-1 px-3 py-2 rounded-md border transition-colors"
                style={{
                  borderColor: settings.comicRtl ? theme.accent : `${theme.foreground}20`,
                  backgroundColor: settings.comicRtl ? `${theme.accent}10` : "transparent",
                }}
              >
                Right to Left
              </button>
            </div>
          </SettingSection>

          {/* Audio Playback Speed */}
          <SettingSection title="Audio Playback Speed">
            <div className="flex flex-wrap gap-2">
              {PLAYBACK_SPEEDS.map((speed) => (
                <button
                  key={speed}
                  onClick={() => onUpdateSetting("audioPlaybackSpeed", speed)}
                  className="px-3 py-1 rounded-md border transition-colors"
                  style={{
                    borderColor:
                      settings.audioPlaybackSpeed === speed
                        ? theme.accent
                        : `${theme.foreground}20`,
                    backgroundColor:
                      settings.audioPlaybackSpeed === speed ? `${theme.accent}10` : "transparent",
                  }}
                >
                  {speed}x
                </button>
              ))}
            </div>
          </SettingSection>
        </div>
      </div>
    </>
  );
}

function SettingSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-sm font-medium mb-2">{title}</h3>
      {children}
    </div>
  );
}
