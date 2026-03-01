// Reader theme definitions
export const THEMES = {
  light: {
    background: "#ffffff",
    foreground: "#0f172a",
    muted: "#64748b",
    accent: "#4f46e5",
    selection: "#c7d2fe",
  },
  dark: {
    background: "#1a2332",
    foreground: "#f1f5f9",
    muted: "#94a3b8",
    accent: "#818cf8",
    selection: "#4338ca",
  },
  sepia: {
    background: "#f4ecd8",
    foreground: "#5c4b37",
    muted: "#8b7355",
    accent: "#8b5e3c",
    selection: "#d4c4a8",
  },
  night: {
    background: "#0a0a0a",
    foreground: "#a0a0a0",
    muted: "#606060",
    accent: "#6366f1",
    selection: "#312e81",
  },
} as const;

export type ThemeName = keyof typeof THEMES;

// Reader font definitions
export const FONTS = {
  serif: {
    name: "Serif",
    value: '"Merriweather", "Georgia", "Times New Roman", serif',
    description: "Classic book typography",
  },
  literata: {
    name: "Literata",
    value: '"Literata", "Georgia", serif',
    description: "Designed for ebooks",
  },
  sansSerif: {
    name: "Sans Serif",
    value: '"Inter", system-ui, -apple-system, sans-serif',
    description: "Clean modern appearance",
  },
  sourceSans: {
    name: "Source Sans",
    value: '"Source Sans 3", "Helvetica Neue", sans-serif',
    description: "Readable sans-serif",
  },
  mono: {
    name: "Monospace",
    value: '"JetBrains Mono", "Fira Code", monospace',
    description: "Fixed-width for code",
  },
  ibmPlex: {
    name: "IBM Plex Mono",
    value: '"IBM Plex Mono", monospace',
    description: "Clean fixed-width",
  },
  dyslexic: {
    name: "OpenDyslexic",
    value: '"OpenDyslexic", sans-serif',
    description: "Designed for readers with dyslexia",
  },
} as const;

export type FontFamily = keyof typeof FONTS;

// Comic fit modes
export const COMIC_FIT_MODES = {
  contain: {
    name: "Fit Page",
    description: "Show entire page within viewport",
  },
  width: {
    name: "Fit Width",
    description: "Fill viewport width, scroll vertically",
  },
  height: {
    name: "Fit Height",
    description: "Fill viewport height, scroll horizontally",
  },
} as const;

// PDF page layout modes
const PDF_PAGE_LAYOUTS = {
  single: {
    name: "Single Page",
    description: "Show one page at a time",
  },
  spread: {
    name: "Two-Page Spread",
    description: "Show two pages side by side like an open book",
  },
  auto: {
    name: "Auto",
    description: "Single on mobile, spread on desktop",
  },
} as const;

export type PdfPageLayout = keyof typeof PDF_PAGE_LAYOUTS;

export type ComicFitMode = keyof typeof COMIC_FIT_MODES;

// Audio playback speeds
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

// Reader settings interface
export interface ReaderSettings {
  // Typography
  fontFamily: FontFamily;
  fontSize: number; // 12-32
  lineHeight: number; // 1.2-2.5
  textAlign: "left" | "justify";

  // Layout
  margins: number; // 0-100 (percentage)
  maxWidth: number; // 400-1200px

  // Theme
  theme: ThemeName;

  // PDF-specific
  pdfScale: number; // 0.5-3.0
  pdfPageLayout: PdfPageLayout;

  // Comic-specific
  comicFitMode: ComicFitMode;
  comicRtl: boolean; // Right-to-left (manga mode)

  // Audio-specific
  audioPlaybackSpeed: PlaybackSpeed;
  audioVolume: number; // 0-1

  // EPUB-specific
  usePublisherStyles: boolean; // Apply EPUB's own CSS stylesheets

  // Per-book highlight colors (overrides default palette when set)
  customHighlightColors?: string[];
}

// Default settings
export const DEFAULT_SETTINGS: ReaderSettings = {
  fontFamily: "serif",
  fontSize: 18,
  lineHeight: 1.6,
  textAlign: "justify",
  margins: 10,
  maxWidth: 700,
  theme: "light",
  pdfScale: 1.0,
  pdfPageLayout: "auto",
  comicFitMode: "contain",
  comicRtl: false,
  audioPlaybackSpeed: 1,
  audioVolume: 1,
  usePublisherStyles: true,
};

// Settings constraints
export const SETTINGS_CONSTRAINTS = {
  fontSize: { min: 12, max: 32, step: 1 },
  lineHeight: { min: 1.2, max: 2.5, step: 0.1 },
  margins: { min: 0, max: 30, step: 5 },
  maxWidth: { min: 400, max: 1200, step: 50 },
  pdfScale: { min: 0.5, max: 3.0, step: 0.25 },
} as const;

// Validate and clamp settings values
export function validateSettings(settings: Partial<ReaderSettings>): ReaderSettings {
  const validated = { ...DEFAULT_SETTINGS };

  if (settings.fontFamily && settings.fontFamily in FONTS) {
    validated.fontFamily = settings.fontFamily;
  }

  if (settings.fontSize !== undefined) {
    validated.fontSize = Math.max(
      SETTINGS_CONSTRAINTS.fontSize.min,
      Math.min(SETTINGS_CONSTRAINTS.fontSize.max, settings.fontSize),
    );
  }

  if (settings.lineHeight !== undefined) {
    validated.lineHeight = Math.max(
      SETTINGS_CONSTRAINTS.lineHeight.min,
      Math.min(SETTINGS_CONSTRAINTS.lineHeight.max, settings.lineHeight),
    );
  }

  if (settings.textAlign === "left" || settings.textAlign === "justify") {
    validated.textAlign = settings.textAlign;
  }

  if (settings.margins !== undefined) {
    validated.margins = Math.max(
      SETTINGS_CONSTRAINTS.margins.min,
      Math.min(SETTINGS_CONSTRAINTS.margins.max, settings.margins),
    );
  }

  if (settings.maxWidth !== undefined) {
    validated.maxWidth = Math.max(
      SETTINGS_CONSTRAINTS.maxWidth.min,
      Math.min(SETTINGS_CONSTRAINTS.maxWidth.max, settings.maxWidth),
    );
  }

  if (settings.theme && settings.theme in THEMES) {
    validated.theme = settings.theme;
  }

  if (settings.pdfScale !== undefined) {
    validated.pdfScale = Math.max(
      SETTINGS_CONSTRAINTS.pdfScale.min,
      Math.min(SETTINGS_CONSTRAINTS.pdfScale.max, settings.pdfScale),
    );
  }

  if (settings.pdfPageLayout && settings.pdfPageLayout in PDF_PAGE_LAYOUTS) {
    validated.pdfPageLayout = settings.pdfPageLayout;
  }

  if (settings.comicFitMode && settings.comicFitMode in COMIC_FIT_MODES) {
    validated.comicFitMode = settings.comicFitMode;
  }

  if (settings.comicRtl !== undefined) {
    validated.comicRtl = Boolean(settings.comicRtl);
  }

  if (settings.audioPlaybackSpeed !== undefined) {
    const speed = PLAYBACK_SPEEDS.find((s) => s === settings.audioPlaybackSpeed);
    if (speed) {
      validated.audioPlaybackSpeed = speed;
    }
  }

  if (settings.audioVolume !== undefined) {
    validated.audioVolume = Math.max(0, Math.min(1, settings.audioVolume));
  }

  if (settings.usePublisherStyles !== undefined) {
    validated.usePublisherStyles = Boolean(settings.usePublisherStyles);
  }

  return validated;
}
