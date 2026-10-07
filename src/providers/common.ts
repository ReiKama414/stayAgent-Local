import { StopError } from "./types";
import type { Page } from "playwright";
import type { ProviderRunContext } from "./types";
import type { Fact, Offer } from "@/lib/types";
import {
  bathtubEngine,
  detectAmenities,
  ev,
  parseBathroomCount,
  parseBedroomCount,
  parseBeds,
  parseCancellation,
  parseGuestCount,
  parseMeals,
  parseRoomLayouts,
  parseStations,
  parseTimes,
  parseToiletCount,
  parseTransit,
  resolveStation,
  sumBeds,
  type ParseCtx,
  type TextSource,
} from "@/lib/parsing/parsers";
import { clean } from "@/lib/parsing/text";

/** Page-level CAPTCHA / bot-check / access block detection. We never try to solve or bypass these. */
export async function detectBlock(page: Page): Promise<string | null> {
  try {
    const url = page.url();
    if (/captcha|challenge|px-captcha|\/sorry\/|blocked|verify/i.test(url) && !/verify_email/i.test(url)) return `verification page (${new URL(url).hostname})`;
    if (/\/account\/signin|\/login\?|\/signin\?|\/sign-in\?/i.test(url)) return `sign-in required (${new URL(url).hostname}) – sign in once in this browser profile`;
    const info = await page.evaluate(() => {
      // only challenges the user can actually see count (sites embed invisible reCAPTCHA/score scripts)
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const s = getComputedStyle(el as HTMLElement);
        return r.width > 60 && r.height > 40 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.1;
      };
      const t = (document.title || "").toLowerCase();
      const body = (document.body?.innerText || "").slice(0, 3000).toLowerCase();
      const frames = Array.from(document.querySelectorAll("iframe"))
        .filter(visible)
        .map((f) => f.getAttribute("src") || "")
        .filter((src) => !/recaptcha\/(api2|enterprise)\/(anchor|bframe)\?.*size=invisible/i.test(src));
      const sel = Array.from(
        document.querySelectorAll(
          "#px-captcha, .g-recaptcha, .h-captcha, #challenge-form, #cf-challenge-running, .cpt-drop-box, #captcha-container, awswaf-captcha, [id*='captcha' i]:not(script), .slider-verify, #slideVerify",
        ),
      ).some(visible);
      return { t, body, frames, sel };
    });
    if (info.sel) return "CAPTCHA element on page";
    if (info.frames.some((f) => /captcha|hcaptcha|recaptcha|challenges\.cloudflare|arkoselabs|funcaptcha|geetest/i.test(f))) return "CAPTCHA frame on page";
    const words = /are you a (robot|human)|verify (that )?you are (a )?human|press (&|and) hold|access denied|unusual traffic|security check|human verification|人機驗證|人机验证|請完成驗證|拖動滑塊|slide to verify|ロボットではありません|checking your browser/;
    if (words.test(info.t) || words.test(info.body.slice(0, 1500))) return "bot check / verification text on page";
    return null;
  } catch {
    return null;
  }
}

export async function safeGoto(page: Page, url: string) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  } catch (e) {
    // a slow page is still usable; rethrow only when nothing loaded
    if (page.url() === "about:blank") throw e;
  }
  await page.waitForLoadState("load", { timeout: 12000 }).catch(() => {});
}

/** Decline non-essential cookies when a consent banner shows (privacy-preserving choice). */
export async function declineCookies(page: Page) {
  const candidates = [
    "#onetrust-reject-all-handler",
    "button:has-text('Decline')",
    "button:has-text('Reject all')",
    "button:has-text('Only necessary')",
    "button:has-text('Only allow essential')",
    "button:has-text('Necessary cookies only')",
  ];
  for (const s of candidates) {
    const b = page.locator(s).first();
    if (await b.isVisible({ timeout: 300 }).catch(() => false)) {
      await b.click({ timeout: 2000 }).catch(() => {});
      return;
    }
  }
}

export async function dismissPopups(page: Page) {
  for (const s of [
    "[aria-label='Dismiss sign-in info.']",
    "button[aria-label*='Dismiss' i]",
    "[role='dialog'] button[aria-label='Close']",
    "[role='dialog'] button[aria-label='close']",
  ]) {
    const b = page.locator(s).first();
    if (await b.isVisible({ timeout: 200 }).catch(() => false)) await b.click({ timeout: 1500 }).catch(() => {});
  }
}

export async function textList(page: Page, selector: string, limit = 400): Promise<string[]> {
  try {
    return await page.$$eval(
      selector,
      (els, lim) => els.slice(0, lim as number).map((e) => (e as HTMLElement).innerText?.trim() || e.textContent?.trim() || "").filter(Boolean),
      limit,
    );
  } catch {
    return [];
  }
}

export async function firstText(page: Page, selectors: string[]): Promise<string | null> {
  for (const s of selectors) {
    const t = await page
      .locator(s)
      .first()
      .innerText({ timeout: 800 })
      .catch(() => null);
    if (t && t.trim()) return t.trim();
  }
  return null;
}

export async function jsonLd(page: Page): Promise<Record<string, unknown>[]> {
  try {
    const raw = await page.$$eval("script[type='application/ld+json']", (els) => els.map((e) => e.textContent || ""));
    const out: Record<string, unknown>[] = [];
    for (const r of raw) {
      try {
        const j = JSON.parse(r);
        const arr = Array.isArray(j) ? j : j["@graph"] ? j["@graph"] : [j];
        out.push(...arr);
      } catch {
        /* ignore malformed */
      }
    }
    return out;
  } catch {
    return [];
  }
}

export async function bodyText(page: Page, max = 60000): Promise<string> {
  try {
    return clean(await page.evaluate((m) => (document.body?.innerText || "").slice(0, m), max));
  } catch {
    return "";
  }
}

export async function scrollDown(ctx: ProviderRunContext, page: Page, steps: number) {
  for (let i = 0; i < steps; i++) {
    // scroll in-page: mouse.wheel waits for a rendered frame, which never comes in a background tab of a visible browser
    await Promise.race([page.evaluate(() => window.scrollBy(0, 1400)).catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    await ctx.sleep(700);
  }
}

export function parseCtx(offer: Offer, url?: string): ParseCtx {
  return { provider: offer.provider, url: url ?? offer.url, checkedAt: new Date().toISOString() };
}

/**
 * Shared detail-field extraction from labelled text sources. Providers collect sources from their own DOM;
 * the parsing rules are shared so all platforms obey the same evidence policy.
 */
export function applyDetailSources(offer: Offer, pc: ParseCtx, sources: TextSource[], opts: { bedSources?: TextSource[]; estimateWalk: boolean }) {
  const bedrooms = parseBedroomCount(pc, sources);
  if (bedrooms.value != null || offer.bedrooms.value == null) offer.bedrooms = mergeFact(offer.bedrooms, bedrooms);

  const bedSrc = opts.bedSources ?? sources;
  // first source that has a per-room layout wins (sources describe the same unit; never add them up)
  let rooms: ReturnType<typeof parseRoomLayouts> = [];
  for (const s of bedSrc) {
    rooms = parseRoomLayouts(s.text);
    if (rooms.length) break;
  }
  let bedList = rooms.length ? sumBeds(rooms.flatMap((r) => r.beds)) : [];
  let bedEvidence = rooms.length ? rooms.map((r) => ev(pc, "beds", bedSrc[0].source, `${r.name}: ${r.beds.map((b) => b.raw).join(", ")}`, "high")) : [];
  if (!bedList.length) {
    for (const s of bedSrc) {
      const b = parseBeds(s.text);
      if (b.length) {
        bedList = sumBeds(b);
        bedEvidence = [ev(pc, "beds", s.source, b.map((x) => x.raw).join(", "), "high")];
        break;
      }
    }
  }
  // Platform-stated total bed count ("5 beds") – typed beds must account for all of them
  let statedTotal: number | null = null;
  for (const s of sources) {
    const m = clean(s.text).match(/\b(\d+)\s+beds?\b(?!\s*room)/i);
    if (m && s.source !== "description") {
      statedTotal = Number(m[1]);
      break;
    }
  }
  if (bedList.length) {
    offer.rooms = rooms;
    const typed = bedList.reduce((n, b) => n + b.count, 0);
    if (statedTotal != null && typed < statedTotal) {
      // incomplete bed list: keep what is known, but the remainder is of unknown type → sleeping check stays UNKNOWN
      bedList = [...bedList, { type: "unknown", count: statedTotal - typed, raw: `${statedTotal - typed} bed(s) of unstated type` }];
      offer.beds = { value: bedList, confidence: "LIKELY", evidence: [...bedEvidence, ev(pc, "beds", "derived", `listing states ${statedTotal} beds, only ${typed} described by type`, "medium")], note: "bed list incomplete" };
    } else {
      offer.beds = { value: bedList, confidence: "VERIFIED", evidence: bedEvidence };
    }
  } else if (statedTotal != null && !offer.beds.value) {
    offer.beds = { value: [{ type: "unknown", count: statedTotal, raw: `${statedTotal} beds` }], confidence: "LIKELY", evidence: [ev(pc, "beds", "derived", `${statedTotal} beds, types not stated`, "medium")], note: "bed types unknown" };
  }

  // floor area stated by the platform for the unit ("46 m²", "98 ㎡", "430 ft²")
  for (const s of sources) {
    if (s.source === "description") continue;
    const t = clean(s.text);
    const m = t.match(/(\d{2,4}(?:\.\d)?)\s*(?:m²|m2|㎡|sq\.?\s?m\b|平方公尺|平米)/i) ?? null;
    const f = m ? null : t.match(/(\d{3,5})\s*(?:ft²|sq\.?\s?ft)/i);
    const v = m ? parseFloat(m[1]) : f ? Math.round(parseFloat(f[1]) * 0.0929) : null;
    if (v && v >= 8 && v <= 2000) {
      offer.areaM2 = { value: v, confidence: "VERIFIED", qualifier: "exact", evidence: [ev(pc, "areaM2", s.source, (m ?? f)![0], "high", `${v} m²`)] };
      break;
    }
  }

  const { bathrooms, toiletsFromHalf } = parseBathroomCount(pc, sources);
  if (bathrooms.value != null) offer.bathrooms = mergeFact(offer.bathrooms, bathrooms);
  offer.toilets = parseToiletCount(pc, sources, offer.bathrooms, toiletsFromHalf);
  offer.bathtubs = bathtubEngine(pc, sources, offer.bathrooms);

  const guests = parseGuestCount(pc, sources);
  if (guests.value != null) offer.maxGuests = guests;

  const am = detectAmenities(pc, sources);
  offer.amenities = { ...offer.amenities, ...am };
  offer.amenitiesParsed = true;

  const st = parseStations(sources);
  if (st.length) offer.station = resolveStation(pc, st, opts.estimateWalk);
  offer.transitHits = parseTransit(sources).map(({ target, minutes, mode, raw }) => ({ target, minutes, mode, raw }));

  const all = sources.map((s) => s.text);
  const canc = parseCancellation(all);
  offer.cancellation = {
    freeCancellation: canc.freeCancellation ?? offer.cancellation.freeCancellation,
    deadline: canc.deadline ?? offer.cancellation.deadline,
    payLater: canc.payLater ?? offer.cancellation.payLater,
    noPrepayment: canc.noPrepayment ?? offer.cancellation.noPrepayment,
    refundable: canc.refundable ?? offer.cancellation.refundable,
    text: canc.text ?? offer.cancellation.text,
  };
  const meals = parseMeals(all);
  offer.breakfast = meals.breakfast ?? offer.breakfast;
  offer.dinner = meals.dinner ?? offer.dinner;
  const times = parseTimes(all);
  offer.checkInTime = times.checkIn ?? offer.checkInTime;
  offer.checkOutTime = times.checkOut ?? offer.checkOutTime;
}

/** Detail-page facts win over search-card facts; evidence is kept from both. */
export function mergeFact<T>(prev: Fact<T>, next: Fact<T>): Fact<T> {
  if (next.value == null) return prev.value == null ? next : prev;
  if (prev.value == null) return next;
  const same = JSON.stringify(prev.value) === JSON.stringify(next.value);
  return {
    ...next,
    evidence: [...next.evidence, ...prev.evidence].slice(0, 10),
    confidence: same ? (next.confidence === "UNKNOWN" ? prev.confidence : next.confidence === "LIKELY" && prev.confidence !== "UNKNOWN" ? "VERIFIED" : next.confidence) : next.confidence,
    note: same ? next.note : `${next.note ? next.note + "; " : ""}search card said ${JSON.stringify(prev.value)}`,
  };
}

export function entireFromText(text: string): boolean | null {
  const t = text.toLowerCase();
  if (/\bentire (home|place|apartment|house|villa|condo|rental unit|townhouse|guesthouse|cottage|loft|serviced apartment|vacation home)|whole (house|apartment)|一棟貸切|一棟貸し|貸切|整套|整間|獨棟/.test(t)) return true;
  if (/\bprivate room\b|\bshared room\b|room in |dormitory|dorm bed|bed in dormitory|個室|雅房|合租/.test(t)) return false;
  return null;
}

export function propertyTypeFromText(text: string): string | null {
  const map: [RegExp, string][] = [
    [/machiya|町家|町屋/i, "Machiya"],
    [/ryokan|旅館/i, "Ryokan"],
    [/serviced apartment|aparthotel|apart-hotel|apartment hotel/i, "Serviced Apartment"],
    [/townhouse|town house|terrace house/i, "Townhouse"],
    [/vacation home|holiday home|vacation rental/i, "Vacation Home"],
    [/villa/i, "Villa"],
    [/hostel/i, "Hostel"],
    [/minshuku|民宿/i, "Minshuku"],
    [/homestay|民泊/i, "Homestay"],
    [/guest ?house|ゲストハウス/i, "Guesthouse"],
    [/resort/i, "Resort"],
    [/entire home|entire house|entire villa|whole house|一棟|獨棟/i, "Entire House"],
    [/apartment|condo|rental unit|\bflat\b(?![-\s]?screen)|公寓|アパート|マンション/i, "Apartment"],
    [/hotel|飯店|酒店|ホテル/i, "Hotel"],
  ];
  for (const [re, t] of map) if (re.test(text)) return t;
  return null;
}

/** First type found, in the given order of reliability (e.g. property name, then room text, then description). */
export function detectPropertyType(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const v = t ? propertyTypeFromText(t) : null;
    if (v) return v;
  }
  return null;
}

/** keyboard input with a time limit (input events can wait for a frame in background tabs) */
export async function pressKey(page: Page, key: string) {
  await Promise.race([page.keyboard.press(key).catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
}

/** Run a result-list paging loop; when the user presses Stop, keep the cards collected so far instead of discarding them. */
export async function keepOnStop(loop: () => Promise<void>): Promise<void> {
  try {
    await loop();
  } catch (e) {
    if (!(e instanceof StopError)) throw e;
  }
}
