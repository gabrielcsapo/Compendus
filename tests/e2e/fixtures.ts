import { test as base, expect } from "@playwright/test";
import { ADMIN_PROFILE, E2E_BASE_URL } from "./constants.js";

/**
 * The base `test`, extended so every browser context arrives already
 * "authenticated" as the seeded admin profile. RSC server actions read the
 * `compendus-profile` cookie (app/lib/profile.ts) to resolve the profile, so
 * setting it context-wide gives every page admin access + per-profile state.
 */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addCookies([
      { name: "compendus-profile", value: ADMIN_PROFILE.id, url: E2E_BASE_URL },
    ]);
    await use(context);
  },
});

export { expect };
