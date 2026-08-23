export type ShowcaseTheme = "light" | "dark";

export interface WebShowcaseScene {
  id: string;
  platform: "web";
  eyebrow: string;
  title: string;
  description: string;
  route: string;
  image: string;
  theme: ShowcaseTheme;
  viewport: { width: number; height: number };
  frame: "browser" | "mobile-browser";
  waitFor: string;
}

export interface IOSShowcaseScene {
  id: string;
  platform: "ios";
  eyebrow: string;
  title: string;
  description: string;
  image: string;
  theme: ShowcaseTheme;
  frame: "iphone" | "ipad";
  device: "iphone" | "ipad";
  tab: number;
  filter: "all" | "ebooks" | "audiobooks" | "comics";
}

export type ShowcaseScene = WebShowcaseScene | IOSShowcaseScene;

export const webShowcaseScenes: WebShowcaseScene[] = [
  {
    id: "web-library",
    platform: "web",
    eyebrow: "The shelf",
    title: "Every format has a physical presence.",
    description:
      "A quiet overview keeps the collection legible while books, discs, and printed issues retain their own character.",
    route: "/library",
    image: "/showcase/web/library.webp",
    theme: "light",
    viewport: { width: 1440, height: 960 },
    frame: "browser",
    waitFor: "Your library.",
  },
  {
    id: "web-detail",
    platform: "web",
    eyebrow: "The edition",
    title: "Everything useful, arranged around the book.",
    description:
      "Progress, editions, collections, tags, and reading actions support the work without turning its page into a dashboard.",
    route: "/book/showcase-gatsby",
    image: "/showcase/web/book-detail.webp",
    theme: "light",
    viewport: { width: 1440, height: 960 },
    frame: "browser",
    waitFor: "The Great Gatsby",
  },
  {
    id: "web-reader",
    platform: "web",
    eyebrow: "The reader",
    title: "The interface steps back when the book opens.",
    description:
      "Typography, measure, themes, navigation, highlights, and read-aloud controls are present when needed and quiet when they are not.",
    route: "/book/showcase-gatsby/read",
    image: "/showcase/web/reader.webp",
    theme: "light",
    viewport: { width: 1440, height: 960 },
    frame: "browser",
    waitFor: "The Great Gatsby",
  },
  {
    id: "web-audio",
    platform: "web",
    eyebrow: "Listening",
    title: "An audiobook remains part of the same library.",
    description:
      "Chapters, speed, sleep controls, progress, and transcripts live in a focused listening surface instead of a separate product.",
    route: "/book/showcase-project-hail-mary/read",
    image: "/showcase/web/audiobook.webp",
    theme: "dark",
    viewport: { width: 1440, height: 960 },
    frame: "browser",
    waitFor: "Project Hail Mary",
  },
  {
    id: "web-library-mobile",
    platform: "web",
    eyebrow: "Anywhere",
    title: "The reading room travels lightly.",
    description:
      "The same hierarchy and collection remain comfortable on a narrow screen without becoming a reduced version of the desktop app.",
    route: "/library",
    image: "/showcase/web/library-mobile.webp",
    theme: "dark",
    viewport: { width: 430, height: 932 },
    frame: "mobile-browser",
    waitFor: "Your library.",
  },
];

export const iosShowcaseScenes: IOSShowcaseScene[] = [
  {
    id: "ios-library",
    platform: "ios",
    eyebrow: "Native library",
    title: "The same shelf, shaped for touch.",
    description:
      "The iPhone library keeps the web experience’s calm hierarchy while using native navigation, materials, and gestures.",
    image: "/showcase/ios/library-light.webp",
    theme: "light",
    frame: "iphone",
    device: "iphone",
    tab: 1,
    filter: "all",
  },
  {
    id: "ios-audio",
    platform: "ios",
    eyebrow: "In your headphones",
    title: "Listening is one tap away.",
    description:
      "Audiobooks retain their duration and format cues, with the full player ready without leaving the library’s visual language.",
    image: "/showcase/ios/library-audio-dark.webp",
    theme: "dark",
    frame: "iphone",
    device: "iphone",
    tab: 1,
    filter: "audiobooks",
  },
  {
    id: "ipad-library",
    platform: "ios",
    eyebrow: "A larger page",
    title: "The library breathes on iPad.",
    description:
      "More room reveals more of the collection without inflating controls or losing the deliberate reading rhythm.",
    image: "/showcase/ios/library-ipad.webp",
    theme: "light",
    frame: "ipad",
    device: "ipad",
    tab: 1,
    filter: "all",
  },
];

export const showcaseScenes: ShowcaseScene[] = [...webShowcaseScenes, ...iosShowcaseScenes];
