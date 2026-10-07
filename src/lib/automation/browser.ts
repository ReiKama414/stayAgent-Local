import path from "node:path";
import fs from "node:fs";
import type { BrowserContext, Page } from "playwright";

export const PROFILE_DIR = path.join(process.cwd(), "browser-profile");

const g = globalThis as unknown as { __stayBrowser?: { ctx: BrowserContext; headless: boolean } | null; __stayLaunching?: Promise<BrowserContext> | null; __stayChannel?: string };

/** Persistent Chromium profile: logins/cookies stay in ./browser-profile on this machine only. */
export async function getContext(headless: boolean): Promise<BrowserContext> {
  const cur = g.__stayBrowser;
  if (cur && cur.headless === headless) {
    try {
      cur.ctx.pages();
      return cur.ctx;
    } catch {
      g.__stayBrowser = null;
    }
  }
  if (g.__stayLaunching) return g.__stayLaunching;
  if (cur) {
    await cur.ctx.close().catch(() => {});
    g.__stayBrowser = null;
  }
  g.__stayLaunching = (async () => {
    const { chromium } = await import("playwright");
    fs.mkdirSync(PROFILE_DIR, { recursive: true });
    const opts = {
      headless,
      viewport: { width: 1360, height: 860 },
      locale: "en-US",
      timezoneId: "Asia/Taipei",
      args: ["--window-size=1380,980"],
    };
    // Playwright Chromium first; fall back to installed Chrome / Edge (also Chromium) when the bundled build cannot start.
    let ctx: BrowserContext | null = null;
    let lastErr: unknown;
    const channels = [...new Set([process.env.BROWSER_CHANNEL || undefined, undefined, "chrome", "msedge"])];
    for (const channel of channels) {
      try {
        ctx = await chromium.launchPersistentContext(PROFILE_DIR, { ...opts, ...(channel ? { channel } : {}) });
        g.__stayChannel = channel ?? "chromium";
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!ctx) throw lastErr;
    // esbuild/tsx keepNames helper referenced by functions serialized into page.evaluate
    await ctx.addInitScript("globalThis.__name = globalThis.__name || ((f) => f);");
    ctx.setDefaultTimeout(15000);
    ctx.setDefaultNavigationTimeout(45000);
    ctx.on("close", () => {
      if (g.__stayBrowser?.ctx === ctx) g.__stayBrowser = null;
    });
    g.__stayBrowser = { ctx, headless };
    return ctx;
  })();
  try {
    return await g.__stayLaunching;
  } finally {
    g.__stayLaunching = null;
  }
}

/**
 * Job tabs are opened next to the context's first tab, which is never closed:
 * Chrome shuts the whole persistent context down when its last tab closes.
 */
export async function newPage(headless: boolean): Promise<Page> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctx = await getContext(headless);
    try {
      if (!ctx.pages().length) await ctx.newPage(); // keeper tab
      return await ctx.newPage();
    } catch (e) {
      // context died (e.g. user closed the window): drop it and relaunch once
      if (g.__stayBrowser?.ctx === ctx) g.__stayBrowser = null;
      await ctx.close().catch(() => {});
      if (attempt === 1) throw e;
    }
  }
  throw new Error("unreachable");
}

export async function closeBrowser() {
  const cur = g.__stayBrowser;
  g.__stayBrowser = null;
  if (cur) await cur.ctx.close().catch(() => {});
}

export function browserOpen() {
  return !!g.__stayBrowser;
}

export function browserChannel() {
  return g.__stayChannel ?? null;
}

const LOGIN_URLS = ["https://www.booking.com/", "https://www.agoda.com/", "https://www.airbnb.com/", "https://www.trip.com/"];

/** Opens the four sites in the persistent profile so the user can sign in manually. */
export async function openLoginTabs() {
  const ctx = await getContext(false);
  for (const url of LOGIN_URLS) {
    const p = await ctx.newPage();
    p.goto(url, { waitUntil: "domcontentloaded" }).catch(() => {});
  }
}
