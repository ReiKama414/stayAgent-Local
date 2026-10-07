import type { AmenityKey, Bed, Criteria, Fact, FilterResult, FilterStatus, JobStats, Level, Offer, PropertyResult, ResultStatus, Trust } from "../types";
import { AMENITY_LABEL, COUPLE_BEDS, WESTERN_BEDS } from "../types";
import type { Lang } from "../i18n-dict";
import { evaluateSleeping, westernBedCount } from "./sleeping";
import { haversineM, normalizeName, similarity } from "../parsing/text";
import { bestTransit, romaji } from "../transit";
import { bedName, label, msg } from "./messages";
import { fitsPlanRoom } from "./units";

/**
 * Filter statuses:
 *  PASS    – verified on the listing (green)
 *  WARN    – passes, but the evidence is indirect / estimated / not itemised (yellow, still counts as a match)
 *  FAIL    – the listing shows it does not meet the requirement (red; REQUIRED → rejected)
 *  UNKNOWN – the listing says nothing (REQUIRED → "needs review", never silently rejected)
 */

const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const ok = (likely: boolean): FilterStatus => (likely ? "WARN" : "PASS");
const q = (f: Fact<number>) => (f.qualifier === "atLeast" ? "≥" : "");

type M = ReturnType<typeof msg>;

function countCheck(m: M, lang: Lang, id: string, lbl: string, level: Level, fact: Fact<number>, min: number | null, exact: number | null, max: number | null, unitKey: string): FilterResult | null {
  if (level === "IGNORE" || (min == null && exact == null && max == null)) return null;
  const unit = m(unitKey);
  const req = exact != null ? `=${exact}` : min != null && max != null ? `${min}–${max}` : min != null ? `≥${min}` : `≤${max}`;
  const v = fact.value;
  if (v == null || fact.confidence === "UNKNOWN") return { id, label: label(lang, lbl), level, status: "UNKNOWN", text: m("countUnknown", { unit, req }) };
  const atLeast = fact.qualifier === "atLeast";
  const likely = fact.confidence !== "VERIFIED";
  let status: FilterStatus;
  if (exact != null) status = atLeast ? (v > exact ? "FAIL" : v === exact ? ok(true) : "UNKNOWN") : v === exact ? ok(likely) : "FAIL";
  else {
    const minOk = min == null || v >= min;
    const maxOk = max == null || v <= max;
    if (!maxOk && !atLeast) status = "FAIL";
    else if (!maxOk && atLeast) status = "FAIL";
    else if (minOk) status = ok(likely || (atLeast && max != null));
    else status = atLeast ? "UNKNOWN" : "FAIL";
  }
  return { id, label: label(lang, lbl), level, status, text: status === "FAIL" ? m("countNo", { v, unit, req }) : m("count", { q: q(fact), v, unit }) };
}

function amenityCheck(m: M, lang: Lang, id: string, lbl: string, level: Level, f: Fact<boolean> | undefined | null, override?: boolean | null): FilterResult | null {
  if (level === "IGNORE") return null;
  const name = label(lang, lbl);
  const v = override !== undefined ? override : f && f.confidence !== "CONFLICT" ? f.value : null;
  if (v == null) return { id, label: name, level, status: "UNKNOWN", text: m("hasUnknown", { x: name }) };
  if (!v) return { id, label: name, level, status: "FAIL", text: m("hasNo", { x: name }) };
  const likely = !!f && f.confidence !== "VERIFIED";
  return { id, label: name, level, status: ok(likely), text: m(likely ? "hasLikely" : "has", { x: name }) };
}

function timeToMin(t: string | null): number | null {
  if (!t) return null;
  const x = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!x) return null;
  let h = Number(x[1]);
  if (x[3]?.toUpperCase() === "PM" && h < 12) h += 12;
  if (x[3]?.toUpperCase() === "AM" && h === 12) h = 0;
  return h * 60 + Number(x[2]);
}

/** a detected type also satisfies its broader families (a Machiya is an Entire House; a Minshuku is a Guesthouse) */
function typeFamily(t: string): string[] {
  const f: Record<string, string[]> = {
    machiya: ["entire house", "vacation home"],
    townhouse: ["entire house", "vacation home"],
    "entire house": ["vacation home"],
    villa: ["entire house", "vacation home"],
    "vacation home": ["entire house"],
    minshuku: ["guesthouse", "homestay"],
    homestay: ["minshuku", "guesthouse"],
    guesthouse: ["minshuku"],
    "serviced apartment": ["apartment"],
    apartment: ["serviced apartment"],
    resort: ["hotel"],
  };
  return f[t.toLowerCase()] ?? [];
}

const coupleBedCount = (beds: Bed[]) => beds.filter((b) => COUPLE_BEDS.includes(b.type)).reduce((s, b) => s + b.count, 0);

/** Each planned room ("2 people: 1 double or 2 beds", "3 people: 3 beds") must be matched by a different booked unit. */
function roomPlanCheck(o: Offer, c: Criteria, m: M, lang: Lang): FilterResult | null {
  if (!c.roomPlan.length || c.roomPlanLevel === "IGNORE") return null;
  const lbl = label(lang, "Room plan");
  const units = (o.units ?? []).flatMap((u) => Array.from({ length: u.count }, () => u));
  if (!units.length || units.every((u) => !u.beds)) return { id: "roomplan", label: lbl, level: c.roomPlanLevel, status: "UNKNOWN", text: m("planUnknown") };
  const fits = (u: (typeof units)[number], p: Criteria["roomPlan"][number]) => fitsPlanRoom(u.beds, u.maxPeople, p) === true;
  // try every assignment of plan rooms to booked units (plans are tiny)
  const used = new Set<number>();
  const assign: string[] = [];
  const solve = (i: number): boolean => {
    if (i === c.roomPlan.length) return true;
    for (let k = 0; k < units.length; k++) {
      if (used.has(k) || !fits(units[k], c.roomPlan[i])) continue;
      used.add(k);
      assign[i] = m("planRoom", { g: c.roomPlan[i].guests, beds: `${units[k].name}: ${units[k].beds!.map((b) => `${b.count} ${bedName(b.type, lang)}`).join(" + ")}` });
      if (solve(i + 1)) return true;
      used.delete(k);
    }
    return false;
  };
  if (solve(0)) return { id: "roomplan", label: lbl, level: c.roomPlanLevel, status: "PASS", text: m("planOk", { plan: assign.join(" / ") }) };
  if (units.some((u) => !u.beds)) return { id: "roomplan", label: lbl, level: c.roomPlanLevel, status: "UNKNOWN", text: m("planUnknown") };
  const missing = c.roomPlan.filter((p) => !units.some((u) => fits(u, p))).map((p) => m("planMissing", { g: p.guests }));
  return { id: "roomplan", label: lbl, level: c.roomPlanLevel, status: "FAIL", text: m("planNo", { why: missing.join("; ") || assign.join(" / ") }) };
}

export function evaluateOffer(o: Offer, c: Criteria, lang: Lang = "en"): FilterResult[] {
  const m = msg(lang);
  const out: (FilterResult | null)[] = [];
  const guests = c.adults + c.children;
  const dates = `${md(c.checkIn)}–${md(c.checkOut)}`;

  // Availability
  {
    const av = o.availability;
    let status: FilterStatus = "UNKNOWN";
    let text = m("availUnknown");
    if (av.value === "AVAILABLE") {
      const confirmed = av.confidence === "VERIFIED";
      status = confirmed ? "PASS" : c.availabilityVerifiedOnly ? "UNKNOWN" : "WARN";
      text = m(confirmed ? "availOk" : "availLikely", { dates });
    } else if (av.value === "UNAVAILABLE") {
      status = "FAIL";
      text = m("availNo", { dates });
    }
    out.push({ id: "availability", label: label(lang, "Availability"), level: "REQUIRED", status, text });
  }

  // Capacity (rooms × occupancy stated by the site)
  if (o.maxGuests.value != null) {
    const v = o.maxGuests.value;
    out.push({ id: "capacity", label: label(lang, "Capacity"), level: "REQUIRED", status: v >= guests ? ok(o.maxGuests.confidence !== "VERIFIED") : "FAIL", text: v >= guests ? m("capacityOk", { v }) : m("capacityNo", { v, g: guests }) });
  }

  // Budget
  if (c.budget.level !== "IGNORE" && (c.budget.min != null || c.budget.max != null)) {
    const p = o.price;
    const v = c.budget.basis === "total" ? p.totalPrice : c.budget.basis === "night" ? p.pricePerNight : p.pricePerPerson;
    const basis = c.budget.basis === "total" ? "" : c.budget.basis === "night" ? "/" + label(lang, "night") : "/" + label(lang, "person");
    const range = `${c.budget.min != null ? c.budget.min.toLocaleString("en-US") : "0"}–${c.budget.max != null ? c.budget.max.toLocaleString("en-US") : "∞"}`;
    let status: FilterStatus = "UNKNOWN";
    let text = m("priceUnknown");
    if (v != null) {
      if (c.budget.max != null && v > c.budget.max) (status = "FAIL"), (text = m("priceOver", { cur: c.currency, v, basis, max: c.budget.max }));
      else if (c.budget.min != null && v < c.budget.min) (status = "FAIL"), (text = m("priceUnder", { cur: c.currency, v, basis, min: c.budget.min }));
      else {
        const soft = p.completeness !== "FULL" || p.estimatedConversion || p.confidence !== "VERIFIED";
        status = ok(soft);
        text = m("priceWithin", { cur: c.currency, v, basis, range }) + (p.completeness !== "FULL" ? m("pricePartial") : "") + (p.estimatedConversion ? m("priceEst") : "");
      }
    } else if (p.basePrice != null) {
      // only a pre-tax room price: above max is a definite fail, within is a yellow pass
      const base = c.budget.basis === "total" ? p.basePrice : c.budget.basis === "night" ? p.basePrice / p.nights : p.basePrice / Math.max(1, guests);
      if (c.budget.max != null && base > c.budget.max) (status = "FAIL"), (text = m("priceBaseOver", { cur: c.currency, v: base, max: c.budget.max }));
      else (status = "WARN"), (text = m("priceBaseWithin", { cur: c.currency, v: base }));
    }
    out.push({ id: "budget", label: label(lang, "Budget"), level: c.budget.level, status, text });
  }

  // Place / property type
  if (c.placeType.level !== "IGNORE" && c.placeType.entireOnly) {
    const e = o.entirePlace;
    out.push({
      id: "entire",
      label: label(lang, "Entire place only"),
      level: c.placeType.level,
      status: e.value == null ? "UNKNOWN" : e.value ? ok(e.confidence !== "VERIFIED") : "FAIL",
      text: m(e.value == null ? "entireUnknown" : e.value ? "entireYes" : "entireNo"),
    });
  }
  if (c.propertyTypes.length && c.propertyTypeLevel !== "IGNORE") {
    const t = o.propertyType;
    const wanted = c.propertyTypes.map((x) => x.toLowerCase());
    const detectedOk = t ? wanted.includes(t.toLowerCase()) || typeFamily(t).some((x) => wanted.includes(x)) : null;
    let st: FilterStatus;
    let text: string;
    if (o.platformTypes?.length) (st = "PASS"), (text = m("typePlatform", { t: o.platformTypes.map((x) => label(lang, x)).join("/") }));
    else if (t) (st = detectedOk ? "WARN" : "FAIL"), (text = detectedOk ? m("typeOk", { t: label(lang, t) }) : m("typeNo", { t: label(lang, t), want: c.propertyTypes.map((x) => label(lang, x)).join("/") }));
    else (st = "UNKNOWN"), (text = m("typeUnknown"));
    out.push({ id: "ptype", label: label(lang, "Property type"), level: c.propertyTypeLevel, status: st, text });
  }
  if (c.area.level !== "IGNORE" && c.area.minM2 != null) {
    const a = o.areaM2 ?? { value: null, confidence: "UNKNOWN" as const, evidence: [] };
    out.push({
      id: "area",
      label: label(lang, "Floor area"),
      level: c.area.level,
      status: a.value == null ? "UNKNOWN" : a.value >= c.area.minM2 ? "PASS" : a.qualifier === "atLeast" ? "UNKNOWN" : "FAIL",
      text: a.value == null ? m("areaUnknown") : a.value >= c.area.minM2 ? m("areaOk", { q: q(a), v: a.value }) : m("areaNo", { v: a.value, min: c.area.minM2 }),
    });
  }

  // Rooms / beds
  out.push(countCheck(m, lang, "bedrooms", "Bedrooms", c.bedrooms.level, o.bedrooms, c.bedrooms.min, c.bedrooms.exact, c.bedrooms.max, "bedrooms"));
  out.push(roomPlanCheck(o, c, m, lang));
  if (c.sleeping.level !== "IGNORE" && c.sleeping.couples > 0 && !c.roomPlan.length) {
    const s = evaluateSleeping(o, c);
    const why = s.explanation
      .map((x) => {
        const cm = x.match(/^Couple (\d+): no separate/);
        if (cm) return m("coupleNoRoom", { i: cm[1] });
        const cb = x.match(/^Couple (\d+): no /);
        if (cb) return m("coupleNoBed", { i: cb[1] });
        const gb = x.match(/^Guest (\d+): no /);
        if (gb) return m("guestNoBed", { i: gb[1] });
        return null;
      })
      .filter(Boolean)
      .join("; ");
    out.push({
      id: "sleeping",
      label: label(lang, "Couple sleeping"),
      level: c.sleeping.level,
      status: s.supported == null ? "UNKNOWN" : s.supported ? ok(o.beds.confidence !== "VERIFIED") : "FAIL",
      text: s.supported == null ? m("couplesUnknown", { c: c.sleeping.couples }) : s.supported ? m("couplesOk", { c: c.sleeping.couples }) : m("couplesNo", { c: c.sleeping.couples, why }),
    });
  }
  if (c.beds.level !== "IGNORE") {
    const beds = o.beds.value;
    const known = beds && !beds.some((b) => b.type === "unknown");
    const wb = westernBedCount(o);
    if (c.beds.minWestern != null) {
      out.push({
        id: "western",
        label: label(lang, "Western beds"),
        level: c.beds.level,
        status: wb == null ? "UNKNOWN" : wb >= c.beds.minWestern ? ok(o.beds.confidence !== "VERIFIED") : "FAIL",
        text: wb == null ? m("westernUnknown") : wb >= c.beds.minWestern ? m("westernOk", { v: wb }) : m("westernNo", { v: wb, min: c.beds.minWestern }),
      });
    }
    const typesText = beds ? [...new Set(beds.map((b) => bedName(b.type, lang)))].join(", ") : "";
    if (c.beds.types.length) {
      const has = beds?.some((b) => c.beds.types.includes(b.type));
      out.push({ id: "bedtypes", label: label(lang, "Bed types"), level: c.beds.level, status: !beds ? "UNKNOWN" : has ? "PASS" : known ? "FAIL" : "UNKNOWN", text: !beds ? m("bedTypesUnknown") : has ? m("bedTypesOk", { t: typesText }) : m("bedTypesNo", { t: typesText }) });
    }
    if (c.beds.westernOnly) {
      const only = beds?.every((b) => WESTERN_BEDS.includes(b.type));
      out.push({ id: "westernonly", label: label(lang, "Western beds only"), level: c.beds.level, status: !known ? "UNKNOWN" : only ? "PASS" : "FAIL", text: m(only ? "westernOnlyOk" : "westernOnlyNo") });
    }
    if (c.beds.coupleFriendly) {
      const need = Math.max(1, c.sleeping.couples);
      const nb = beds ? coupleBedCount(beds) : null;
      out.push({ id: "couplebeds", label: label(lang, "Couple-friendly beds"), level: c.beds.level === "REQUIRED" ? "REQUIRED" : "PREFERRED", status: nb == null ? "UNKNOWN" : nb >= need ? "PASS" : known ? "FAIL" : "UNKNOWN", text: m("coupleBeds", { v: nb ?? "?" }) });
    }
  }

  // Bathrooms / tubs
  out.push(countCheck(m, lang, "bathrooms", "Bathrooms", c.bathrooms.level, o.bathrooms, c.bathrooms.min, c.bathrooms.exact, null, "bathrooms"));
  if (c.bathrooms.minToilets != null) out.push(countCheck(m, lang, "toilets", "Toilets", c.bathrooms.level, o.toilets, c.bathrooms.minToilets, null, null, "toilets"));
  if (c.bathtubs.level !== "IGNORE" && c.bathtubs.min != null && c.bathtubs.min > 0) {
    const f = o.bathtubs;
    const min = c.bathtubs.min;
    let status: FilterStatus = "UNKNOWN";
    let text = m("tubUnknown", { min });
    if (f.value != null && f.confidence !== "UNKNOWN") {
      const atLeast = f.qualifier === "atLeast";
      if (f.value >= min) {
        if (f.confidence === "VERIFIED") (status = "PASS"), (text = m("tubOk", { q: q(f), v: f.value }));
        else if (c.bathtubs.requireVerified) (status = "UNKNOWN"), (text = m("tubNeedVerified", { q: q(f), v: f.value }));
        else (status = "WARN"), (text = m("tubLikely", { q: q(f), v: f.value }));
      } else if (f.value > 0 && (atLeast || f.confidence === "CONFLICT")) {
        // "has a bathtub" but the exact count is not stated: yellow pass unless a verified count is demanded
        status = c.bathtubs.requireVerified ? "UNKNOWN" : "WARN";
        text = m("tubSome", { v: f.value, min });
      } else if (!atLeast) (status = "FAIL"), (text = m("tubNo", { min, v: f.value }));
    }
    if (status === "UNKNOWN" && (o.platformFeatures ?? []).includes("bathtub") && !c.bathtubs.requireVerified && min <= 1) (status = "WARN"), (text = m("viaFilter", { x: label(lang, "Bathtubs") }));
    out.push({ id: "bathtubs", label: label(lang, "Bathtubs"), level: c.bathtubs.level, status, text });
  }

  // Station
  if (c.station.level !== "IGNORE" && c.station.maxWalkMinutes != null) {
    const s = o.station.value;
    const max = c.station.maxWalkMinutes;
    let status: FilterStatus = "UNKNOWN";
    let text = m("stationUnknown");
    if (s) {
      const name = s.name;
      if (s.walkMinutes != null && !s.estimated) (status = s.walkMinutes <= max ? "PASS" : "FAIL"), (text = s.walkMinutes <= max ? m("stationOk", { name, m: s.walkMinutes }) : m("stationNo", { name, m: s.walkMinutes, max }));
      else if (s.distanceM != null) {
        // walking time from the listed distance at 80 m/min (Japanese real-estate standard), marked yellow
        const est = Math.ceil(s.distanceM / 80);
        if (est <= max) (status = "WARN"), (text = m("stationEst", { name, m: est, d: s.distanceM }));
        else if (est > max * 1.5) (status = "FAIL"), (text = m("stationNo", { name, m: `~${est}`, max }));
        else text = m("stationDistOnly", { name, d: s.distanceM });
      } else text = m("stationUnknown");
    }
    out.push({ id: "station", label: label(lang, "Station walk"), level: c.station.level, status, text });
  }

  // Transit (listing-stated only)
  if (c.transit.level !== "IGNORE" && c.transit.targets.length && c.transit.maxMinutes != null) {
    const targets = c.transit.targets.map(romaji);
    const st = o.station.value;
    const walk = st ? (st.walkMinutes ?? (st.distanceM != null ? Math.ceil(st.distanceM / 80) : null)) : null;
    const nearestIsTarget = st && walk != null && walk <= c.transit.maxMinutes && targets.some((t) => romaji(st.name).includes(t) || t.includes(romaji(st.name)));
    const best = bestTransit(o, c.transit.targets, c.transit.mode);
    let status: FilterStatus = "UNKNOWN";
    let text = m("transitUnknown");
    if (nearestIsTarget) (status = "PASS"), (text = m("transitTarget", { name: st!.name }));
    else if (best) (status = best.minutes <= c.transit.maxMinutes ? "PASS" : "FAIL"), (text = m(best.minutes <= c.transit.maxMinutes ? "transitOk" : "transitNo", { m: best.minutes, mode: best.mode, to: best.target, max: c.transit.maxMinutes }));
    out.push({ id: "transit", label: label(lang, "Transit to target"), level: c.transit.level, status, text });
  }

  // Distance
  if (c.distance.level !== "IGNORE") {
    if (c.distance.maxCenterKm != null) {
      const d = o.centerDistanceM;
      out.push({ id: "center", label: label(lang, "City center distance"), level: c.distance.level, status: d == null ? "UNKNOWN" : d <= c.distance.maxCenterKm * 1000 ? "PASS" : "FAIL", text: d == null ? m("centerUnknown") : m("centerOk", { km: (d / 1000).toFixed(1) }) });
    }
    if (c.distance.maxAttractionKm != null)
      for (const a of c.distance.attractions) {
        const l = o.landmarks.filter((x) => similarity(normalizeName(x.name), normalizeName(a)) > 0.55 || x.name.toLowerCase().includes(a.toLowerCase())).sort((x, y) => x.distanceM - y.distanceM)[0];
        out.push({ id: `attr:${a}`, label: a, level: c.distance.level, status: !l ? "UNKNOWN" : l.distanceM <= c.distance.maxAttractionKm * 1000 ? "PASS" : "FAIL", text: !l ? m("attrUnknown", { a }) : m("attrOk", { a, km: (l.distanceM / 1000).toFixed(1) }) });
      }
  }

  // Reviews
  if (c.reviews.ratingLevel !== "IGNORE" && c.reviews.minRating10 != null) {
    const r = o.rating.value;
    const min = ((c.reviews.minRating10 * (r?.scale ?? 10)) / 10).toFixed(1);
    out.push({ id: "rating", label: label(lang, "Rating"), level: c.reviews.ratingLevel, status: !r ? "UNKNOWN" : r.normalized >= c.reviews.minRating10 ? "PASS" : "FAIL", text: !r ? m("ratingUnknown") : r.normalized >= c.reviews.minRating10 ? m("ratingOk", { raw: r.raw, scale: r.scale }) : m("ratingNo", { raw: r.raw, scale: r.scale, min }) });
  }
  const minCount = c.reviews.establishedOnly ? Math.max(50, c.reviews.minCount ?? 0) : c.reviews.minCount;
  const countLevel: Level = c.reviews.establishedOnly ? "REQUIRED" : c.reviews.countLevel;
  if (countLevel !== "IGNORE" && minCount != null) {
    const v = o.reviewCount.value;
    out.push({ id: "reviews", label: label(lang, "Review count"), level: countLevel, status: v == null ? "UNKNOWN" : v >= minCount ? "PASS" : "FAIL", text: v == null ? m("reviewsUnknown") : v >= minCount ? m("reviewsOk", { v }) : m("reviewsNo", { v, min: minCount }) });
  }

  // Amenities & policies
  const A = (k: AmenityKey) => o.amenities[k];
  for (const a of c.amenities) out.push(amenityCheck(m, lang, `amenity:${a.key}`, AMENITY_LABEL[a.key], a.level, A(a.key)));
  if (c.laundry.washer !== "IGNORE") {
    const shared = A("washer")?.note === "shared";
    const r = amenityCheck(m, lang, "washer", "Washing machine", c.laundry.washer, A("washer"), c.laundry.privateOnly && shared ? false : undefined);
    if (r && c.laundry.privateOnly && shared) r.text = m("washerShared");
    out.push(r);
  }
  out.push(amenityCheck(m, lang, "dryer", "Dryer", c.laundry.dryer, A("dryer")));
  if (c.kitchen.required !== "IGNORE") {
    const k = A("kitchen");
    const ke = A("kitchenette");
    const useKe = !k?.value && c.kitchen.kitchenetteOk && ke?.value;
    out.push(amenityCheck(m, lang, "kitchen", "Kitchen", c.kitchen.required, useKe ? ke : k));
  }
  out.push(amenityCheck(m, lang, "cookware", "Cookware", c.kitchen.cookware, A("cookware")));
  out.push(amenityCheck(m, lang, "elevator", "Elevator", c.accessibility.elevator, A("elevator")));
  out.push(amenityCheck(m, lang, "wheelchair", "Wheelchair accessible", c.accessibility.wheelchair, A("wheelchair")));
  out.push(amenityCheck(m, lang, "groundfloor", "Ground floor bedroom", c.accessibility.groundFloor, A("ground_floor")));
  out.push(amenityCheck(m, lang, "accbath", "Accessible bathroom", c.accessibility.accessibleBathroom, A("accessible_bathroom")));
  out.push(amenityCheck(m, lang, "nonsmoking", "Non-smoking", c.nonSmoking, A("non_smoking")));
  out.push(amenityCheck(m, lang, "selfcheckin", "Self check-in", c.selfCheckIn, A("self_checkin")));
  out.push(amenityCheck(m, lang, "luggage", "Luggage storage", c.luggageStorage, A("luggage_storage")));

  const cx = o.cancellation;
  const fc = amenityCheck(m, lang, "freecancel", "Free cancellation", c.cancellation.freeCancellation, null, cx.freeCancellation);
  if (fc && cx.freeCancellation && cx.deadline) fc.text = m("freeCancelUntil", { d: cx.deadline });
  out.push(fc);
  out.push(amenityCheck(m, lang, "paylater", "Pay later", c.cancellation.payLater, null, cx.payLater));
  out.push(amenityCheck(m, lang, "noprepay", "No prepayment", c.cancellation.noPrepayment, null, cx.noPrepayment));
  out.push(amenityCheck(m, lang, "refundable", "Refundable", c.cancellation.refundable, null, cx.refundable));
  const bf = amenityCheck(m, lang, "breakfast", "Breakfast included", c.meals.breakfast, null, o.breakfast);
  if (bf && bf.status === "UNKNOWN" && (o.platformFeatures ?? []).includes("breakfast")) (bf.status = "WARN"), (bf.text = m("viaFilter", { x: label(lang, "Breakfast included") }));
  out.push(bf);
  out.push(amenityCheck(m, lang, "dinner", "Dinner included", c.meals.dinner, null, o.dinner));

  if (c.checkInOut.level !== "IGNORE") {
    const ci = timeToMin(o.checkInTime);
    const co = timeToMin(o.checkOutTime);
    if (c.checkInOut.earliestCheckIn) {
      const want = timeToMin(c.checkInOut.earliestCheckIn)!;
      out.push({ id: "ci", label: label(lang, "Earliest check-in"), level: c.checkInOut.level, status: ci == null ? "UNKNOWN" : ci <= want ? "PASS" : "FAIL", text: ci == null ? m("timeUnknown") : m("ciOk", { t: o.checkInTime }) });
    }
    if (c.checkInOut.latestCheckOut) {
      const want = timeToMin(c.checkInOut.latestCheckOut)!;
      out.push({ id: "co", label: label(lang, "Latest check-out"), level: c.checkInOut.level, status: co == null ? "UNKNOWN" : co >= want ? "PASS" : "FAIL", text: co == null ? m("timeUnknown") : m("coOk", { t: o.checkOutTime }) });
    }
  }
  return out.filter((x): x is FilterResult => !!x);
}

/** Only a definite FAIL on a REQUIRED filter rejects. Missing information never rejects (unless the user chose so). */
export function classify(filters: FilterResult[], c: Criteria): { status: ResultStatus; reasons: string[] } {
  const fails = filters.filter((f) => f.level === "REQUIRED" && f.status === "FAIL").map((f) => f.text);
  if (fails.length) return { status: "REJECTED", reasons: fails };
  const unknown = filters.filter((f) => f.level === "REQUIRED" && f.status === "UNKNOWN").map((f) => f.text);
  if (unknown.length) return { status: c.unknownRequiredPolicy === "reject" ? "REJECTED" : "REVIEW", reasons: unknown };
  return { status: "MATCHED", reasons: [] };
}

export function trustScore(offers: Offer[]): Trust {
  const reasons: string[] = [];
  let score = 0;
  const reviews = Math.max(0, ...offers.map((o) => o.reviewCount.value ?? 0));
  const rating = Math.max(0, ...offers.map((o) => o.rating.value?.normalized ?? 0));
  const r = offers.find((o) => o.rating.value)?.rating.value;
  if (reviews >= 200) (score += 3), reasons.push(`${reviews} reviews`);
  else if (reviews >= 50) (score += 2), reasons.push(`${reviews} reviews`);
  else if (reviews >= 10) (score += 1), reasons.push(`${reviews} reviews`);
  else reasons.push(reviews ? `only ${reviews} reviews` : "review count unknown");
  if (rating >= 9) (score += 2), reasons.push(`rating ${r?.raw}/${r?.scale}`);
  else if (rating >= 8) (score += 1), reasons.push(`rating ${r?.raw}/${r?.scale}`);
  else if (rating > 0) reasons.push(`rating ${r?.raw}/${r?.scale} (below 8/10)`);
  const seen = new Set<string>();
  for (const o of offers)
    for (const s of o.trustSignals) {
      if (seen.has(s.label)) continue;
      seen.add(s.label);
      score += s.weight;
      reasons.push(s.label);
    }
  const platforms = new Set(offers.map((o) => o.provider)).size;
  if (platforms > 1) (score += 1), reasons.push(`listed on ${platforms} platforms`);
  return { level: score >= 6 ? "HIGH" : score >= 3 ? "MEDIUM" : "LOW", score, reasons };
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const credit = (s: FilterStatus) => (s === "PASS" ? 1 : s === "WARN" ? 0.7 : s === "UNKNOWN" ? 0.3 : 0);

function scoreOffer(o: Offer, filters: FilterResult[], c: Criteria, priceRange: [number, number]) {
  const counted = filters.filter((f) => f.level !== "IGNORE");
  const hard = counted.length ? counted.reduce((s, f) => s + credit(f.status), 0) / counted.length : 0.5;
  const total = o.price.totalPrice ?? o.price.basePrice;
  const [lo, hi] = priceRange;
  const price = total == null ? 0.2 : hi > lo ? clamp(1 - (total - lo) / (hi - lo)) : 1;
  const st = o.station.value;
  const walk = st?.walkMinutes ?? (st?.distanceM != null ? st.distanceM / 80 : null);
  const location = walk == null ? 0.3 : clamp(1 - (walk - 5) / 15);
  const guests = c.adults + c.children;
  const wb = westernBedCount(o);
  const beds = wb == null ? 0.3 : clamp(wb / guests);
  const bathNeed = Math.max(1, c.bathrooms.min ?? 1);
  const tubNeed = Math.max(1, c.bathtubs.min ?? 1);
  const baths = ((o.bathrooms.value == null ? 0.3 : clamp(o.bathrooms.value / bathNeed)) + (o.bathtubs.value == null ? 0.2 : clamp(o.bathtubs.value / tubNeed) * (o.bathtubs.confidence === "VERIFIED" ? 1 : 0.7))) / 2;
  const rating = o.rating.value ? clamp((o.rating.value.normalized - 7) / 3) : 0.3;
  const reviews = o.reviewCount.value ? clamp(Math.log10(o.reviewCount.value) / 3) : 0.1;
  const cancellation = o.cancellation.freeCancellation === true ? 1 : o.cancellation.freeCancellation === false ? 0 : 0.4;
  const parts = { hard, price, location, beds, baths, rating, reviews, cancellation };
  const w = c.weights;
  const wsum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  let s = 0;
  const breakdown: Record<string, number> = {};
  for (const [k, v] of Object.entries(parts)) {
    const contrib = (v * (w as Record<string, number>)[k]) / wsum;
    breakdown[k] = Math.round(contrib * 1000) / 10;
    s += contrib;
  }
  return { score: Math.round(s * 1000) / 10, breakdown };
}

/** Cross-platform dedupe: name similarity, coordinates, address. */
export function groupOffers(offers: Offer[]): Offer[][] {
  const groups: { key: string; lat: number | null; lng: number | null; addr: string; offers: Offer[] }[] = [];
  for (const o of offers) {
    const key = normalizeName(o.name);
    const addr = normalizeName(o.address ?? "");
    let g = groups.find((g) => {
      if (g.offers.some((x) => x.provider === o.provider && x.providerPropertyId === o.providerPropertyId)) return true;
      if (g.offers.some((x) => x.provider === o.provider)) return false;
      const sim = similarity(g.key, key);
      const near = g.lat != null && o.latitude != null ? haversineM(g.lat, g.lng!, o.latitude, o.longitude!) < 150 : null;
      if (near === false) return false;
      if (sim >= 0.85) return true;
      if (near && sim >= 0.5) return true;
      if (addr && g.addr && addr.length > 12 && similarity(addr, g.addr) > 0.9 && sim >= 0.4) return true;
      return false;
    });
    if (!g) {
      g = { key, lat: o.latitude, lng: o.longitude, addr, offers: [] };
      groups.push(g);
    }
    const dup = g.offers.findIndex((x) => x.provider === o.provider && x.providerPropertyId === o.providerPropertyId);
    if (dup >= 0) g.offers[dup] = o;
    else g.offers.push(o);
    if (g.lat == null && o.latitude != null) (g.lat = o.latitude), (g.lng = o.longitude);
  }
  return groups.map((g) => g.offers);
}

const STATUS_RANK: Record<ResultStatus, number> = { MATCHED: 0, REVIEW: 1, REJECTED: 2 };

export function buildResults(offers: Offer[], c: Criteria, lang: Lang = "en"): PropertyResult[] {
  const prices = offers.map((o) => o.price.totalPrice).filter((x): x is number => x != null);
  const range: [number, number] = [c.budget.min ?? (prices.length ? Math.min(...prices) : 0), c.budget.max ?? (prices.length ? Math.max(...prices) : 0)];
  return groupOffers(offers).map((group) => {
    const evals = group.map((o) => {
      const filters = evaluateOffer(o, c, lang);
      return { o, filters, cls: classify(filters, c), sc: scoreOffer(o, filters, c, range) };
    });
    evals.sort((a, b) => STATUS_RANK[a.cls.status] - STATUS_RANK[b.cls.status] || b.sc.score - a.sc.score);
    const best = evals[0];
    const o = best.o;
    const counted = best.filters.filter((f) => f.level !== "IGNORE");
    return {
      id: `${o.provider}:${o.providerPropertyId}`,
      name: o.name,
      normalizedName: normalizeName(o.name),
      address: o.address,
      latitude: o.latitude,
      longitude: o.longitude,
      propertyType: o.propertyType,
      offers: group,
      primary: group.indexOf(o),
      status: best.cls.status,
      stage: o.detailVerified ? "detail" : "cheap",
      filters: best.filters,
      matchCount: counted.filter((f) => f.status === "PASS" || f.status === "WARN").length,
      matchTotal: counted.length,
      score: best.cls.status === "REJECTED" ? 0 : best.sc.score,
      scoreBreakdown: best.sc.breakdown,
      trust: trustScore(group),
      sleeping: evaluateSleeping(o, c),
      rejectReasons: best.cls.reasons,
    } satisfies PropertyResult;
  });
}

/** Stage 4 cheap filter on search-card data: only definite REQUIRED failures drop a candidate before its detail page. */
export function cheapFilter(o: Offer, c: Criteria): string[] {
  const ids = ["budget", "rating", "reviews", "bedrooms", "bathrooms", "availability", "entire", "capacity", "ptype"];
  return evaluateOffer(o, c)
    .filter((f) => ids.includes(f.id) && f.level === "REQUIRED" && f.status === "FAIL")
    .map((f) => f.text);
}

export function computeStats(results: PropertyResult[]): JobStats {
  const offers = results.flatMap((r) => r.offers);
  const rejectedBy: Record<string, number> = {};
  for (const r of results) if (r.status === "REJECTED") for (const f of r.filters) if (f.level === "REQUIRED" && f.status === "FAIL") rejectedBy[f.id] = (rejectedBy[f.id] ?? 0) + 1;
  return {
    searched: offers.length,
    available: offers.filter((o) => o.availability.value === "AVAILABLE").length,
    detailVerified: offers.filter((o) => o.detailVerified).length,
    matched: results.filter((r) => r.status === "MATCHED").length,
    review: results.filter((r) => r.status === "REVIEW").length,
    rejected: results.filter((r) => r.status === "REJECTED").length,
    rejectedBy,
  };
}
