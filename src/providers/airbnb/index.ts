import type { Page } from "playwright";
import type { AccommodationProvider } from "../types";
import type { Criteria, Offer } from "@/lib/types";
import { destinationQuery, findDestination } from "@/lib/destinations";
import { buildPrice, createOffer } from "@/lib/engine/offer";
import { ev, parseCancellation, parseRating, type TextSource } from "@/lib/parsing/parsers";
import { clean, parseMoney, type Money } from "@/lib/parsing/text";
import { applyDetailSources, declineCookies, entireFromText, jsonLd, parseCtx, propertyTypeFromText, detectPropertyType, safeGoto, scrollDown, textList, pressKey, keepOnStop } from "../common";

const ORIGIN = "https://www.airbnb.com";

function detailParams(c: Criteria) {
  const p = new URLSearchParams({ check_in: c.checkIn, check_out: c.checkOut, adults: String(c.adults), currency: c.currency, locale: "en" });
  if (c.children) p.set("children", String(c.children));
  return p;
}

const section = (id: string) => `[data-section-id='${id}']`;

async function closeModals(page: Page) {
  for (let i = 0; i < 3; i++) {
    const modal = page.locator("[data-testid='modal-container']").first();
    if (!(await modal.isVisible({ timeout: 400 }).catch(() => false))) return;
    const close = modal.locator("button[aria-label='Close'], button[aria-label='close'], button:has-text('Got it'), button:has-text('OK')").first();
    if (await close.isVisible({ timeout: 300 }).catch(() => false)) await close.click({ timeout: 1500 }).catch(() => {});
    else await pressKey(page, "Escape");
    await page.waitForTimeout(400);
  }
}

/** "$27,231 TWD for 4 nights" – the amount right before "for N nights" */
function totalForNights(text: string, nights: number, fallback: string): Money | null {
  const t = clean(text).replace(/\n/g, " ");
  const m = t.match(new RegExp(`((?:NT\\$|\\$|¥|TWD|JPY)\\s*[\\d,]+(?:\\s*(?:TWD|JPY|USD))?)\\s*(?:total\\s*)?for\\s+${nights}\\s+nights?`, "i"));
  return m ? parseMoney(m[1], fallback) : null;
}

const g = globalThis as unknown as { __airbnbBook?: WeakMap<Offer, { bookit: string; breakdown: string }> };
const bookMap = (g.__airbnbBook ??= new WeakMap());

export const AirbnbProvider: AccommodationProvider = {
  id: "airbnb",
  label: "Airbnb",

  async search(ctx, page) {
    const c = ctx.criteria;
    ctx.stage("Opening Airbnb");
    await safeGoto(page, `${ORIGIN}/?currency=${c.currency}&locale=en`);
    await ctx.checkpoint(page, "home");
    await declineCookies(page);
    await closeModals(page);
    const box = page.locator("input[name='query'], [data-testid='structured-search-input-field-query']").first();
    if (await box.isVisible({ timeout: 4000 }).catch(() => false)) {
      ctx.stage(`Typing destination "${destinationQuery(c.destination)}"`);
      await box.click().catch(() => {});
      await box.pressSequentially(destinationQuery(c.destination), { delay: 80 }).catch(() => {});
      await ctx.sleep(1200);
      await pressKey(page, "Escape");
    }
    const p = new URLSearchParams({ checkin: c.checkIn, checkout: c.checkOut, adults: String(c.adults), currency: c.currency, locale: "en" });
    if (c.children) p.set("children", String(c.children));
    if (c.bedrooms.level === "REQUIRED" && (c.bedrooms.exact ?? c.bedrooms.min)) p.set("min_bedrooms", String(c.bedrooms.exact ?? c.bedrooms.min));
    if (c.bathrooms.level === "REQUIRED" && (c.bathrooms.exact ?? c.bathrooms.min)) p.set("min_bathrooms", String(c.bathrooms.exact ?? c.bathrooms.min));
    if (c.placeType.entireOnly && c.placeType.level !== "IGNORE") p.append("room_types[]", "Entire home/apt");
    if (c.laundry.washer === "REQUIRED") p.append("amenities[]", "33");
    // Airbnb's price filter is the whole-trip price incl. fees: widen 10% so fee rounding never excludes a candidate
    if (c.budget.level === "REQUIRED" && c.currency === "TWD" && (c.budget.min != null || c.budget.max != null)) {
      const nights = Math.round((Date.parse(c.checkOut) - Date.parse(c.checkIn)) / 86400000);
      const guests = c.adults + c.children;
      const total = (v: number) => (c.budget.basis === "total" ? v : c.budget.basis === "night" ? v * nights : (v * guests));
      if (c.budget.min != null) p.set("price_min", String(Math.floor(total(c.budget.min) * 0.9)));
      if (c.budget.max != null) p.set("price_max", String(Math.ceil(total(c.budget.max) * 1.1)));
      p.set("price_filter_input_type", "2");
      p.set("price_filter_num_nights", String(nights));
    }
    ctx.stage(`Searching ${c.checkIn} → ${c.checkOut}, ${c.adults} guests`);
    ctx.log(`Airbnb search: ${p.toString().replace(/&/g, " ")}`);
    await safeGoto(page, `${ORIGIN}/s/${encodeURIComponent(destinationQuery(c.destination))}/homes?${p.toString()}`);
    await ctx.checkpoint(page, "results");
    await closeModals(page);
    await page.waitForSelector("[itemprop='itemListElement']", { timeout: 20000 }).catch(() => {});
    await ctx.checkpoint(page, "results");
  },

  async parseSearchResults(ctx, page, max) {
    const c = ctx.criteria;
    const nights = Math.round((Date.parse(c.checkOut) - Date.parse(c.checkIn)) / 86400000);
    const all = new Map<string, Offer>();
    await keepOnStop(async () => {
      for (let pageNo = 0; pageNo < 15 && all.size < max; pageNo++) {
        await scrollDown(ctx, page, 3);
        await ctx.checkpoint(page, "results");
        const cards = await page.$$eval("[itemprop='itemListElement']", (els) =>
          els.map((e) => ({
            name: e.querySelector("meta[itemprop='name']")?.getAttribute("content") || "",
            url: e.querySelector("meta[itemprop='url']")?.getAttribute("content") || "",
            title: ((e.querySelector("[data-testid='listing-card-title']") as HTMLElement | null)?.innerText || "").trim(),
            subtitles: Array.from(e.querySelectorAll("[data-testid='listing-card-subtitle']")).map((s) => (s as HTMLElement).innerText.replace(/\n/g, " ")),
            price: ((e.querySelector("[data-testid='price-availability-row']") as HTMLElement | null)?.innerText || "").trim(),
            text: (e as HTMLElement).innerText,
          })),
        );
        for (const card of cards) {
          const id = card.url.match(/\/rooms\/(\d+)/)?.[1];
          if (!id || all.has(id)) continue;
          const o = createOffer("airbnb", id, `${ORIGIN}/rooms/${id}?${detailParams(c).toString()}`, card.name || card.title, c);
          const pc = parseCtx(o, page.url());
          const text = clean(card.text);
          const rm = text.match(/([\d.]+) out of 5 average rating,\s*([\d,]+) reviews?/i);
          if (rm) {
            const r = parseRating(rm[1], 5);
            if (r) o.rating = { value: r, confidence: "VERIFIED", evidence: [ev(pc, "rating", "search_card", rm[0], "high", `${r.raw}/5`)] };
            o.reviewCount = { value: Number(rm[2].replace(/,/g, "")), confidence: "VERIFIED", evidence: [ev(pc, "reviewCount", "search_card", rm[0], "high")] };
          } else if (/\bNew\b/.test(text)) {
            o.reviewCount = { value: 0, confidence: "LIKELY", evidence: [ev(pc, "reviewCount", "search_card", "New listing", "medium")] };
          }
          const sub = [...new Set(card.subtitles)].join(" · ");
          const tmp = { ...o };
          applyDetailSources(tmp, pc, [{ source: "search_card", text: sub }], { estimateWalk: false });
          o.bedrooms = tmp.bedrooms;
          o.bathrooms = tmp.bathrooms;
          if (tmp.beds.value) o.beds = { ...tmp.beds, confidence: "LIKELY" };
          o.entirePlace = entireFromText(card.title) != null ? { value: entireFromText(card.title), confidence: "LIKELY", evidence: [ev(pc, "entirePlace", "search_card", card.title, "medium")] } : o.entirePlace;
          o.propertyType = propertyTypeFromText(`${card.title} ${o.name}`);
          if (/guest favorite/i.test(text)) o.trustSignals.push({ label: "Airbnb Guest Favorite", weight: 2 });
          const total = totalForNights(card.price, nights, c.currency);
          if (total) {
            o.price = buildPrice({ total, includesTaxes: null, fromDetail: false, evidence: [ev(pc, "price", "search_card", card.price.replace(/\n/g, " "), "medium")] }, c, pc.checkedAt);
            o.availability = { value: "AVAILABLE", confidence: "LIKELY", evidence: [ev(pc, "availability", "search_card", card.price.replace(/\n/g, " "), "medium", "price shown for requested dates (search page)")] };
          }
          o.cancellation = parseCancellation([text]);
          all.set(id, o);
          if (all.size >= max) break;
        }
        if (all.size >= max) break;
        const next = page.locator("a[aria-label='Next']").first();
        if (!(await next.isVisible({ timeout: 1500 }).catch(() => false))) break;
        ctx.stage(`Next results page (${all.size} so far)`);
        await next.click().catch(() => {});
        await ctx.sleep(3000);
      }
    });
    return [...all.values()];
  },

  async openProperty(ctx, page, offer) {
    ctx.stage(`Opening ${offer.name}`);
    await safeGoto(page, offer.url);
    await ctx.checkpoint(page, "property");
    await page.waitForSelector(`${section("OVERVIEW_DEFAULT_V2")}, ${section("BOOK_IT_SIDEBAR")}, ${section("TITLE_DEFAULT")}`, { timeout: 20000 }).catch(() => {});
    await closeModals(page);
    await ctx.checkpoint(page, "property");
  },

  async parsePropertyDetails(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    let ldDesc = "";
    for (const j of await jsonLd(page)) {
      if (String(j?.["@type"]) !== "VacationRental") continue;
      if (j.name) offer.name = String(j.name);
      ldDesc = String(j.description ?? "");
      if (j.latitude) (offer.latitude = Number(j.latitude)), (offer.longitude = Number(j.longitude));
      const addr = j.address as Record<string, string> | undefined;
      if (addr?.addressLocality) offer.address = addr.addressLocality;
      const ar = j.aggregateRating as Record<string, string | number> | undefined;
      if (ar?.ratingValue) {
        const r = parseRating(String(ar.ratingValue), 5);
        if (r) offer.rating = { value: r, confidence: "VERIFIED", evidence: [ev(pc, "rating", "structured_data", `JSON-LD ratingValue ${ar.ratingValue}/5`, "high")] };
        if (ar.ratingCount) offer.reviewCount = { value: Number(ar.ratingCount), confidence: "VERIFIED", evidence: [ev(pc, "reviewCount", "structured_data", `JSON-LD ratingCount ${ar.ratingCount}`, "high")] };
      }
      const occ = (j.containsPlace as { occupancy?: { value?: number } } | undefined)?.occupancy?.value;
      if (occ) offer.maxGuests = { value: Number(occ), confidence: "VERIFIED", qualifier: "exact", evidence: [ev(pc, "maxGuests", "structured_data", `JSON-LD occupancy ${occ}`, "high")] };
    }
    await scrollDown(ctx, page, 4);
    await closeModals(page);
    const sec = async (id: string) => clean(await page.locator(section(id)).first().innerText({ timeout: 1500 }).catch(() => ""));
    const overview = await sec("OVERVIEW_DEFAULT_V2");
    const title = await sec("TITLE_DEFAULT");
    const hostOverview = await sec("HOST_OVERVIEW_DEFAULT");
    const description = (await sec("DESCRIPTION_DEFAULT")) + "\n" + ldDesc;
    // "Where you'll sleep" is a carousel: page through it so later bedrooms are not missed
    const sleepSel = `${section("SLEEPING_ARRANGEMENT_WITH_IMAGES")}, ${section("SLEEPING_ARRANGEMENT_DEFAULT")}`;
    const sleepPages: string[] = [clean(await page.locator(sleepSel).first().innerText({ timeout: 1500 }).catch(() => ""))];
    for (let i = 0; i < 4; i++) {
      const next = page.locator(sleepSel).first().locator("button[aria-label*='Next' i]").first();
      if (!(await next.isVisible({ timeout: 500 }).catch(() => false)) || (await next.isDisabled().catch(() => true))) break;
      await next.click({ timeout: 2000 }).catch(() => {});
      await ctx.sleep(700);
      sleepPages.push(clean(await page.locator(sleepSel).first().innerText({ timeout: 1500 }).catch(() => "")));
    }
    const seenRooms = new Set<string>();
    const sleeping = sleepPages
      .join("\n")
      .split(/\n(?=(?:Bedroom|Living room|Common space|Additional|Lounge)\b)/i)
      .filter((block) => {
        const key = block.split("\n").slice(0, 2).join("|");
        if (seenRooms.has(key)) return false;
        seenRooms.add(key);
        return true;
      })
      .join("\n");
    const policies = await sec("POLICIES_DEFAULT");
    const host = await sec("MEET_YOUR_HOST");
    const highlights = await sec("HIGHLIGHTS_DEFAULT");
    const legal = await sec("HOST_LEGAL_DETAILS");
    const favorite = await sec("GUEST_FAVORITE_BANNER");
    const overviewLine = clean(`${overview}\n${title}`);

    // Full amenity list (modal) – "Not included" section means unavailable
    let amenityItems: string[] = [];
    const showAll = page.locator(`${section("AMENITIES_DEFAULT")} button`).filter({ hasText: /show all/i }).first();
    if (await showAll.isVisible({ timeout: 1500 }).catch(() => false)) {
      ctx.stage(`Reading all amenities – ${offer.name}`);
      await showAll.click({ timeout: 4000 }).catch(() => {});
      await ctx.sleep(1500);
      const dialogs = await textList(page, "[role='dialog']", 5);
      const d = dialogs.find((x) => /What this place offers/i.test(x)) ?? "";
      const [inc, notInc] = d.split(/\nNot included\n/i);
      amenityItems = [...(inc ?? "").split("\n"), ...(notInc ?? "").split("\n").map((x) => (x.startsWith("Unavailable") ? x : x ? `Unavailable: ${x}` : x))].map((x) => x.trim()).filter((x) => x && x.length < 80);
      await pressKey(page, "Escape");
      await ctx.sleep(500);
    } else {
      amenityItems = (await sec("AMENITIES_DEFAULT")).split("\n").filter((x) => x.length < 80);
    }
    await ctx.checkpoint(page, "amenities");

    const sources: TextSource[] = [
      { source: "property_detail", text: overviewLine },
      { source: "room_detail", text: sleeping },
      { source: "description", text: description },
      { source: "property_detail", text: `${policies}\n${highlights}` },
      ...amenityItems.map((t) => ({ source: "facility" as const, text: t, item: true })),
    ];
    const prose = sources.filter((s) => !s.item);
    applyDetailSources(offer, pc, prose, { bedSources: sleeping ? [{ source: "room_detail", text: sleeping }] : [{ source: "property_detail", text: overviewLine }], estimateWalk: c.station.estimateFromDistance });
    const withItems = { ...offer };
    applyDetailSources(withItems, pc, sources, { estimateWalk: c.station.estimateFromDistance });
    offer.amenities = withItems.amenities;
    offer.bathtubs = withItems.bathtubs;

    const kind = overviewLine.match(/(Entire [^\n]+?|Private room[^\n]*?|Shared room[^\n]*?|Room in [^\n]+?) in [^\n]+/i)?.[0] ?? "";
    const e = entireFromText(kind || overviewLine.slice(0, 200));
    if (e != null) offer.entirePlace = { value: e, confidence: "VERIFIED", evidence: [ev(pc, "entirePlace", "property_detail", kind || overviewLine.slice(0, 100), "high")] };
    offer.propertyType = detectPropertyType(kind, offer.name) ?? offer.propertyType;
    offer.roomName = kind || null;

    if (/superhost/i.test(hostOverview + host)) offer.trustSignals.push({ label: "Superhost", weight: 2 });
    if (/guest favorite/i.test(favorite + overview)) offer.trustSignals.push({ label: "Airbnb Guest Favorite", weight: 2 });
    const years = (hostOverview + "\n" + host).match(/(\d+)\s+years? (?:of )?hosting/i);
    if (years) offer.trustSignals.push({ label: `${years[1]} years hosting`, weight: Number(years[1]) >= 3 ? 1 : 0 });
    const reg = (description + "\n" + legal).match(/(Registration Details|Registration number|License number|許可番号|届出番号)[^\n]*\n?([^\n]{0,120})/i);
    if (reg) offer.trustSignals.push({ label: `legal registration found: ${clean(reg[2] || reg[0]).slice(0, 80)}`, weight: 1 });
    const hostReviews = host.match(/([\d,]+)\s+reviews/i);
    if (hostReviews) offer.trustSignals.push({ label: `host has ${hostReviews[1]} reviews`, weight: 0 });

    // Price breakdown popover in booking sidebar
    const bookit = await sec("BOOK_IT_SIDEBAR");
    let breakdown = "";
    const btn = page.locator("button:has-text('Show price breakdown')").first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await closeModals(page);
      await pressKey(page, "Escape");
      await btn.click({ timeout: 5000 }).catch(() => {});
      await ctx.sleep(1500);
      const d = await textList(page, "[role='dialog'], [role='tooltip'], [aria-modal='true']", 8);
      breakdown = d.filter((x) => /price details|total/i.test(x) && /night/i.test(x)).sort((a, b) => a.length - b.length)[0] ?? "";
      await pressKey(page, "Escape");
    }
    bookMap.set(offer, { bookit, breakdown });
  },

  async verifyAvailability(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const b = bookMap.get(offer)?.bookit ?? "";
    const base = { provider: "airbnb" as const, checkedAt: pc.checkedAt, checkIn: c.checkIn, checkOut: c.checkOut, adults: c.adults, children: c.children, rooms: c.rooms, url: page.url() };
    const fmt = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}/${d.slice(0, 4)}`;
    const datesOk = b.includes(fmt(c.checkIn)) && b.includes(fmt(c.checkOut));
    const guestsOk = new RegExp(`${c.adults + c.children}\\s+guests?`, "i").test(b);
    const reserve = /\bReserve\b/.test(b) && (await page.locator(`${section("BOOK_IT_SIDEBAR")} button:has-text('Reserve')`).first().isVisible({ timeout: 1000 }).catch(() => false));
    const unavailable = b.match(/(Those dates are not available|dates are unavailable|not available|minimum stay[^\n]*|Change dates)/i)?.[0];
    if (reserve && datesOk && guestsOk) {
      const evText = `Reserve button for ${fmt(c.checkIn)}–${fmt(c.checkOut)}, ${c.adults + c.children} guests`;
      offer.availability = { value: "AVAILABLE", confidence: "VERIFIED", evidence: [ev(pc, "availability", "booking_panel", evText, "high")] };
      offer.availabilityEvidence = { ...base, status: "AVAILABLE", evidence: evText };
    } else if (unavailable && !reserve) {
      offer.availability = { value: "UNAVAILABLE", confidence: "VERIFIED", evidence: [ev(pc, "availability", "booking_panel", unavailable, "high")] };
      offer.availabilityEvidence = { ...base, status: "UNAVAILABLE", evidence: unavailable };
    } else {
      const why = `booking panel unclear (reserve=${reserve}, dates=${datesOk}, guests=${guestsOk})`;
      offer.availability = { value: reserve ? "AVAILABLE" : "UNKNOWN", confidence: reserve ? "LIKELY" : "UNKNOWN", evidence: [ev(pc, "availability", "booking_panel", `${why}: ${b.slice(-200)}`, "low")] };
      offer.availabilityEvidence = { ...base, status: reserve ? "AVAILABLE" : "UNKNOWN", evidence: why };
    }
  },

  async verifyPrice(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const data = bookMap.get(offer);
    if (!data) return;
    const nights = Math.round((Date.parse(c.checkOut) - Date.parse(c.checkIn)) / 86400000);
    const total = totalForNights(data.bookit, nights, c.currency);
    const bd = clean(data.breakdown);
    const line = (re: RegExp) => {
      const m = bd.match(new RegExp(re.source + String.raw`[^\n]*?\n?\s*((?:-\s*)?(?:NT\$|\$|¥|TWD)\s*[\d,]+(?:\s*TWD)?)`, "i"));
      return m ? parseMoney(m[1], c.currency) : null;
    };
    const base = bd.match(new RegExp(String.raw`${nights}\s+nights?\s*x[^\n]*\n?\s*((?:NT\$|\$|¥|TWD)\s*[\d,]+(?:\s*TWD)?)`, "i"));
    const cleaning = line(/cleaning fee/);
    const service = line(/(?:airbnb )?service fee/);
    const taxes = line(/taxes/);
    const bdTotal = line(/total(?: \(TWD\)| TWD)?/);
    const includesTaxes = taxes ? true : /includes? (?:all )?taxes|incl\. taxes/i.test(bd + data.bookit) ? true : null;
    offer.price = buildPrice(
      {
        total: bdTotal ?? total,
        base: base ? parseMoney(base[1], c.currency) : null,
        tax: taxes,
        cleaning,
        service,
        includesTaxes,
        fromDetail: true,
        evidence: [ev(pc, "price", "booking_panel", `${(bd || data.bookit).replace(/\n/g, " | ").slice(0, 380)}`, "high")],
      },
      c,
      pc.checkedAt,
    );
    if (includesTaxes == null && /prices include all fees/i.test(data.bookit)) offer.price.evidence.push(ev(pc, "price", "booking_panel", "Prices include all fees (taxes not itemised)", "medium"));
    const policies = clean(await page.locator(section("POLICIES_DEFAULT")).first().innerText({ timeout: 1000 }).catch(() => ""));
    const cx = parseCancellation([data.bookit, policies]);
    if (cx.freeCancellation != null) offer.cancellation = cx;
    if (/You won't be charged yet/i.test(data.bookit)) offer.cancellation.payLater = offer.cancellation.payLater ?? null;
  },
};
