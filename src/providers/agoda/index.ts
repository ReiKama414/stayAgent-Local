import type { Page } from "playwright";
import type { AccommodationProvider, ProviderRunContext } from "../types";
import type { Criteria, Offer } from "@/lib/types";
import { destinationQuery, findDestination, sameCity } from "@/lib/destinations";
import { buildPrice, createOffer } from "@/lib/engine/offer";
import { platformTypeCodes } from "@/lib/platform-types";
import { applyUnits, chooseUnits, chooseUnitsForPlan, type UnitPick } from "@/lib/engine/units";
import { ev, parseBeds, parseCancellation, parseRating, parseReviewCount, sumBeds, type TextSource } from "@/lib/parsing/parsers";
import { clean, nightsBetween, parseMoney } from "@/lib/parsing/text";
import { keepOnStop, applyDetailSources, declineCookies, dismissPopups, entireFromText, jsonLd, parseCtx, propertyTypeFromText, detectPropertyType, safeGoto, scrollDown, textList } from "../common";

const ORIGIN = "https://www.agoda.com";

/** Agoda mixes data-selenium / data-element-name / data-testid; try all three. */
const S = (n: string) => `[data-selenium='${n}'], [data-element-name='${n}'], [data-testid='${n}']`;

function params(c: Criteria, city: string) {
  const p = new URLSearchParams({
    city,
    checkIn: c.checkIn,
    checkOut: c.checkOut,
    los: String(nightsBetween(c.checkIn, c.checkOut)),
    rooms: String(c.rooms),
    adults: String(c.adults),
    children: String(c.children),
    currency: c.currency,
    locale: "en-us",
  });
  if (c.children) p.set("childAges", c.childrenAges.slice(0, c.children).join(","));
  // Agoda's own "Entire homes & apartments" filter (captured from its filter UI)
  // Agoda's own filters (codes read from its filter panel)
  if (c.meals.breakfast === "REQUIRED") p.set("benefits", "78322");
  if (c.cancellation.freeCancellation === "REQUIRED") p.set("paymentOptions", "49499");
  if (c.reviews.ratingLevel === "REQUIRED" && c.reviews.minRating10) p.set("hotelReviewScore", String(Math.max(6, Math.min(9, Math.floor(c.reviews.minRating10)))));
  if (c.bathtubs.level === "REQUIRED" && (c.bathtubs.min ?? 0) >= 1) p.set("roomAmenities", "37");
  if (c.nonSmoking === "REQUIRED") p.set("hotelFacility", "15");
  const types = platformTypeCodes(c, "agoda");
  if (types.length) p.set("hotelAccom", types.join(","));
  else if (c.placeType.entireOnly && c.placeType.level !== "IGNORE") p.set("hotelAccom", "29,28,131,103,30,108,107,106,134,-999");
  return p;
}

interface RoomOffer {
  room: string;
  occupancy: string;
  maxAdults: number | null;
  bedding: string;
  highlights: string;
  roomText: string;
  offerText: string;
  price: string;
  capacityExceeded: boolean;
  bookable: boolean;
  /** max quantity in the offer's room selector (1 when there is no selector) */
  qty: number;
}

const g = globalThis as unknown as { __agodaChosen?: WeakMap<Offer, { picks: UnitPick<RoomOffer>[] | null; all: RoomOffer[] }> };
const chosenMap = (g.__agodaChosen ??= new WeakMap());

async function resolveCity(ctx: ProviderRunContext, page: Page): Promise<string | null> {
  const c = ctx.criteria;
  const known = findDestination(c.destination)?.agoda;
  const input = page.locator("#textInput, input[data-selenium='textInput']").first();
  if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
    ctx.stage(`Typing destination "${c.destination}"`);
    await input.click().catch(() => {});
    await input.pressSequentially(destinationQuery(c.destination), { delay: 80 }).catch(() => {});
    await ctx.sleep(2000);
    const first = page.locator("[data-selenium='autosuggest-item'], ul[role='listbox'] li").first();
    if (await first.isVisible({ timeout: 3000 }).catch(() => false)) await first.click().catch(() => {});
    await ctx.sleep(800);
  }
  if (known) return known;
  // Unknown city: submit Agoda's own search form and read the city id from the resulting URL
  await page.locator("[data-element-name='search-button']").first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForURL(/[?&](city|cityId)=\d+/, { timeout: 20000 }).catch(() => {});
  const u = new URL(page.url());
  return u.searchParams.get("city") ?? u.searchParams.get("cityId");
}

export const AgodaProvider: AccommodationProvider = {
  id: "agoda",
  label: "Agoda",

  async search(ctx, page) {
    const c = ctx.criteria;
    ctx.stage("Opening Agoda");
    await safeGoto(page, `${ORIGIN}/?currency=${c.currency}&locale=en-us`);
    await ctx.checkpoint(page, "home");
    await declineCookies(page);
    const city = await resolveCity(ctx, page);
    if (!city) throw new Error(`could not resolve Agoda city for "${c.destination}"`);
    ctx.stage(`Searching ${c.checkIn} → ${c.checkOut}, ${c.adults} adults`);
    ctx.log(`Agoda city id ${city}, ${c.adults} adults, ${c.rooms} room(s)`);
    await safeGoto(page, `${ORIGIN}/search?${params(c, city).toString()}`);
    await ctx.checkpoint(page, "results");
    await page.waitForSelector("li[data-hotelid], [data-selenium='hotel-item']", { timeout: 25000 }).catch(() => {});
    await ctx.checkpoint(page, "results");
    // the result page must really be the requested city (Agoda's search box can resolve to a neighbouring town)
    const shown = (await page.title()).match(/Hotels in ([^|]+)/i)?.[1]?.trim();
    if (shown && !sameCity(shown, destinationQuery(c.destination))) throw new Error(`Agoda opened "${shown}" instead of "${c.destination}" – city not resolved, results skipped`);
  },

  async parseSearchResults(ctx, page, max) {
    const c = ctx.criteria;
    // Agoda lazy-loads ~100 cards per page while scrolling, then paginates with a Next button
    const all = new Map<string, Awaited<ReturnType<typeof readPage>>[number]>();
    const readPage = () => page.$$eval(
      "li[data-hotelid]",
      (els, lim) =>
        els.slice(0, lim as number).map((e) => {
          const q = (n: string) => ((e.querySelector(`[data-selenium='${n}'], [data-element-name='${n}'], [data-testid='${n}']`) as HTMLElement | null)?.innerText || "").trim();
          return {
            id: e.getAttribute("data-hotelid") || "",
            name: q("hotel-name"),
            href: (e.querySelector("a[href*='/hotel/']") as HTMLAnchorElement | null)?.href || "",
            area: q("area-city-text"),
            landmarks: q("popular-landmarks-text"),
            review: q("property-card-review"),
            price: q("final-price") || q("fpc-room-price"),
            priceLabel: q("per-night-begins-with"),
            pricing: q("property-card-price"),
            preferred: !!e.querySelector("[data-element-name='agoda-preferred-badge'], [data-selenium='agoda-preferred-badge']"),
            text: (e as HTMLElement).innerText,
          };
        }),
      500,
    );
    await keepOnStop(async () => {
      for (let pageNo = 0; pageNo < 8 && all.size < max; pageNo++) {
        let last = -1;
        let stable = 0;
        for (let i = 0; i < 30 && stable < 3; i++) {
          const n = await page.locator("li[data-hotelid]").count();
          stable = n === last ? stable + 1 : 0;
          last = n;
          ctx.stage(`Scrolling results (page ${pageNo + 1}, ${all.size + n} cards)`);
          await scrollDown(ctx, page, 3);
          await ctx.checkpoint(page, "scroll");
        }
        const before = all.size;
        for (const card of await readPage().catch(() => [])) if (card.id) all.set(card.id, card);
        if (all.size >= max || all.size === before) break;
        const next = page.locator("[data-selenium='pagination-next-btn'], [data-element-name='pagination-next-btn']").first();
        if (!(await next.isVisible({ timeout: 1500 }).catch(() => false))) break;
        await next.click().catch(() => {});
        await ctx.sleep(4000);
        await ctx.checkpoint(page, "results");
      }
    });
    const cards = [...all.values()].slice(0, max);
    const nights = nightsBetween(c.checkIn, c.checkOut);
    const offers: Offer[] = [];
    for (const card of cards) {
      if (!card.id || !card.name || !card.href) continue;
      const u = new URL(card.href);
      const qp = new URLSearchParams({ checkIn: c.checkIn, los: String(nights), adults: String(c.adults), children: String(c.children), rooms: String(c.rooms), currencyCode: c.currency, locale: "en-us" });
      if (c.children) qp.set("childAges", c.childrenAges.join(","));
      const o = createOffer("agoda", card.id, `${ORIGIN}${u.pathname}?${qp.toString()}`, card.name, c);
      if (platformTypeCodes(c, "agoda").length) o.platformTypes = [...c.propertyTypes];
      if (c.meals.breakfast === "REQUIRED") o.platformFeatures.push("breakfast");
      if (c.bathtubs.level === "REQUIRED" && (c.bathtubs.min ?? 0) >= 1) o.platformFeatures.push("bathtub");
      const pc = parseCtx(o, page.url());
      o.address = card.area || null;
      const text = clean(card.text);
      const rv = clean(card.review);
      const r = parseRating(rv.match(/^(\d{1,2}(?:\.\d)?)/)?.[1] ?? null, 10);
      if (r) o.rating = { value: r, confidence: "VERIFIED", evidence: [ev(pc, "rating", "search_card", rv.replace(/\n/g, " "), "high", `${r.raw}/10`)] };
      const rc = parseReviewCount(rv);
      if (rc != null) o.reviewCount = { value: rc, confidence: "VERIFIED", evidence: [ev(pc, "reviewCount", "search_card", rv.replace(/\n/g, " "), "high")] };
      for (const m of card.landmarks.matchAll(/([\d.,]+)\s*(km|m)\s+from\s+([^•]+)/g)) {
        o.landmarks.push({ name: m[3].trim(), distanceM: Math.round(parseFloat(m[1].replace(",", ".")) * (m[2] === "km" ? 1000 : 1)), raw: m[0].trim() });
      }
      const tmp = { ...o };
      applyDetailSources(tmp, pc, [{ source: "search_card", text: card.landmarks }], { estimateWalk: c.station.estimateFromDistance });
      if (tmp.station.value) o.station = tmp.station;
      if (card.preferred) o.trustSignals.push({ label: "Agoda Preferred", weight: 1 });
      const multi = text.match(/Includes\s+(\d+)\s+rooms/i);
      if (multi && Number(multi[1]) > 1) o.errors.push(`search card combines ${multi[1]} rooms`);
      const money = parseMoney(card.price, c.currency);
      if (money) {
        const perNight = /per night/i.test(card.priceLabel);
        const beforeTax = /before tax/i.test(card.priceLabel);
        const amount = { currency: money.currency, amount: perNight ? money.amount * nights : money.amount };
        o.price = buildPrice(
          { total: beforeTax ? null : amount, base: beforeTax ? amount : null, includesTaxes: beforeTax ? false : null, fromDetail: false, evidence: [ev(pc, "price", "search_card", `${card.price} ${card.priceLabel}${perNight ? ` (× ${nights} nights)` : ""}`, "medium")] },
          c,
          pc.checkedAt,
        );
        o.availability = { value: "AVAILABLE", confidence: "LIKELY", evidence: [ev(pc, "availability", "search_card", `${card.price} ${card.priceLabel}`, "medium", "price shown for requested dates (search page)")] };
      } else if (/sold out|no rooms? available|fully booked/i.test(text)) {
        o.availability = { value: "UNAVAILABLE", confidence: "LIKELY", evidence: [ev(pc, "availability", "search_card", text.match(/[^\n]*(sold out|no rooms?|fully booked)[^\n]*/i)?.[0] ?? "", "medium")] };
      }
      o.cancellation = parseCancellation([text]);
      o.propertyType = propertyTypeFromText(`${card.name} ${text.slice(0, 300)}`);
      o.entirePlace = entireFromText(text) != null ? { value: entireFromText(text), confidence: "LIKELY", evidence: [ev(pc, "entirePlace", "search_card", text.slice(0, 160), "low")] } : o.entirePlace;
      offers.push(o);
    }
    return offers;
  },

  async openProperty(ctx, page, offer) {
    ctx.stage(`Opening ${offer.name}`);
    await safeGoto(page, offer.url);
    await ctx.checkpoint(page, "property");
    await dismissPopups(page);
    await page.waitForSelector(`${S("room-grid-element")}, ${S("roomgrid")}, ${S("room-item")}`, { timeout: 20000 }).catch(() => {});
    await ctx.checkpoint(page, "property");
  },

  async parsePropertyDetails(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const guests = c.adults + c.children;
    for (const j of await jsonLd(page)) {
      if (!/Hotel|Lodging|Apartment|House|Resort|Hostel|VacationRental/i.test(String(j?.["@type"] ?? ""))) continue;
      if (j.name) offer.name = String(j.name);
      const a = j.address as Record<string, string> | undefined;
      if (a?.streetAddress) offer.address = [a.streetAddress, a.addressLocality, a.addressRegion].filter(Boolean).join(", ");
      const geo = j.geo as Record<string, number> | undefined;
      if (geo?.latitude) (offer.latitude = Number(geo.latitude)), (offer.longitude = Number(geo.longitude));
      const ar = j.aggregateRating as Record<string, number | string> | undefined;
      if (ar?.ratingValue) {
        const r = parseRating(String(ar.ratingValue), Number(ar.bestRating ?? 10));
        if (r) offer.rating = { value: r, confidence: "VERIFIED", evidence: [ev(pc, "rating", "structured_data", `JSON-LD ${ar.ratingValue}/${ar.bestRating ?? 10}`, "high")] };
        const cnt = Number(ar.reviewCount ?? ar.ratingCount);
        if (cnt) offer.reviewCount = { value: cnt, confidence: "VERIFIED", evidence: [ev(pc, "reviewCount", "structured_data", `JSON-LD reviewCount ${cnt}`, "high")] };
      }
    }

    ctx.stage(`Reading room grid – ${offer.name}`);
    await scrollDown(ctx, page, 2);
    const rooms: RoomOffer[] = await page
      .$$eval("[data-selenium='room-item'], [data-element-name='room-item'], [data-testid='room-item']", (items) => {
        const q = (root: Element, n: string) => ((root.querySelector(`[data-selenium='${n}'], [data-element-name='${n}'], [data-testid='${n}']`) as HTMLElement | null)?.innerText || "").trim();
        const out: RoomOffer[] = [];
        for (const it of items) {
          const room = q(it, "room-name");
          const occupancy = q(it, "mob-room-header-occupancy-info");
          const header = q(it, "room-header") || (it as HTMLElement).innerText.slice(0, 300);
          const m = (occupancy || header).match(/Max\s+(\d+)\s+(?:adults?|guests?|people)/i);
          const offersEls = Array.from(it.querySelectorAll("[data-selenium='mob-room-offer'], [data-element-name='mob-room-offer'], [data-testid='mob-room-offer']"));
          const base = {
            room,
            occupancy: occupancy || header.match(/Max[^\n]{0,30}/)?.[0] || "",
            maxAdults: m ? Number(m[1]) : null,
            bedding: q(it, "mob-room-header-bedding-info"),
            highlights: q(it, "room-highlights"),
            roomText: (it as HTMLElement).innerText.slice(0, 2500),
          };
          for (const of of offersEls.length ? offersEls : [it]) {
            const t = (of as HTMLElement).innerText;
            out.push({
              ...base,
              offerText: t.slice(0, 1500),
              price: q(of, "offer-price") || q(of, "fpc-room-price") || "",
              capacityExceeded: /capacity exceeded/i.test(t) || !!of.querySelector("[data-element-name='room-capacity-exceeded-jacket'], [data-selenium='room-capacity-exceeded-jacket']"),
              bookable: !!of.querySelector("[data-selenium='book-button'], [data-element-name='book-button'], [data-testid='book-button'], button") && /\bBook\b/i.test(t),
              qty: (() => {
                const sel = of.querySelector("select");
                const vals = sel ? Array.from(sel.querySelectorAll("option")).map((o) => parseInt(o.getAttribute("value") || o.textContent || "0", 10)).filter((n) => n > 0) : [];
                return vals.length ? Math.max(...vals) : 1;
              })(),
            });
          }
        }
        return out;
      })
      .catch(() => [] as RoomOffer[]);

    const nights = nightsBetween(c.checkIn, c.checkOut);
    const unitPrice = (r: RoomOffer) => {
      const m = parseMoney(r.price.replace(/\n/g, " ").match(/NT\$\s*[\d,]+|TWD\s*[\d,]+/g)?.at(-1) ?? r.price, c.currency);
      return m ? (/per night/i.test(r.offerText) ? m.amount * nights : m.amount) : null;
    };
    // With one room Agoda's own "capacity exceeded" warning is decisive; with several rooms Agoda splits guests its
    // own way, so capacity is checked from each room's stated max occupancy instead.
    const wantBreakfast = c.meals.breakfast === "REQUIRED" && rooms.some((r) => /breakfast included/i.test(r.offerText));
    const options = rooms
      .filter((r) => r.bookable && (c.rooms > 1 || !r.capacityExceeded))
      .filter((r) => !wantBreakfast || /breakfast included/i.test(r.offerText))
      .map((r, k) => ({ key: String(k), name: r.room || `Room ${k + 1}`, maxPeople: r.maxAdults ?? (c.rooms === 1 ? guests : null), available: r.qty, price: unitPrice(r), beds: (() => { const x = sumBeds(parseBeds(r.bedding)); return x.length ? x : null; })(), data: r }));
    const picks = c.roomPlan.length ? chooseUnitsForPlan(options, c.roomPlan) : chooseUnits(options, guests, c.rooms);
    chosenMap.set(offer, { picks, all: rooms });
    const totalUnits = picks?.reduce((n, x) => n + x.count, 0) ?? 0;
    const display = picks?.[0]?.opt.data ?? [...rooms].sort((a, b) => (b.maxAdults ?? 0) - (a.maxAdults ?? 0))[0] ?? null;

    await scrollDown(ctx, page, 5);
    await ctx.checkpoint(page, "details");
    const grab = async (n: string) => (await textList(page, S(n), 5)).join("\n");
    const facilities = await grab("abouthotel-amenities-facilities");
    const policies = await grab("about-hotel-policies");
    const useful = await grab("about-hotel-useful-info");
    const description = [await grab("abouthotel-description"), await grab("property-short-description")].join("\n");
    const essentials = await grab("about-hotel-nearest-essentials");
    const topAmenities = await textList(page, S("atf-top-amenities-item"), 40);
    const addressMap = await grab("hotel-address-map");
    if (!offer.address && addressMap) offer.address = clean(addressMap).split("\n")[0].replace(/-\s*SEE MAP/i, "").trim();
    const nearbyTransport = clean(await page.locator("text=Nearest transportation options").locator("xpath=..").innerText({ timeout: 800 }).catch(() => ""));

    const sources: TextSource[] = [
      ...(display ? [{ source: "room_detail" as const, text: `${display.room}\n${display.occupancy}\n${display.bedding}\n${display.highlights}` }] : []),
      ...(display?.highlights ?? "").split("\n").filter(Boolean).map((t) => ({ source: "facility" as const, text: t.trim(), item: true })),
      ...facilities.split("\n").map((t) => t.trim()).filter((t) => t && t.length < 60).map((t) => ({ source: "facility" as const, text: t, item: true })),
      ...topAmenities.map((t) => ({ source: "facility" as const, text: t, item: true })),
      { source: "description", text: description },
      { source: "property_detail", text: `${policies}\n${useful}` },
      { source: "surroundings", text: `${essentials}\n${nearbyTransport}` },
    ];
    const prose = sources.filter((s) => !s.item);
    applyDetailSources(offer, pc, prose, { bedSources: display ? [{ source: "room_detail", text: display.bedding || display.roomText.slice(0, 400) }] : prose, estimateWalk: c.station.estimateFromDistance });
    const withItems = { ...offer };
    applyDetailSources(withItems, pc, sources, { estimateWalk: c.station.estimateFromDistance });
    offer.amenities = withItems.amenities;
    offer.bathtubs = withItems.bathtubs;
    if (!offer.station.value && withItems.station.value) offer.station = withItems.station;

    if (picks && totalUnits > 1) {
      const parts = picks.map((pk) => {
        const r = pk.opt.data;
        const part = createOffer("agoda", offer.providerPropertyId, offer.url, offer.name, c);
        const src: TextSource[] = [
          { source: "room_detail", text: `${r.room}\n${r.occupancy}\n${r.bedding}\n${r.highlights}` },
          ...r.highlights.split("\n").filter(Boolean).map((t) => ({ source: "facility" as const, text: t.trim(), item: true })),
        ];
        applyDetailSources(part, pc, src.filter((x) => !x.item), { bedSources: [{ source: "room_detail", text: r.bedding || r.roomText.slice(0, 400) }], estimateWalk: c.station.estimateFromDistance });
        const withItems = { ...part };
        applyDetailSources(withItems, pc, src, { estimateWalk: c.station.estimateFromDistance });
        part.bathtubs = withItems.bathtubs;
        if (r.maxAdults != null) part.maxGuests = { value: r.maxAdults, confidence: "VERIFIED", qualifier: "exact", evidence: [ev(pc, "maxGuests", "room_detail", `${r.room}: ${r.occupancy}`, "high")] };
        return { part, count: pk.count, name: pk.opt.name, maxPeople: pk.opt.maxPeople, price: pk.opt.price };
      });
      applyUnits(offer, parts);
      offer.entirePlace = { value: false, confidence: "VERIFIED", evidence: [ev(pc, "entirePlace", "room_detail", `${totalUnits} separate rooms booked`, "high")] };
    } else if (display) {
      offer.roomName = display.room;
      offer.units = [{ name: display.room, count: 1, maxPeople: display.maxAdults, price: unitPrice(display) }];
      if (display.maxAdults != null) offer.maxGuests = { value: display.maxAdults, confidence: "VERIFIED", qualifier: "exact", evidence: [ev(pc, "maxGuests", "room_detail", `${display.room}: ${display.occupancy}`, "high")] };
      const e = entireFromText(`${display.room} ${display.highlights}`);
      if (e != null) offer.entirePlace = { value: e, confidence: "LIKELY", evidence: [ev(pc, "entirePlace", "room_detail", `${display.room} ${display.highlights}`.slice(0, 160), "medium")] };
      offer.propertyType = detectPropertyType(offer.name, display.room, description.slice(0, 200)) ?? offer.propertyType;
    }
    if (!picks && rooms.length) ctx.log(`${offer.name}: no combination of ${c.rooms} room(s) fits ${guests} guests`, "warn");
  },

  async verifyAvailability(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const data = chosenMap.get(offer);
    const box = clean(await page.locator(S("occupancy-box")).first().innerText({ timeout: 1000 }).catch(() => ""));
    const guestsOk = new RegExp(`${c.adults}\\s+adults?`, "i").test(box);
    const base = { provider: "agoda" as const, checkedAt: pc.checkedAt, checkIn: c.checkIn, checkOut: c.checkOut, adults: c.adults, children: c.children, rooms: c.rooms, url: page.url() };
    if (data?.picks) {
      const evText = `${data.picks.map((x) => `${x.count}× ${x.opt.name} (${x.opt.data.occupancy || "occupancy n/a"}, selectable up to ${x.opt.available})`).join(" + ")}; bookable${c.rooms === 1 ? " without capacity warning" : ""}${guestsOk ? `; search box: ${box}` : ""}`;
      offer.availability = { value: "AVAILABLE", confidence: guestsOk ? "VERIFIED" : "LIKELY", evidence: [ev(pc, "availability", "room_detail", evText, "high")] };
      offer.availabilityEvidence = { ...base, status: "AVAILABLE", evidence: evText };
      return;
    }
    const body = clean(await page.locator(`${S("roomgrid")}, ${S("room-grid-element")}`).allInnerTexts().then((x) => x.join("\n")).catch(() => ""));
    const sold = body.match(/(sold out|no rooms? available|not available for your dates|fully booked)[^\n]*/i)?.[0];
    if (sold || (data && data.all.length)) {
      const msg = sold ?? `no ${c.rooms} bookable room(s) among ${data!.all.length} offers fit ${c.adults + c.children} guests`;
      offer.availability = { value: "UNAVAILABLE", confidence: "VERIFIED", evidence: [ev(pc, "availability", "room_detail", msg, "high")] };
      offer.availabilityEvidence = { ...base, status: "UNAVAILABLE", evidence: msg };
      return;
    }
    offer.availability = { value: "UNKNOWN", confidence: "UNKNOWN", evidence: [ev(pc, "availability", "property_detail", "room grid not found", "low")] };
    offer.availabilityEvidence = { ...base, status: "UNKNOWN", evidence: "room grid not found" };
  },

  async verifyPrice(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const picks = chosenMap.get(offer)?.picks;
    if (!picks) return;
    const nights = nightsBetween(c.checkIn, c.checkOut);
    let sum = 0;
    let currency = c.currency;
    let beforeTax = false;
    let inclTax = true;
    const lines: string[] = [];
    for (const x of picks) {
      const r = x.opt.data;
      const vals = clean(r.price || r.offerText).replace(/NT\$\s*\n?\s*/g, "NT$ ").match(/NT\$\s*[\d,]+|TWD\s*[\d,]+/g) ?? [];
      const m = parseMoney(vals.at(-1), c.currency);
      if (!m) return; // never guess a missing unit price
      currency = m.currency;
      const perNight = /per night/i.test(r.offerText);
      if (/before tax/i.test(r.offerText)) beforeTax = true;
      if (!/incl(?:udes|\.)?\s*taxes/i.test(r.offerText)) inclTax = false;
      sum += (perNight ? m.amount * nights : m.amount) * x.count;
      lines.push(`${x.count}× ${r.room}: ${vals.at(-1)}${perNight ? ` per night × ${nights}` : ""}${beforeTax ? " (before taxes)" : ""}`);
    }
    const amount = { currency, amount: sum };
    offer.price = buildPrice(
      {
        total: beforeTax ? null : amount,
        base: beforeTax ? amount : null,
        includesTaxes: beforeTax ? false : inclTax ? true : null,
        fromDetail: true,
        evidence: [ev(pc, "price", "room_detail", lines.join(" + "), "high")],
      },
      c,
      pc.checkedAt,
    );
    const texts = picks.map((x) => x.opt.data.offerText);
    const free = texts.map((t) => (/Cancel for free before|free cancell?ation/i.test(t) ? true : /non-?refundable/i.test(t) ? false : null));
    const cx = parseCancellation(texts);
    offer.cancellation = { ...cx, freeCancellation: free.every((x) => x === true) ? true : free.some((x) => x === false) ? false : cx.freeCancellation };
    const dl = texts.map((t) => t.match(/Cancel for free before ([^\n]+)/i)?.[1]?.trim()).filter(Boolean).sort()[0];
    if (dl && offer.cancellation.freeCancellation) (offer.cancellation.deadline = dl), (offer.cancellation.refundable = true);
    if (texts.every((t) => /pay later|no payment until|pay to hotel/i.test(t))) offer.cancellation.payLater = true;
    if (texts.every((t) => /breakfast included/i.test(t))) offer.breakfast = true;
  },
};
