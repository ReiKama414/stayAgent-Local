import type { Bed, Confidence, Fact, Offer, RoomLayout } from "../types";
import { unknownFact } from "../types";

export interface UnitOption<T> {
  key: string;
  name: string;
  maxPeople: number | null;
  /** how many of this unit the site lets you select */
  available: number;
  /** price for ONE unit for the whole stay */
  price: number | null;
  data: T;
}

export interface UnitPick<T> {
  opt: UnitOption<T>;
  count: number;
}

/**
 * Choose exactly `rooms` units (room types may be mixed) so that total capacity ≥ guests and
 * no type exceeds its selectable count. Cheapest combination wins; unknown prices sort last.
 */
export function chooseUnits<T>(options: UnitOption<T>[], guests: number, rooms: number): UnitPick<T>[] | null {
  const opts = options
    .filter((o) => o.available > 0 && o.maxPeople != null && o.maxPeople > 0)
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    .slice(0, 14);
  let best: { picks: UnitPick<T>[]; price: number } | null = null;
  const counts = new Array(opts.length).fill(0);
  const walk = (i: number, left: number, cap: number, price: number) => {
    if (best && price >= best.price) return;
    if (left === 0) {
      if (cap >= guests) best = { picks: opts.map((o, k) => ({ opt: o, count: counts[k] })).filter((p) => p.count > 0), price };
      return;
    }
    if (i >= opts.length) return;
    const o = opts[i];
    for (let n = Math.min(left, o.available); n >= 0; n--) {
      counts[i] = n;
      walk(i + 1, left - n, cap + n * (o.maxPeople ?? 0), price + n * (o.price ?? 1e12));
    }
    counts[i] = 0;
  };
  walk(0, Math.max(1, rooms), 0, 0);
  return best ? (best as { picks: UnitPick<T>[] }).picks : null;
}

export interface PlanRoom {
  guests: number;
  minBeds: number;
  coupleBedOk: boolean;
}

const WEST = ["single", "semi-double", "double", "queen", "king"];
const COUPLE = ["double", "queen", "king"];

/** A unit fits a planned room: capacity, and either enough beds or (when allowed) one double-size bed. Unknown beds => null. */
export function fitsPlanRoom(beds: Bed[] | null | undefined, maxPeople: number | null, p: PlanRoom): boolean | null {
  if (maxPeople != null && maxPeople < p.guests) return false;
  if (!beds || !beds.length || beds.some((b) => b.type === "unknown")) return null;
  const n = beds.filter((b) => WEST.includes(b.type)).reduce((s, b) => s + b.count, 0);
  const big = beds.filter((b) => COUPLE.includes(b.type)).reduce((s, b) => s + b.count, 0);
  return n >= p.minBeds || (p.coupleBedOk && big >= 1 && p.guests <= 2);
}

/**
 * One unit per planned room, each fitting its room (beds known & matching preferred; unknown beds allowed
 * as a fallback so the detail evaluation can mark it UNKNOWN), respecting each type's selectable count.
 */
export function chooseUnitsForPlan<T>(options: (UnitOption<T> & { beds?: Bed[] | null })[], plan: PlanRoom[]): UnitPick<T>[] | null {
  const opts = options.filter((o) => o.available > 0).sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity)).slice(0, 20);
  let best: { picks: number[]; price: number; unknown: number } | null = null;
  const used = new Map<number, number>();
  const chosen: number[] = [];
  const walk = (i: number, price: number, unknown: number) => {
    if (best && (unknown > best.unknown || (unknown === best.unknown && price >= best.price))) return;
    if (i === plan.length) {
      best = { picks: [...chosen], price, unknown };
      return;
    }
    for (let k = 0; k < opts.length; k++) {
      const o = opts[k];
      if ((used.get(k) ?? 0) >= o.available) continue;
      const f = fitsPlanRoom(o.beds, o.maxPeople, plan[i]);
      if (f === false) continue;
      used.set(k, (used.get(k) ?? 0) + 1);
      chosen.push(k);
      walk(i + 1, price + (o.price ?? 1e12), unknown + (f === null ? 1 : 0));
      chosen.pop();
      used.set(k, (used.get(k) ?? 1) - 1);
    }
  };
  walk(0, 0, 0);
  if (!best) return null;
  const counts = new Map<number, number>();
  for (const k of (best as { picks: number[] }).picks) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts.entries()].map(([k, count]) => ({ opt: opts[k], count }));
}

const RANK: Record<Confidence, number> = { VERIFIED: 0, LIKELY: 1, CONFLICT: 2, UNKNOWN: 3 };
const worst = (cs: Confidence[]): Confidence => cs.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "VERIFIED" as Confidence);

/** Sum a count fact over units (× count). A unit without a value makes the total a lower bound. */
export function sumFact(parts: { fact: Fact<number>; count: number; name: string }[], field: string): Fact<number> {
  const known = parts.filter((p) => p.fact.value != null && p.fact.confidence !== "UNKNOWN");
  if (!known.length) return unknownFact(`${field} unknown for every unit`);
  const value = known.reduce((s, p) => s + (p.fact.value as number) * p.count, 0);
  const missing = parts.length - known.length;
  const evidence = parts.flatMap((p) => p.fact.evidence.map((e) => ({ ...e, parsed: `${p.count}× ${p.name}: ${e.parsed ?? ""}` })));
  return {
    value,
    qualifier: missing || known.some((p) => p.fact.qualifier === "atLeast") ? "atLeast" : "exact",
    confidence: missing ? "LIKELY" : worst(known.map((p) => p.fact.confidence)),
    evidence,
    note: parts.length > 1 || parts[0]?.count > 1 ? `sum over ${parts.map((p) => `${p.count}× ${p.name}`).join(" + ")}${missing ? ` (${missing} unit type(s) unknown)` : ""}` : undefined,
  };
}

/** Combine per-unit facts into the offer (beds/bedrooms/bathrooms/toilets/bathtubs/capacity). */
export function applyUnits(offer: Offer, units: { part: Offer; count: number; name: string; maxPeople: number | null; price: number | null }[]) {
  const P = (f: (o: Offer) => Fact<number>) => units.map((u) => ({ fact: f(u.part), count: u.count, name: u.name }));
  offer.bedrooms = sumFact(P((o) => o.bedrooms), "bedrooms");
  offer.bathrooms = sumFact(P((o) => o.bathrooms), "bathrooms");
  offer.toilets = sumFact(P((o) => o.toilets), "toilets");
  offer.bathtubs = sumFact(P((o) => o.bathtubs), "bathtubs");
  offer.areaM2 = sumFact(P((o) => o.areaM2), "area");

  const beds: Bed[] = [];
  const rooms: RoomLayout[] = [];
  let bedsKnown = true;
  for (const u of units) {
    if (!u.part.beds.value) bedsKnown = false;
    for (let i = 0; i < u.count; i++) {
      for (const b of u.part.beds.value ?? []) beds.push({ ...b });
      const tag = u.count > 1 ? `${u.name} #${i + 1}` : u.name;
      if (u.part.rooms.length) for (const r of u.part.rooms) rooms.push({ name: `${tag} · ${r.name}`, beds: r.beds });
      else if (u.part.beds.value) rooms.push({ name: tag, beds: u.part.beds.value });
    }
  }
  if (!bedsKnown) beds.push({ type: "unknown", count: 1, raw: "a unit's beds are not stated" });
  offer.beds = beds.length
    ? { value: beds, confidence: bedsKnown ? worst(units.map((u) => u.part.beds.confidence)) : "LIKELY", evidence: units.flatMap((u) => u.part.beds.evidence), note: units.length > 1 || units[0].count > 1 ? "beds of all booked units" : undefined }
    : unknownFact();
  offer.rooms = rooms;

  const cap = units.every((u) => u.maxPeople != null) ? units.reduce((s, u) => s + (u.maxPeople as number) * u.count, 0) : null;
  if (cap != null) offer.maxGuests = { value: cap, confidence: "VERIFIED", qualifier: "exact", evidence: units.flatMap((u) => u.part.maxGuests.evidence), note: units.length > 1 || units[0].count > 1 ? "total of booked units" : undefined };
  offer.units = units.map((u) => ({ name: u.name, count: u.count, maxPeople: u.maxPeople, price: u.price, beds: u.part.beds.value }));
  offer.roomName = units.map((u) => (u.count > 1 ? `${u.count}× ${u.name}` : u.name)).join(" + ");
}
