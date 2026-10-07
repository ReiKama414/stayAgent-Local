import type { Page } from "playwright";
import type { AccommodationProvider, ProviderRunContext } from "../types";
import type { Criteria, Offer } from "@/lib/types";
import { destinationQuery, findDestination } from "@/lib/destinations";
import { buildPrice, createOffer } from "@/lib/engine/offer";
import { platformTypeCodes } from "@/lib/platform-types";
import { applyUnits, chooseUnits, chooseUnitsForPlan, type UnitPick } from "@/lib/engine/units";
import { ev, parseBeds, parseCancellation, parseRating, parseReviewCount, sumBeds, type TextSource } from "@/lib/parsing/parsers";
import { clean, nightsBetween, parseMoney } from "@/lib/parsing/text";
import {
  applyDetailSources,
  declineCookies,
  dismissPopups,
  entireFromText,
  jsonLd,
  parseCtx,
  propertyTypeFromText,
  detectPropertyType,
  safeGoto,
  scrollDown,
  textList,
  pressKey,
  keepOnStop,
} from "../common";

const ORIGIN = "https://www.booking.com";

function occupancyParams(c: Criteria) {
  const p = new URLSearchParams({
    checkin: c.checkIn,
    checkout: c.checkOut,
    group_adults: String(c.adults),
    group_children: String(c.children),
    no_rooms: String(c.rooms),
    selected_currency: c.currency,
    lang: "en-us",
  });
  for (const a of c.childrenAges.slice(0, c.children)) p.append("age", String(a));
  return p;
}

/** Platform-side filters only narrow the list; every value is still re-verified on the property page. */
function platformFilters(c: Criteria): string {
  const f: string[] = [];
  if (c.bedrooms.level === "REQUIRED" && (c.bedrooms.exact ?? c.bedrooms.min)) f.push(`entire_place_bedroom_count=${c.bedrooms.exact ?? c.bedrooms.min}`);
  if (c.bathrooms.level === "REQUIRED" && (c.bathrooms.exact ?? c.bathrooms.min)) f.push(`min_bathrooms=${c.bathrooms.exact ?? c.bathrooms.min}`);
  if (c.placeType.level === "REQUIRED" && c.placeType.entireOnly) f.push("privacy_type=3");
  for (const code of platformTypeCodes(c, "booking")) f.push(`ht_id=${code}`);
  if (c.reviews.ratingLevel === "REQUIRED" && c.reviews.minRating10) {
    const b = Math.floor(c.reviews.minRating10) * 10;
    if (b >= 60) f.push(`review_score=${Math.min(90, b)}`);
  }
  if (c.meals.breakfast === "REQUIRED") f.push("mealplan=1");
  if (c.meals.dinner === "REQUIRED") f.push("mealplan=9");
  // Booking's budget filter is per night; widen it 20% so tax/fee differences never exclude a real candidate
  if (c.budget.level === "REQUIRED" && (c.budget.min != null || c.budget.max != null) && c.currency === "TWD") {
    const nights = nightsBetween(c.checkIn, c.checkOut);
    const guests = c.adults + c.children;
    const perNight = (v: number) => (c.budget.basis === "total" ? v / nights : c.budget.basis === "person" ? (v * guests) / nights : v);
    const lo = c.budget.min != null ? Math.floor((perNight(c.budget.min) * 0.8) / 100) * 100 : 0;
    const hi = c.budget.max != null ? Math.ceil((perNight(c.budget.max) * 1.2) / 100) * 100 : 999999;
    f.push(`price=TWD-${lo}-${hi}-1`);
  }
  return f.join(";");
}

interface CardData {
  title: string;
  href: string;
  address: string;
  distance: string;
  review: string;
  units: string;
  price: string;
  taxes: string;
  nights: string;
  text: string;
  badges: string[];
}

interface RowData {
  roomName: string;
  roomId: string | null;
  bedText: string;
  unitText: string;
  facilities: string[];
  occupancy: string;
  maxPeople: number | null;
  price: string;
  conditions: string;
  hasSelect: boolean;
  maxUnits: number;
  /** dropdown texts, e.g. "2 (TWD 89,148)" */
  optionTexts: string[];
  rowText: string;
}

const g = globalThis as unknown as { __bookingPicks?: WeakMap<Offer, UnitPick<RowData>[] | null> };
const chosenPicks = (g.__bookingPicks ??= new WeakMap());

const MONEY = /(?:TWD|NT\$|JPY|¥|US\$)\s*[\d,]+/g;
/** room price for the stay (one unit) and its separately listed taxes */
function rowMoney(r: RowData, cur: string) {
  const taxM = r.price.match(/\+\s*((?:TWD|NT\$|JPY|¥|US\$)\s*[\d,]+)\s*taxes and (?:fees|charges)/i);
  // drop the tax amount (compare digits: the site mixes normal and non-breaking spaces)
  const taxDigits = taxM ? taxM[1].replace(/\D/g, "") : null;
  const vals = (r.price.match(MONEY) ?? []).filter((v) => v.replace(/\D/g, "") !== taxDigits);
  return {
    amount: parseMoney(vals.at(-1) ?? null, cur),
    tax: taxM ? parseMoney(taxM[1], cur) : null,
    includes: /includes taxes and (fees|charges)/i.test(r.price) ? true : taxM ? true : null,
  };
}

export const BookingProvider: AccommodationProvider = {
  id: "booking",
  label: "Booking.com",

  async search(ctx, page) {
    const c = ctx.criteria;
    ctx.stage("Opening Booking.com");
    await safeGoto(page, `${ORIGIN}/index.html?selected_currency=${c.currency}&lang=en-us`);
    await ctx.checkpoint(page, "home");
    await declineCookies(page);
    await dismissPopups(page);
    // Visible input of the destination in the real search box
    const box = page.locator("input[name='ss'], [data-testid='destination-container'] input").first();
    if (await box.isVisible({ timeout: 4000 }).catch(() => false)) {
      ctx.stage(`Typing destination "${destinationQuery(c.destination)}"`);
      await box.click().catch(() => {});
      await box.fill("").catch(() => {});
      await box.pressSequentially(destinationQuery(c.destination), { delay: 70 }).catch(() => {});
      await ctx.sleep(1200);
    }
    // Dates / occupancy / filters are applied through Booking's own search URL parameters (exact & reproducible).
    const p = occupancyParams(c);
    p.set("ss", destinationQuery(c.destination));
    const nflt = platformFilters(c);
    if (nflt) p.set("nflt", nflt);
    ctx.stage(`Searching ${c.checkIn} → ${c.checkOut}, ${c.adults} adults${c.children ? `, ${c.children} children` : ""}`);
    ctx.log(`Booking search with ${c.adults} adults, ${c.rooms} room(s)${nflt ? `, platform filters: ${nflt}` : ""}`);
    await safeGoto(page, `${ORIGIN}/searchresults.html?${p.toString()}`);
    await ctx.checkpoint(page, "results");
    await declineCookies(page);
    await dismissPopups(page);
    await page.waitForSelector("[data-testid='property-card']", { timeout: 20000 }).catch(() => {});
    await ctx.checkpoint(page, "results");
    // Booking's own error page ("Oops!") – retry once, then let the user look at the window
    const isError = async () => /^\s*oops/i.test(await page.locator("h1").first().innerText({ timeout: 1500 }).catch(() => ""));
    if (await isError()) {
      ctx.log("Booking returned its error page (Oops!); retrying once in a few seconds", "warn");
      await ctx.sleep(6000);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page.waitForSelector("[data-testid='property-card']", { timeout: 20000 }).catch(() => {});
      if (await isError()) {
        await ctx.requestUser(page, "Booking.com shows its error page (Oops!) – reload or search manually in the window until results appear");
        await page.waitForSelector("[data-testid='property-card']", { timeout: 20000 }).catch(() => {});
      }
    }
    const header = await page.locator("h1").first().innerText({ timeout: 2000 }).catch(() => "");
    if (header) ctx.log(`Booking: ${clean(header)}`);
  },

  async parseSearchResults(ctx, page, max) {
    const c = ctx.criteria;
    const seen = new Map<string, CardData>();
    const collect = async () => {
      for (const card of await readCards(page, 200).catch(() => [] as CardData[])) if (card.href) seen.set(new URL(card.href).pathname, card);
    };
    let lastSize = -1;
    await keepOnStop(async () => {
      for (let i = 0; i < 60 && seen.size < max; i++) {
        await collect();
        if (seen.size >= max) break;
        ctx.stage(`Scrolling results (${seen.size} cards)`);
        const before =await page.locator("[data-testid='property-card']").count();
        await scrollDown(ctx, page, 3);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await ctx.sleep(1500);
        await ctx.checkpoint(page, "scroll");
        const more = page.locator("button:has-text('Load more results'), button:has-text('Load more')").first();
        if (await more.isVisible({ timeout: 1500 }).catch(() => false)) {
          await more.scrollIntoViewIfNeeded().catch(() => {});
          await more.click().catch(() => {});
          await ctx.sleep(2500);
        } else if ((await page.locator("[data-testid='property-card']").count()) === before) {
          // no infinite loading on this layout: use Booking's own result paging
          await collect();
          const u = new URL(page.url());
          const offset = Number(u.searchParams.get("offset") ?? 0) + before;
          if (!before || offset >= 1000) break;
          u.searchParams.set("offset", String(offset));
          ctx.stage(`Next results page (offset ${offset})`);
          await safeGoto(page, u.toString());
          await ctx.checkpoint(page, "results");
          await page.waitForSelector("[data-testid='property-card']", { timeout: 15000 }).catch(() => {});
          if (!(await page.locator("[data-testid='property-card']").count())) break;
          await collect();
          if (seen.size === lastSize) break; // the next page brought nothing new
          lastSize = seen.size;
        }
      }
    });
    await collect();
    const cards = [...seen.values()].slice(0, max);
    const nights = nightsBetween(c.checkIn, c.checkOut);
    const offers: Offer[] = [];
    for (const card of cards) {
      if (!card.href || !card.title) continue;
      const u = new URL(card.href);
      const slug = u.pathname.replace(/^\/hotel\//, "").replace(/\.[a-z-]+\.html$|\.html$/, "");
      const url = `${ORIGIN}${u.pathname.replace(/\.[a-z]{2}(-[a-z]{2})?\.html$/, ".html")}?${occupancyParams(c).toString()}`;
      const o = createOffer("booking", slug, url, card.title, c);
      if (platformTypeCodes(c, "booking").length) o.platformTypes = [...c.propertyTypes];
      if (c.meals.breakfast === "REQUIRED") o.platformFeatures.push("breakfast");
      const pc = parseCtx(o, page.url());
      o.address = card.address || null;
      const dm = card.distance.match(/([\d.]+)\s*(km|m)\s+from (?:downtown|center|centre)/i);
      if (dm) o.centerDistanceM = Math.round(parseFloat(dm[1]) * (dm[2] === "km" ? 1000 : 1));

      const r = parseRating(card.review.match(/Scored\s+([\d.]+)/i)?.[1] ?? null, 10);
      if (r) o.rating = { value: r, confidence: "VERIFIED", evidence: [ev(pc, "rating", "search_card", card.review.replace(/\n/g, " "), "high", `${r.raw}/10`)] };
      const rc = parseReviewCount(card.review);
      if (rc != null) o.reviewCount = { value: rc, confidence: "VERIFIED", evidence: [ev(pc, "reviewCount", "search_card", card.review.replace(/\n/g, " "), "high", String(rc))] };

      // Recommended units: "3× Standard Apartment" means Booking combines several units for the group.
      const unitsText = clean(card.units);
      const multipliers = [...unitsText.matchAll(/(\d+)\s*×/g)].map((m) => Number(m[1]));
      const unitCount = multipliers.reduce((a, b) => a + b, 0) || (unitsText ? 1 : 0);
      o.roomName = unitsText.split("\n").filter((l) => l && !/recommended for your group|^\d+\s*×$/i.test(l))[0] ?? null;
      if (unitCount > 1) {
        o.errors.push(`search card combines ${unitCount} units`);
        o.maxGuests = { value: null, confidence: "UNKNOWN", evidence: [ev(pc, "maxGuests", "search_card", unitsText.replace(/\n/g, " · "), "high", `Booking suggests ${unitCount} separate units`)], note: `multi-unit (${unitCount})` };
      } else if (unitsText) {
        const src: TextSource[] = [{ source: "search_card", text: unitsText }];
        applyCardCounts(o, pc, src);
      }
      o.entirePlace = entireFromText(unitsText) != null ? { value: entireFromText(unitsText), confidence: "LIKELY", evidence: [ev(pc, "entirePlace", "search_card", unitsText.slice(0, 120), "medium")] } : o.entirePlace;
      o.propertyType = propertyTypeFromText(`${unitsText} ${card.title}`);
      if (card.badges.includes("preferred-badge")) o.trustSignals.push({ label: "Booking Preferred Partner", weight: 1 });

      // Price bound to dates/guests shown on the card ("4 nights, 5 adults")
      const priceVals = card.price.match(/(?:TWD|NT\$|JPY|¥|US\$)\s*[\d,]+/g) ?? [];
      const total = parseMoney(priceVals.at(-1) ?? card.price, c.currency);
      const bound = new RegExp(`${nights}\\s+nights?`, "i").test(card.nights) && new RegExp(`${c.adults}\\s+adults?`, "i").test(card.nights);
      const tax = /\+\s*(?:TWD|NT\$|JPY|¥|US\$)/.test(card.taxes) ? parseMoney(card.taxes, c.currency) : null;
      const includes = /includes taxes and (fees|charges)/i.test(card.taxes) ? true : tax ? true : null;
      if (total) {
        o.price = buildPrice(
          { total: tax ? null : total, base: tax ? total : null, tax, includesTaxes: includes, fromDetail: false, evidence: [ev(pc, "price", "search_card", `${card.nights} · ${card.price} · ${card.taxes}`.replace(/\n/g, " "), bound ? "high" : "low")] },
          c,
          pc.checkedAt,
        );
        if (!bound) {
          o.price.confidence = "UNKNOWN";
          o.errors.push(`card price label "${card.nights}" does not match ${nights} nights / ${c.adults} adults`);
        }
      }
      const text = clean(card.text);
      if (/no availability|sold out|not available on our site|no rooms available/i.test(text)) {
        o.availability = { value: "UNAVAILABLE", confidence: "LIKELY", evidence: [ev(pc, "availability", "search_card", text.match(/[^\n]*(no availability|sold out|not available)[^\n]*/i)?.[0] ?? "", "medium")] };
      } else if (total && bound) {
        o.availability = { value: "AVAILABLE", confidence: "LIKELY", evidence: [ev(pc, "availability", "search_card", `${card.nights}: ${card.price}`.replace(/\n/g, " "), "medium", "price shown for requested dates (search page)")] };
      }
      const canc = parseCancellation([text]);
      o.cancellation = canc;
      offers.push(o);
    }
    return offers;
  },

  async openProperty(ctx, page, offer) {
    ctx.stage(`Opening ${offer.name}`);
    await safeGoto(page, offer.url);
    await ctx.checkpoint(page, "property");
    await dismissPopups(page);
    await page.waitForSelector("#hprt-table, [data-testid='property-description'], #no_availability_msg", { timeout: 15000 }).catch(() => {});
    await ctx.checkpoint(page, "property");
  },

  async parsePropertyDetails(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const guests = c.adults + c.children;

    // Structured data first
    for (const j of await jsonLd(page)) {
      if (!j || typeof j !== "object") continue;
      const type = String(j["@type"] ?? "");
      if (!/Hotel|LodgingBusiness|Apartment|House|Accommodation|Resort|Hostel|BedAndBreakfast/i.test(type)) continue;
      if (j.name) offer.name = String(j.name);
      const addr = j.address as Record<string, string> | undefined;
      if (addr?.streetAddress) offer.address = addr.streetAddress;
      const ar = j.aggregateRating as Record<string, number> | undefined;
      if (ar?.ratingValue) {
        const r = parseRating(String(ar.ratingValue), Number(ar.bestRating ?? 10));
        if (r) offer.rating = { value: r, confidence: "VERIFIED", evidence: [ev(pc, "rating", "structured_data", `JSON-LD aggregateRating ${ar.ratingValue}/${ar.bestRating ?? 10}`, "high")] };
        if (ar.reviewCount != null) offer.reviewCount = { value: Number(ar.reviewCount), confidence: "VERIFIED", evidence: [ev(pc, "reviewCount", "structured_data", `JSON-LD reviewCount ${ar.reviewCount}`, "high")] };
      }
    }
    const ll = await page.locator("[data-atlas-latlng]").first().getAttribute("data-atlas-latlng", { timeout: 1500 }).catch(() => null);
    if (ll) {
      const [la, lo] = ll.split(",").map(Number);
      if (Number.isFinite(la) && Number.isFinite(lo)) (offer.latitude = la), (offer.longitude = lo);
    }

    // Room table rows (room info cell spans several rate rows)
    ctx.stage(`Reading room table – ${offer.name}`);
    const rows: RowData[] = await page
      .$$eval("#hprt-table tbody tr", (trs) => {
        let room = { roomName: "", roomId: null as string | null, bedText: "", unitText: "", facilities: [] as string[] };
        return trs.map((tr) => {
          const rc = tr.querySelector(".hprt-table-cell-roomtype");
          if (rc) {
            const link = rc.querySelector(".hprt-roomtype-link") as HTMLElement | null;
            room = {
              roomName: (link?.innerText || "").trim(),
              roomId: link?.getAttribute("data-room-id") || link?.getAttribute("href") || null,
              bedText: ((rc.querySelector(".hprt-roomtype-bed") as HTMLElement | null)?.innerText || "").trim(),
              unitText: (rc as HTMLElement).innerText.slice(0, 400),
              facilities: Array.from(rc.querySelectorAll(".hprt-facilities-facility")).map((f) => (f as HTMLElement).innerText.trim()),
            };
          }
          const cell = (sel: string) => ((tr.querySelector(sel) as HTMLElement | null)?.innerText || "").trim();
          const occ = cell(".hprt-table-cell-occupancy");
          const mp = occ.match(/Max\.?\s*(?:people|persons|guests)\s*:?\s*(\d+)/i);
          const sel = tr.querySelector("select");
          const optEls = sel ? Array.from(sel.querySelectorAll("option")) : [];
          const opts = optEls.map((o) => parseInt(o.getAttribute("value") || "0", 10));
          return {
            ...room,
            occupancy: occ,
            maxPeople: mp ? Number(mp[1]) : null,
            price: cell(".hprt-table-cell-price"),
            conditions: cell(".hprt-table-cell-conditions"),
            hasSelect: !!sel,
            maxUnits: opts.length ? Math.max(...opts) : 0,
            optionTexts: optEls.map((o) => (o.textContent || "").replace(/\s+/g, " ").trim()),
            rowText: (tr as HTMLElement).innerText.slice(0, 1500),
          };
        });
      })
      .catch(() => [] as RowData[]);

    // Choose exactly c.rooms units (room types may be mixed); each type limited by its "select amount" dropdown
    const options = rows
      .map((r, i) => ({ key: String(i), name: r.roomName || `Room ${i + 1}`, maxPeople: r.maxPeople, available: r.hasSelect ? r.maxUnits : 0, price: rowMoney(r, c.currency).amount?.amount ?? null, beds: (() => { const b = sumBeds(parseBeds(r.bedText)); return b.length ? b : null; })(), data: r }))
      .filter((o) => o.available > 0);
    // with breakfast required, choose among rate rows that include it (when the property offers any)
    const bfRe = /breakfast included|breakfast & dinner included|朝食付/i;
    const withBf = options.filter((o) => bfRe.test(o.data.conditions + "\n" + o.data.rowText));
    if (c.meals.breakfast === "REQUIRED" && withBf.length) options.splice(0, options.length, ...withBf);
    const picks = c.roomPlan.length ? chooseUnitsForPlan(options, c.roomPlan) : chooseUnits(options, guests, c.rooms);
    chosenPicks.set(offer, picks);
    const totalUnits = picks?.reduce((n, p) => n + p.count, 0) ?? 0;
    const displayRows = picks?.map((p) => p.opt.data) ?? ([...rows].sort((a, b) => (b.maxPeople ?? 0) - (a.maxPeople ?? 0)).slice(0, 1) as RowData[]);
    if (!picks && rows.length) ctx.log(`${offer.name}: no combination of ${c.rooms} unit(s) fits ${guests} guests`, "warn");

    // Room details modal for each chosen room type (bedrooms/bathrooms/full room facility list)
    const modals = new Map<string, string>();
    for (const r of displayRows) {
      if (!r?.roomName || modals.has(r.roomName)) continue;
      const link = page.locator("#hprt-table a.hprt-roomtype-link", { hasText: r.roomName }).first();
      if (!(await link.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      ctx.stage(`Opening room details – ${r.roomName}`);
      await link.click({ timeout: 4000 }).catch(() => {});
      await ctx.sleep(1500);
      const dialogs = await textList(page, "[role='dialog']", 10);
      modals.set(r.roomName, dialogs.filter((d) => d.includes(r.roomName.slice(0, 20))).sort((a, b) => b.length - a.length)[0] ?? dialogs.sort((a, b) => b.length - a.length)[0] ?? "");
      await pressKey(page, "Escape");
      await ctx.sleep(500);
    }
    await ctx.checkpoint(page, "room details");

    // Lazy sections lower on the page
    ctx.stage(`Reading facilities & location – ${offer.name}`);
    await scrollDown(ctx, page, 4);
    const grab = async (sel: string) => (await textList(page, sel, 5)).join("\n");
    const description = await grab("[data-testid='property-description']");
    const host = await grab("[data-testid='host-profile']");
    const houseRules = await grab("[data-testid='HouseRules-wrapper']");
    const fine = await grab("[data-testid='PropertyFinePrintDesktop-wrapper']");
    const addressBlock = await grab("[data-testid='PropertyHeaderAddressDesktop-wrapper']");
    const popular = await textList(page, "[data-testid='property-most-popular-facilities-wrapper'] li, [data-testid='property-most-popular-facilities-wrapper'] [data-testid='facility-icon'] + *", 40);
    const facilityGroups = await textList(page, "[data-testid='property-section--content'] li, [data-testid='facility-group-container'] li, #hp_facilities_box li", 300);
    const pois: { group: string; name: string; dist: string }[] = await page
      .$$eval("[data-testid='poi-block']", (blocks) =>
        blocks.flatMap((b) => {
          const group = ((b.querySelector("h3, h2, [role='heading']") as HTMLElement | null)?.innerText || (b as HTMLElement).innerText.split("\n")[0] || "").trim();
          return Array.from(b.querySelectorAll("li")).map((li) => {
            const lines = (li as HTMLElement).innerText.split("\n").map((s) => s.trim()).filter(Boolean);
            const dist = lines.find((l) => /^\d+(?:[.,]\d+)?\s*(?:km|m)$/.test(l)) || "";
            const typeEl = li.querySelector("[class*='type' i], span:first-child span");
            const typ = (typeEl as HTMLElement | null)?.innerText?.trim() || "";
            let name = lines.filter((l) => l !== dist).join(" ");
            if (typ && name.startsWith(typ) && name.length > typ.length) name = name.slice(typ.length).trim();
            name = name.replace(/^(Subway|Train|Bus|Tram|Metro|Cafe\/Bar|Restaurant|Forest|Mountain|Lake|River|Beach|Sea\/Ocean)(?=[A-Z\u3040-\u9fff])/u, "");
            return { group, name, dist };
          });
        }),
      )
      .catch(() => []);
    for (const p of pois) {
      const m = p.dist.match(/([\d.,]+)\s*(km|m)/);
      if (!m || !p.name) continue;
      offer.landmarks.push({ name: p.name, distanceM: Math.round(parseFloat(m[1].replace(",", ".")) * (m[2] === "km" ? 1000 : 1)), raw: `${p.group}: ${p.name} ${p.dist}` });
    }
    const transit = pois.filter((p) => /public transit|transport/i.test(p.group)).map((p) => `${/station|駅|站/i.test(p.name) ? p.name : `${p.name} Station`} ${p.dist}`);

    const unitSources = (r: RowData): TextSource[] => {
      const modal = modals.get(r.roomName) ?? "";
      return [
        ...(modal ? [{ source: "room_detail" as const, text: modal }] : []),
        { source: "room_detail" as const, text: `${r.unitText}\n${r.bedText}` },
        ...r.facilities.map((f) => ({ source: "facility" as const, text: f, item: true })),
        ...modal.split("\n").map((l) => l.trim()).filter((l) => l && l.length < 60).map((l) => ({ source: "facility" as const, text: l, item: true })),
      ];
    };
    const unitBedSources = (r: RowData): TextSource[] => {
      const modal = modals.get(r.roomName) ?? "";
      return [...(modal ? [{ source: "room_detail" as const, text: modal.split(/Bathrooms?:|Featuring|In your private/i)[0] }] : []), ...(r.bedText ? [{ source: "room_detail" as const, text: r.bedText }] : [])];
    };
    const propertySources: TextSource[] = [
      ...popular.map((f) => ({ source: "facility" as const, text: f, item: true })),
      ...facilityGroups.map((f) => ({ source: "facility" as const, text: f, item: true })),
      { source: "description", text: description },
      { source: "description", text: host },
      { source: "property_detail", text: houseRules },
      { source: "property_detail", text: fine },
      { source: "property_detail", text: addressBlock },
      { source: "surroundings", text: transit.join("\n") },
    ];
    const est = c.station.estimateFromDistance;
    const first = displayRows[0];
    if (totalUnits <= 1) {
      // one unit: property description describes this unit too
      const sources = [...(first ? unitSources(first) : []), ...propertySources];
      const countSources = sources.filter((x) => !x.item);
      const bedSources = first ? unitBedSources(first) : [];
      applyDetailSources(offer, pc, countSources, { bedSources: bedSources.length ? bedSources : countSources, estimateWalk: est });
      const withItems = { ...offer };
      applyDetailSources(withItems, pc, sources, { bedSources: bedSources.length ? bedSources : countSources, estimateWalk: est });
      offer.amenities = withItems.amenities;
      offer.bathtubs = withItems.bathtubs;
      if (!offer.station.value && withItems.station.value) offer.station = withItems.station;
      if (first) {
        offer.roomName = first.roomName || offer.roomName;
        offer.units = [{ name: first.roomName, count: 1, maxPeople: first.maxPeople, price: rowMoney(first, c.currency).amount?.amount ?? null }];
        if (first.maxPeople != null)
          offer.maxGuests = { value: first.maxPeople, confidence: "VERIFIED", qualifier: "exact", evidence: [ev(pc, "maxGuests", "room_detail", first.occupancy.replace(/\n/g, " "), "high", `${first.roomName}: max ${first.maxPeople}`)] };
        if (!offer.beds.value && first.bedText) {
          const b = sumBeds(parseBeds(first.bedText));
          if (b.length) offer.beds = { value: b, confidence: "VERIFIED", evidence: [ev(pc, "beds", "room_detail", first.bedText, "high")] };
        }
      }
    } else {
      // several units: property-wide facts from the page, room facts summed over the booked units only
      applyDetailSources(offer, pc, propertySources, { estimateWalk: est });
      const parts = picks!.map((pk) => {
        const part = createOffer("booking", offer.providerPropertyId, offer.url, offer.name, c);
        const src = unitSources(pk.opt.data);
        const bedSrc = unitBedSources(pk.opt.data);
        applyDetailSources(part, pc, src.filter((x) => !x.item), { bedSources: bedSrc.length ? bedSrc : src.filter((x) => !x.item), estimateWalk: est });
        const withItems = { ...part };
        applyDetailSources(withItems, pc, src, { estimateWalk: est });
        part.bathtubs = withItems.bathtubs;
        if (pk.opt.maxPeople != null) part.maxGuests = { value: pk.opt.maxPeople, confidence: "VERIFIED", qualifier: "exact", evidence: [ev(pc, "maxGuests", "room_detail", pk.opt.data.occupancy.replace(/\n/g, " "), "high", `${pk.opt.name}: max ${pk.opt.maxPeople}`)] };
        return { part, count: pk.count, name: pk.opt.name, maxPeople: pk.opt.maxPeople, price: pk.opt.price };
      });
      applyUnits(offer, parts);
    }
    if (first) {
      const modal = modals.get(first.roomName) ?? "";
      const e = entireFromText(`${first.unitText}\n${modal.slice(0, 200)}`);
      if (e != null && totalUnits <= 1) offer.entirePlace = { value: e, confidence: "VERIFIED", evidence: [ev(pc, "entirePlace", "room_detail", first.unitText.split("\n").slice(0, 4).join(" · "), "high")] };
      if (totalUnits > 1) offer.entirePlace = { value: false, confidence: "VERIFIED", evidence: [ev(pc, "entirePlace", "room_detail", `${totalUnits} separate units booked`, "high")] };
      offer.propertyType = detectPropertyType(offer.name, `${first.unitText} ${modal.slice(0, 200)}`, description.slice(0, 300)) ?? offer.propertyType;
    }

    // Trust signals from the page
    const lic = fine.match(/licen[cs]e (?:number|no\.?)\s*:?\s*([^\n]{3,60})/i) ?? houseRules.match(/licen[cs]e (?:number|no\.?)\s*:?\s*([^\n]{3,60})/i);
    if (lic) offer.trustSignals.push({ label: `legal registration: ${lic[1].trim()}`, weight: 1 });
    const company = host.match(/Company review score:\s*([\d.]+)\s*Based on\s*([\d,]+)\s*reviews/i);
    if (company) offer.trustSignals.push({ label: `host company score ${company[1]} (${company[2]} reviews)`, weight: Number(company[1]) >= 8.5 ? 1 : 0 });
    const ci = houseRules.match(/Check-in\s*\n?\s*(?:From|After)\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
    const co = houseRules.match(/Check-out\s*\n?\s*(?:From\s*\d{1,2}:\d{2}\s*(?:AM|PM)?\s*to|Until|Before)\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
    if (ci) offer.checkInTime = ci[1];
    if (co) offer.checkOutTime = co[1];
  },

  async verifyAvailability(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const picks = chosenPicks.get(offer) ?? null;
    const box = clean(await page.locator("[data-testid='occupancy-config'], [data-testid='searchbox-dates-container']").allInnerTexts().then((x) => x.join(" · ")).catch(() => ""));
    const guestsOk = new RegExp(`${c.adults}\\s+adults?`, "i").test(box);
    const body = clean(await page.locator("#availability, #hprt-table, #no_availability_msg, [data-testid='property-section--availability']").allInnerTexts().then((x) => x.join("\n")).catch(() => ""));
    const base = { provider: "booking" as const, checkedAt: pc.checkedAt, checkIn: c.checkIn, checkOut: c.checkOut, adults: c.adults, children: c.children, rooms: c.rooms, url: page.url() };

    if (picks) {
      const parts = picks.map((p) => {
        const left = p.opt.data.rowText.match(/(?:We have|Only)\s+\d+\s+left[^\n]*/i)?.[0];
        return `${p.count}× ${p.opt.name} (max ${p.opt.maxPeople} people, selectable up to ${p.opt.available}${left ? `; ${left}` : ""})`;
      });
      const evidence = `${parts.join(" + ")}${guestsOk ? `; search box: ${box}` : ""}`;
      offer.availability = { value: "AVAILABLE", confidence: guestsOk ? "VERIFIED" : "LIKELY", evidence: [ev(pc, "availability", "room_detail", evidence, "high")], note: guestsOk ? undefined : "guest count in search box not confirmed" };
      offer.availabilityEvidence = { ...base, status: "AVAILABLE", evidence };
      return;
    }
    const unavailable = body.match(/(no availability|not available on our site|sold out|no rooms available|isn't available|there are no available)[^\n]*/i)?.[0] ?? (await page.locator("#no_availability_msg").innerText({ timeout: 500 }).catch(() => null));
    if (unavailable) {
      offer.availability = { value: "UNAVAILABLE", confidence: "VERIFIED", evidence: [ev(pc, "availability", "property_detail", unavailable, "high")] };
      offer.availabilityEvidence = { ...base, status: "UNAVAILABLE", evidence: unavailable };
      return;
    }
    const rowsExist = await page.locator("#hprt-table tbody tr").count().catch(() => 0);
    if (rowsExist) {
      const msg = `room table shows rooms, but no ${c.rooms} selectable unit(s) together fit ${c.adults + c.children} guests`;
      offer.availability = { value: "UNAVAILABLE", confidence: "VERIFIED", evidence: [ev(pc, "availability", "room_detail", msg, "high")], note: "not enough selectable units for the group" };
      offer.availabilityEvidence = { ...base, status: "UNAVAILABLE", evidence: msg };
      return;
    }
    offer.availability = { value: "UNKNOWN", confidence: "UNKNOWN", evidence: [ev(pc, "availability", "property_detail", "room table not found", "low")] };
    offer.availabilityEvidence = { ...base, status: "UNKNOWN", evidence: "room table not found" };
  },

  async verifyPrice(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const picks = chosenPicks.get(offer) ?? null;
    if (!picks) return;
    const header = clean(await page.locator("#hprt-table thead").innerText({ timeout: 800 }).catch(() => ""));
    const nights = nightsBetween(c.checkIn, c.checkOut);
    const boundNights = new RegExp(`Price for\\s+${nights}\\s+nights?`, "i").test(header);
    let amountSum = 0;
    let taxSum = 0;
    let anyTax = false;
    let includesAll = true;
    let currency = c.currency;
    const lines: string[] = [];
    for (const p of picks) {
      const r = p.opt.data;
      const m = rowMoney(r, c.currency);
      if (!m.amount) return; // a unit without a readable price -> keep card price, never guess
      currency = m.amount.currency;
      // the dropdown states the price for N units ("2 (TWD 89,148)") – prefer it over multiplying
      const optText = r.optionTexts.find((t) => new RegExp(`^${p.count}\\b`).test(t));
      const optMoney = optText ? parseMoney(optText.replace(/^\d+\s*/, ""), c.currency) : null;
      const unitTotal = optMoney && p.count > 1 ? optMoney.amount : m.amount.amount * p.count;
      amountSum += unitTotal;
      if (m.tax) (taxSum += m.tax.amount * p.count), (anyTax = true);
      if (m.includes !== true) includesAll = false;
      lines.push(`${p.count}× ${r.roomName}: ${r.price.replace(/\n/g, " ")}${optText && p.count > 1 ? ` | select "${optText}"` : ""}`);
    }
    offer.price = buildPrice(
      {
        total: anyTax ? null : { currency, amount: amountSum },
        base: anyTax ? { currency, amount: amountSum } : null,
        tax: anyTax ? { currency, amount: taxSum } : null,
        includesTaxes: includesAll ? true : null,
        fromDetail: true,
        evidence: [ev(pc, "price", "room_detail", `${header.slice(0, 60)} | ${lines.join(" || ")}`, boundNights ? "high" : "medium")],
      },
      c,
      pc.checkedAt,
    );
    if (!boundNights) offer.price.confidence = "LIKELY";
    const conditions = picks.map((p) => p.opt.data.conditions).join("\n");
    const cx = parseCancellation([conditions]);
    // every booked unit must be free-cancellable for the booking to be
    const each = picks.map((p) => parseCancellation([p.opt.data.conditions]).freeCancellation);
    if (cx.freeCancellation != null || cx.payLater || cx.noPrepayment) offer.cancellation = { ...cx, freeCancellation: each.every((x) => x === true) ? true : each.some((x) => x === false) ? false : null };
    if (picks.every((p) => /pay nothing until/i.test(p.opt.data.conditions))) offer.cancellation.payLater = true;
    const meal = picks.map((p) => p.opt.data.conditions + "\n" + p.opt.data.rowText).join("\n");
    if (picks.every((p) => /breakfast included|breakfast & dinner included/i.test(p.opt.data.conditions + p.opt.data.rowText))) offer.breakfast = true;
    if (/dinner included|half board/i.test(meal) && picks.length === 1) offer.dinner = true;
  },
};

function readCards(page: Page, max: number): Promise<CardData[]> {
  return page.$$eval(
      "[data-testid='property-card']",
      (els, lim) =>
        els.slice(0, lim as number).map((e) => {
          const t = (sel: string) => ((e.querySelector(sel) as HTMLElement | null)?.innerText || "").trim();
          return {
            title: t("[data-testid='title']"),
            href: (e.querySelector("a[data-testid='title-link']") as HTMLAnchorElement | null)?.href || "",
            address: t("[data-testid='address']"),
            distance: t("[data-testid='distance']"),
            review: t("[data-testid='review-score']"),
            units: t("[data-testid='recommended-units']"),
            price: t("[data-testid='price-and-discounted-price']"),
            taxes: t("[data-testid='taxes-and-charges']"),
            nights: t("[data-testid='price-for-x-nights']"),
            text: (e as HTMLElement).innerText,
            badges: Array.from(e.querySelectorAll("[data-testid$='-badge']")).map((b) => b.getAttribute("data-testid") || ""),
          };
        }),
      max,
  );
}

function applyCardCounts(o: Offer, pc: ReturnType<typeof parseCtx>, src: TextSource[]) {
  const tmp = { ...o };
  applyDetailSources(tmp, pc, src, { estimateWalk: false });
  o.bedrooms = tmp.bedrooms;
  o.bathrooms = tmp.bathrooms;
  if (tmp.beds.value) o.beds = { ...tmp.beds, confidence: "LIKELY" };
  o.rooms = tmp.rooms;
  // amenities/bathtubs from card are not trusted as complete evidence
}
