import type { Page } from "playwright";
import type { AccommodationProvider, ProviderRunContext } from "../types";
import type { Bed, Criteria, Offer } from "@/lib/types";
import { destinationQuery, findDestination, sameCity } from "@/lib/destinations";
import { buildPrice, createOffer } from "@/lib/engine/offer";
import { applyUnits, chooseUnits, chooseUnitsForPlan, type UnitOption, type UnitPick } from "@/lib/engine/units";
import { ev, parseBeds, parseCancellation, parseRating, parseReviewCount, sumBeds, type TextSource } from "@/lib/parsing/parsers";
import { clean, nightsBetween, parseMoney } from "@/lib/parsing/text";
import { keepOnStop, applyDetailSources, declineCookies, entireFromText, jsonLd, parseCtx, propertyTypeFromText, detectPropertyType, safeGoto, scrollDown, textList } from "../common";

const ORIGIN = "https://www.trip.com";
const slash = (d: string) => d.replace(/-/g, "/");

function listParams(c: Criteria, city: string) {
  const p = new URLSearchParams({
    city,
    checkin: slash(c.checkIn),
    checkout: slash(c.checkOut),
    adult: String(c.adults),
    crn: String(c.rooms),
    children: String(c.children),
    curr: c.currency,
    barCurr: c.currency,
    locale: "en-US",
  });
  if (c.children) p.set("ages", c.childrenAges.join(","));
  return p;
}

async function resolveCity(ctx: ProviderRunContext, page: Page): Promise<string | null> {
  const c = ctx.criteria;
  const known = findDestination(c.destination)?.trip;
  const input = page.locator("#hotels-destination, input[placeholder*='Where' i], input[placeholder*='destination' i]").first();
  if (await input.isVisible({ timeout: 5000 }).catch(() => false)) {
    ctx.stage(`Typing destination "${c.destination}"`);
    await input.click().catch(() => {});
    await input.fill("").catch(() => {});
    await input.pressSequentially(destinationQuery(c.destination), { delay: 80 }).catch(() => {});
    await ctx.sleep(2000);
    if (!known) {
      await page.locator("[class*='associative'] li, [role='listbox'] [role='option'], [class*='suggest'] li").first().click({ timeout: 4000 }).catch(() => {});
      await ctx.sleep(800);
      await page.locator("button:has-text('Search'), [class*='search-btn']").first().click({ timeout: 4000 }).catch(() => {});
      await page.waitForURL(/hotels\/list\?.*\b(city|cityId)=\d+/, { timeout: 20000 }).catch(() => {});
      const u = new URL(page.url());
      return u.searchParams.get("city") ?? u.searchParams.get("cityId");
    }
  }
  return known ?? null;
}

interface TripRoomCard {
  name: string;
  beds: string;
  facilities: string[];
  rates: { adults: number; guestText: string; text: string }[];
}
interface TripRate {
  card: TripRoomCard;
  text: string;
  quoteRooms: number;
  inclTax: boolean;
  currency: string;
  nightsOk: boolean;
}
const g = globalThis as unknown as { __tripPicks?: WeakMap<Offer, { picks: UnitPick<TripRate>[] | null; any: boolean }> };
const picksMap = (g.__tripPicks ??= new WeakMap());

export const TripProvider: AccommodationProvider = {
  id: "trip",
  label: "Trip.com",

  async search(ctx, page) {
    const c = ctx.criteria;
    ctx.stage("Opening Trip.com");
    await safeGoto(page, `${ORIGIN}/hotels/?locale=en-US&curr=${c.currency}`);
    await ctx.checkpoint(page, "home");
    await declineCookies(page);
    const city = await resolveCity(ctx, page);
    if (!city) throw new Error(`could not resolve Trip.com city for "${c.destination}"`);
    ctx.stage(`Searching ${c.checkIn} → ${c.checkOut}, ${c.adults} adults`);
    ctx.log(`Trip.com city id ${city}, ${c.adults} adults, ${c.rooms} room(s)`);
    await safeGoto(page, `${ORIGIN}/hotels/list?${listParams(c, city).toString()}`);
    await ctx.checkpoint(page, "results");
    await page.waitForSelector(".hotel-card-versionb, .list-item .hotelName", { timeout: 25000 }).catch(() => {});
    await ctx.checkpoint(page, "results");
    const shown = (await page.title()).match(/^(.+?) Hotels\b/i)?.[1]?.trim();
    if (shown && !sameCity(shown, destinationQuery(c.destination))) throw new Error(`Trip.com opened "${shown}" instead of "${c.destination}" – city not resolved, results skipped`);
    const found = clean(await page.locator("text=/properties found/").first().innerText({ timeout: 1500 }).catch(() => ""));
    if (found) ctx.log(`Trip.com: ${found}`);
  },

  async parseSearchResults(ctx, page, max) {
    const c = ctx.criteria;
    // Trip.com appends the next batch when the bottom of the list is reached (infinite scroll)
    await page.bringToFront().catch(() => {});
    let last = -1;
    let stable = 0;
    await keepOnStop(async () => {
      for (let i = 0; i < 60 && stable < 3; i++) {
        const n = await page.locator(".hotel-card-versionb").count();
        if (n >= max) break;
        stable = n === last ? stable + 1 : 0;
        last = n;
        ctx.stage(`Scrolling results (${n} cards)`);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await Promise.race([page.mouse.wheel(0, 2500).catch(() => {}), new Promise((r) => setTimeout(r, 2000))]);
        await ctx.sleep(1600);
        await ctx.checkpoint(page, "scroll");
      }
    });
    const cards = await page.$$eval(
      ".hotel-card-versionb",
      (els, lim) =>
        els.slice(0, lim as number).map((e) => {
          const t = (s: string) => ((e.querySelector(s) as HTMLElement | null)?.innerText || "").trim();
          const root = e.closest(".list-item") ?? e;
          return {
            name: t(".hotelName"),
            href: (root.querySelector("a[href*='hotels/detail'], a[href*='hotelId=']") as HTMLAnchorElement | null)?.href || "",
            id: (e.getAttribute("id") || root.getAttribute("id") || "").replace(/\D/g, ""),
            position: t(".position-desc") || t(".hotel-position-versionb"),
            reviews: t(".comment-num"),
            score: t(".comment-score-B") || t(".score"),
            room: t(".room-name"),
            bed: t(".bed-info-text"),
            people: e.querySelectorAll(".render-person, .people-icon").length,
            peopleText: t(".room-panel-roominfo-people-icons"),
            price: t(".room-price") || t(".price-explain-versionb"),
            text: (e as HTMLElement).innerText,
          };
        }),
      max,
    );
    const nights = nightsBetween(c.checkIn, c.checkOut);
    const offers: Offer[] = [];
    for (const card of cards) {
      if (!card.name) continue;
      const id = card.href.match(/hotelId=(\d+)/)?.[1] ?? card.id;
      if (!id) continue;
      const dp = new URLSearchParams({ hotelId: id, checkIn: c.checkIn, checkOut: c.checkOut, adult: String(c.adults), children: String(c.children), crn: String(c.rooms), curr: c.currency, locale: "en-US" });
      const o = createOffer("trip", id, `${ORIGIN}/hotels/detail/?${dp.toString()}`, card.name, c);
      const pc = parseCtx(o, page.url());
      const text = clean(card.text);
      o.address = card.position.replace(/Map$/, "").trim() || null;
      const r = parseRating(card.score.match(/(\d{1,2}(?:\.\d)?)/)?.[1] ?? null, 10);
      if (r) o.rating = { value: r, confidence: "VERIFIED", evidence: [ev(pc, "rating", "search_card", card.score.replace(/\n/g, " "), "high", `${r.raw}/10`)] };
      const rc = parseReviewCount(card.reviews);
      if (rc != null) o.reviewCount = { value: rc, confidence: "VERIFIED", evidence: [ev(pc, "reviewCount", "search_card", card.reviews, "high")] };
      o.roomName = card.room || null;
      const occ = card.peopleText.match(/x\s*(\d+)/i)?.[1] ?? text.match(/\bx(\d+)\b/)?.[1];
      if (occ) o.maxGuests = { value: Number(occ), confidence: "LIKELY", qualifier: "exact", evidence: [ev(pc, "maxGuests", "search_card", `${card.room} x${occ}`, "medium")] };
      const beds = sumBeds(parseBeds(card.bed.replace(/\band\b/g, ",")));
      if (beds.length) o.beds = { value: beds, confidence: "LIKELY", evidence: [ev(pc, "beds", "search_card", card.bed, "medium")] };
      const tmp = { ...o };
      applyDetailSources(tmp, pc, [{ source: "search_card", text: card.bed.replace(/(\d+)\s*bedroom/gi, " $1 bedroom") }], { estimateWalk: false });
      o.bedrooms = tmp.bedrooms;
      o.bathrooms = tmp.bathrooms;
      o.entirePlace = entireFromText(card.bed) != null ? { value: entireFromText(card.bed), confidence: "LIKELY", evidence: [ev(pc, "entirePlace", "search_card", card.bed, "medium")] } : o.entirePlace;
      o.propertyType = propertyTypeFromText(`${card.bed} ${card.name} ${card.room}`);
      const totalM = text.match(/Total price:\s*((?:TWD|NT\$|JPY|¥|US\$)\s*[\d,]+)/i);
      const unitLine = text.match(/(\d+)\s+(room|apartment|unit|villa|house)s?\s*×\s*(\d+)\s+nights?\s*(incl\.? taxes & fees)?/i);
      if (unitLine && Number(unitLine[1]) > 1 && c.rooms === 1) o.errors.push(`search card combines ${unitLine[1]} rooms`);
      if (unitLine && Number(unitLine[1]) > 1 && o.maxGuests.value != null) {
        const units = Number(unitLine[1]);
        o.maxGuests = { ...o.maxGuests, value: o.maxGuests.value * units, note: `${o.maxGuests.value} per room × ${units} rooms` };
      }
      if (totalM) {
        const bound = unitLine ? Number(unitLine[3]) === nights : false;
        o.price = buildPrice(
          { total: parseMoney(totalM[1], c.currency), includesTaxes: unitLine?.[4] ? true : null, fromDetail: false, evidence: [ev(pc, "price", "search_card", `${totalM[0]} · ${unitLine?.[0] ?? ""}`, bound ? "high" : "low")] },
          c,
          pc.checkedAt,
        );
        if (!bound) o.price.confidence = "UNKNOWN";
        o.availability = { value: "AVAILABLE", confidence: "LIKELY", evidence: [ev(pc, "availability", "search_card", `${totalM[0]} ${unitLine?.[0] ?? ""}`, "medium", "price shown for requested dates (search page)")] };
      } else if (/sold out|no rooms? available|fully booked/i.test(text)) {
        o.availability = { value: "UNAVAILABLE", confidence: "LIKELY", evidence: [ev(pc, "availability", "search_card", text.match(/[^\n]*(sold out|fully booked|no rooms?)[^\n]*/i)?.[0] ?? "", "medium")] };
      }
      o.cancellation = parseCancellation([text]);
      if (/pay nothing until|pay at hotel|book now, pay later/i.test(text)) o.cancellation.payLater = true;
      offers.push(o);
    }
    return offers;
  },

  async openProperty(ctx, page, offer) {
    ctx.stage(`Opening ${offer.name}`);
    await safeGoto(page, offer.url);
    // Trip.com redirects detail pages to sign-in for new browser profiles -> checkpoint hands control to the user
    await ctx.checkpoint(page, "property");
    await page.waitForLoadState("load").catch(() => {});
    await ctx.sleep(2500);
    await ctx.checkpoint(page, "property");
  },

  async parsePropertyDetails(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const guests = c.adults + c.children;
    const nights = nightsBetween(c.checkIn, c.checkOut);
    for (const j of await jsonLd(page)) {
      if (!/Hotel|Lodging|Apartment|House|Resort|Hostel/i.test(String(j?.["@type"] ?? ""))) continue;
      const a = j.address as Record<string, string> | undefined;
      if (a?.streetAddress) offer.address = a.streetAddress;
      const geo = j.geo as Record<string, number> | undefined;
      if (geo?.latitude) (offer.latitude = Number(geo.latitude)), (offer.longitude = Number(geo.longitude));
      const ar = j.aggregateRating as Record<string, number | string> | undefined;
      if (ar?.ratingValue) {
        const r = parseRating(String(ar.ratingValue), Number(ar.bestRating ?? 10));
        if (r) offer.rating = { value: r, confidence: "VERIFIED", evidence: [ev(pc, "rating", "structured_data", `JSON-LD ${ar.ratingValue}/${ar.bestRating ?? 10}`, "high")] };
        const n = Number(ar.reviewCount ?? ar.ratingCount);
        if (n) offer.reviewCount = { value: n, confidence: "VERIFIED", evidence: [ev(pc, "reviewCount", "structured_data", `JSON-LD ${n}`, "high")] };
      }
    }

    // Room list ("Select Rooms"): expand hidden room types / rates first
    ctx.stage(`Reading rooms – ${offer.name}`);
    for (let i = 0; i < 6; i++) {
      const more = page.locator("[class*='compensateRoomList-foldButton'], button, div[role='button'], span").filter({ hasText: /^(More Room Types|Show \d+ more room rates?.*)$/ }).first();
      if (!(await more.isVisible({ timeout: 800 }).catch(() => false))) break;
      await more.click({ timeout: 3000 }).catch(() => {});
      await ctx.sleep(900);
    }
    await scrollDown(ctx, page, 3);
    const cards: TripRoomCard[] = await page
      .$$eval("[class*='commonRoomCard__']", (els) =>
        els.map((card) => {
          const one = (s: string) => ((card.querySelector(s) as HTMLElement | null)?.innerText || "").trim();
          return {
            name: one("[class*='commonRoomCard-title']"),
            beds: one("[class*='baseRoom-bedsInfo_title']"),
            facilities: Array.from(card.querySelectorAll("[class*='baseRoom-facility_title']")).map((e) => (e as HTMLElement).innerText.trim()),
            rates: Array.from(card.querySelectorAll("[class*='saleRoomItemBox__']")).map((r) => {
              const guestBox = r.querySelector("[class*='saleRoomItemBox-guestInfo']") as HTMLElement | null;
              return {
                adults: r.querySelectorAll("[class*='adultIcon']").length,
                guestText: (guestBox?.innerText || "").trim(),
                text: (r as HTMLElement).innerText.slice(0, 1500),
              };
            }),
          };
        }),
      )
      .catch(() => [] as TripRoomCard[]);

    // one option per bookable rate; the quote covers N rooms of that type ("2 rooms × 4 nights")
    const options: (UnitOption<TripRate> & { beds: Bed[] | null })[] = [];
    for (const card of cards) {
      const beds = sumBeds(parseBeds(card.beds.replace(/\band\b/g, ",")));
      for (const r of card.rates) {
        const t = clean(r.text);
        if (!/\b(Reserve|Book)\b/.test(t) || /sold out/i.test(t)) continue;
        const occ = r.adults || Number(r.guestText.match(/(\d+)/)?.[1] ?? 0) || null;
        const totalM = t.match(/Total price:\s*((?:TWD|NT\$)\s*[\d,]+)/i);
        const quoteRooms = Number(t.match(/(\d+)\s+rooms?\s*\S?\s*[×x?]\s*\d+\s+nights?/i)?.[1] ?? t.match(/(\d+)\s+rooms?\s*[^\d]{0,3}\d+\s+nights?/i)?.[1] ?? 1);
        const total = totalM ? parseMoney(totalM[1], c.currency) : null;
        const last = Number(t.match(/Our last (\d+)/i)?.[1] ?? 0);
        options.push({
          key: `${card.name}|${options.length}`,
          name: card.name || "Room",
          maxPeople: occ,
          available: last || Math.max(quoteRooms, c.rooms),
          price: total ? Math.round(total.amount / Math.max(1, quoteRooms)) : null,
          beds: beds.length ? beds : null,
          data: { card, text: t, quoteRooms, inclTax: /incl\.?\s*taxes/i.test(t), currency: total?.currency ?? c.currency, nightsOk: new RegExp(`${nights}\\s+nights?`).test(t) },
        });
      }
    }
    const wantBreakfast = c.meals.breakfast === "REQUIRED" && options.some((o) => /breakfast included|includes \d+ (?:great )?breakfast/i.test(o.data.text));
    const usable = wantBreakfast ? options.filter((o) => /breakfast included|includes \d+ (?:great )?breakfast/i.test(o.data.text)) : options;
    const picks = c.roomPlan.length ? chooseUnitsForPlan(usable, c.roomPlan) : chooseUnits(usable, guests, c.rooms);
    picksMap.set(offer, { picks, any: cards.length > 0 });
    if (!cards.length) ctx.log(`${offer.name}: room list not found on Trip.com detail page`, "warn");
    else if (!picks) ctx.log(`${offer.name}: no combination of ${c.rooms} room(s) fits ${guests} guests`, "warn");

    // property-wide text: policies, amenities, surroundings (stations in ft/m)
    await scrollDown(ctx, page, 4);
    await ctx.checkpoint(page, "details");
    const body = clean(await page.evaluate(() => document.body.innerText.slice(0, 60000)).catch(() => ""));
    const section = (start: RegExp, end: RegExp) => {
      const i = body.search(start);
      if (i < 0) return "";
      const rest = body.slice(i, i + 4000);
      const j = rest.slice(20).search(end);
      return j > 0 ? rest.slice(0, j + 20) : rest.slice(0, 1500);
    };
    const surroundings = section(/Surroundings/i, /View on map|Amenities/i);
    const stationLines: string[] = [];
    for (const m of surroundings.matchAll(/(Subway station|Train station|Metro station|Station):\s*([^\n(]+?)\s*\n?\(?([\d,.]+)\s*(ft|mi|km|m)\b\)?/gi)) {
      const v = parseFloat(m[3].replace(/,/g, ""));
      // US-locale pages list far stations in miles ("1 mi"), near ones in feet
      const unit = m[4].toLowerCase();
      const meters = unit === "ft" ? v * 0.3048 : unit === "mi" ? v * 1609.34 : unit === "km" ? v * 1000 : v;
      const name = /station/i.test(m[2]) ? m[2].trim() : `${m[2].trim()} Station`;
      stationLines.push(`${name} ${Math.round(meters)} m`);
    }
    const policies = section(/Policies/i, /Guest Reviews|Location|FAQ/i);
    const amenities = section(/Amenities/i, /All amenities|Policies/i);
    const sources: TextSource[] = [
      { source: "surroundings", text: stationLines.join("\n") },
      { source: "property_detail", text: policies },
      { source: "description", text: section(/About|Property description|Hotel introduction/i, /Amenities|Policies/i) },
      ...amenities.split("\n").filter((x) => x.length < 60).map((x) => ({ source: "facility" as const, text: x, item: true })),
    ];
    applyDetailSources(offer, pc, sources, { estimateWalk: c.station.estimateFromDistance });

    // room facts from the booked units only
    if (picks) {
      const parts = picks.map((pk) => {
        const card = pk.opt.data.card;
        const part = createOffer("trip", offer.providerPropertyId, offer.url, offer.name, c);
        const src: TextSource[] = [
          { source: "room_detail", text: `${card.name}\n${card.beds}\n${card.facilities.join("\n")}` },
          ...card.facilities.map((f) => ({ source: "facility" as const, text: f, item: true })),
        ];
        applyDetailSources(part, pc, src.filter((x) => !x.item), { bedSources: [{ source: "room_detail", text: card.beds.replace(/\band\b/g, ",") }], estimateWalk: false });
        const withItems = { ...part };
        applyDetailSources(withItems, pc, src, { estimateWalk: false });
        part.bathtubs = withItems.bathtubs;
        part.amenities = withItems.amenities;
        if (pk.opt.maxPeople != null) part.maxGuests = { value: pk.opt.maxPeople, confidence: "VERIFIED", qualifier: "exact", evidence: [ev(pc, "maxGuests", "room_detail", `${card.name}: sleeps ${pk.opt.maxPeople}`, "high")] };
        return { part, count: pk.count, name: pk.opt.name, maxPeople: pk.opt.maxPeople, price: pk.opt.price };
      });
      applyUnits(offer, parts);
      for (const p of parts) for (const [k, v] of Object.entries(p.part.amenities)) if (v?.value && !offer.amenities[k as keyof typeof offer.amenities]) offer.amenities[k as keyof typeof offer.amenities] = v;
      const totalUnits = picks.reduce((n, p) => n + p.count, 0);
      offer.entirePlace = { value: totalUnits <= 1 ? entireFromText(picks[0].opt.data.card.name) : false, confidence: "LIKELY", evidence: [ev(pc, "entirePlace", "room_detail", offer.roomName ?? "", "medium")] };
      offer.propertyType = detectPropertyType(offer.name, picks[0].opt.data.card.name) ?? offer.propertyType;
    }
  },

  async verifyAvailability(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const data = picksMap.get(offer);
    const base = { provider: "trip" as const, checkedAt: pc.checkedAt, checkIn: c.checkIn, checkOut: c.checkOut, adults: c.adults, children: c.children, rooms: c.rooms, url: page.url() };
    if (/\/account\/signin/.test(page.url())) {
      offer.availability = { value: "UNKNOWN", confidence: "UNKNOWN", evidence: [ev(pc, "availability", "property_detail", "sign-in wall – detail not accessible", "low")] };
      return;
    }
    if (data?.picks) {
      const evText = data.picks.map((p) => `${p.count}× ${p.opt.name} (sleeps ${p.opt.maxPeople ?? "?"}, ${/Our last \d+/i.test(p.opt.data.text) ? p.opt.data.text.match(/Our last \d+/i)![0] : `quoted for ${p.opt.data.quoteRooms} room(s)`})`).join(" + ") + "; Reserve available";
      offer.availability = { value: "AVAILABLE", confidence: "VERIFIED", evidence: [ev(pc, "availability", "room_detail", evText, "high")] };
      offer.availabilityEvidence = { ...base, status: "AVAILABLE", evidence: evText };
      return;
    }
    const body = await page.evaluate(() => document.body.innerText.slice(0, 40000)).catch(() => "");
    const sold = body.match(/(sold out|no rooms available|fully booked|not available for the selected dates)[^\n]*/i)?.[0];
    if (sold || data?.any) {
      const msg = sold ?? `no ${c.rooms} bookable room(s) together fit ${c.adults + c.children} guests`;
      offer.availability = { value: "UNAVAILABLE", confidence: "VERIFIED", evidence: [ev(pc, "availability", "room_detail", msg, "high")] };
      offer.availabilityEvidence = { ...base, status: "UNAVAILABLE", evidence: msg };
      return;
    }
    offer.availabilityEvidence = { ...base, status: offer.availability.value ?? "UNKNOWN", evidence: "room list not found; search-card evidence kept" };
  },

  async verifyPrice(ctx, page, offer) {
    const c = ctx.criteria;
    const pc = parseCtx(offer, page.url());
    const picks = picksMap.get(offer)?.picks;
    if (!picks) return;
    if (picks.some((p) => p.opt.price == null)) return; // never guess a missing unit price
    const sum = picks.reduce((s, p) => s + (p.opt.price as number) * p.count, 0);
    const lines = picks.map((p) => `${p.count}× ${p.opt.name}: ${p.opt.data.text.match(/Total price:[^\n]*\n?[^\n]*/i)?.[0]?.replace(/\n/g, " ") ?? "?"}`);
    offer.price = buildPrice(
      { total: { currency: picks[0].opt.data.currency, amount: sum }, includesTaxes: picks.every((p) => p.opt.data.inclTax) ? true : null, fromDetail: true, evidence: [ev(pc, "price", "room_detail", lines.join(" || "), picks.every((p) => p.opt.data.nightsOk) ? "high" : "medium")] },
      c,
      pc.checkedAt,
    );
    const texts = picks.map((p) => p.opt.data.text);
    const free = texts.map((t) => (/Free Cancell?ation/i.test(t) ? true : /non-?refundable/i.test(t) ? false : null));
    const cx = parseCancellation(texts);
    offer.cancellation = { ...cx, freeCancellation: free.every((x) => x === true) ? true : free.some((x) => x === false) ? false : null };
    const dl = texts.map((t) => t.match(/Free Cancell?ation before ([^\n]+)/i)?.[1]?.trim()).filter(Boolean).sort()[0];
    if (dl && offer.cancellation.freeCancellation) (offer.cancellation.deadline = dl), (offer.cancellation.refundable = true);
    if (texts.every((t) => /pay at hotel|pay nothing until/i.test(t))) offer.cancellation.payLater = true;
    offer.breakfast = texts.every((t) => /breakfast included|includes \d+ (?:great )?breakfast/i.test(t)) ? true : texts.every((t) => /breakfast for TWD|breakfast \(optional\)|no breakfast/i.test(t)) ? false : offer.breakfast;
  },

};
