import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { webShowcaseScenes } from "../../showcase/scenes.js";
import { seedShowcase, SHOWCASE_PROFILE_ID, SHOWCASE_ROOT } from "./seed.js";
import { buildShowcaseApp, startShowcaseServer } from "./runtime.js";

const mastersDir = resolve(SHOWCASE_ROOT, "masters/web");
const publicDir = resolve(process.cwd(), "docs/public");

async function captureWebShowcase() {
  await seedShowcase();
  buildShowcaseApp();
  mkdirSync(mastersDir, { recursive: true });

  const server = await startShowcaseServer();
  const browser = await chromium.launch();

  try {
    for (const scene of webShowcaseScenes) {
      const context = await browser.newContext({
        viewport: scene.viewport,
        deviceScaleFactor: 2,
        colorScheme: scene.theme,
        reducedMotion: "reduce",
      });
      await context.addCookies([
        {
          name: "compendus-profile",
          value: SHOWCASE_PROFILE_ID,
          url: server.url,
        },
      ]);
      await context.addInitScript((theme) => {
        localStorage.setItem("theme", theme);
        localStorage.setItem("compendus-reader-settings", JSON.stringify({ theme: "paper" }));
      }, scene.theme);

      const page = await context.newPage();
      await page.goto(`${server.url}${scene.route}`, { waitUntil: "domcontentloaded" });
      await page.getByText(scene.waitFor, { exact: false }).first().waitFor({
        state: "visible",
        timeout: 35_000,
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
        const images = Array.from(document.images);
        await Promise.all(
          images.map((image) =>
            image.complete
              ? Promise.resolve()
              : new Promise<void>((resolveImage) => {
                  image.addEventListener("load", () => resolveImage(), { once: true });
                  image.addEventListener("error", () => resolveImage(), { once: true });
                }),
          ),
        );
      });
      await page.waitForTimeout(scene.id === "web-reader" ? 2_500 : 700);

      const master = resolve(mastersDir, `${scene.id}.png`);
      await page.screenshot({ path: master, fullPage: false });
      const optimized = resolve(publicDir, scene.image.replace(/^\//, ""));
      mkdirSync(dirname(optimized), { recursive: true });
      await sharp(master).webp({ quality: 88, smartSubsample: true }).toFile(optimized);
      console.log(`Captured ${scene.id}`);
      await context.close();
    }
  } finally {
    await browser.close();
    server.stop();
  }
}

await captureWebShowcase();
