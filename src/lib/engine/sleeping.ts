import type { Bed, BedType, Criteria, Offer, SleepingResult } from "../types";
import { COUPLE_BEDS, WESTERN_BEDS } from "../types";

/**
 * Sleeping Requirement Engine.
 * Couples need one Double/Queen/King, or two single-type beds when allowed.
 * Remaining guests need one bed slot each from the user's accepted bed types.
 * Bed counts only; bedroom count is never inferred from beds.
 */
export function evaluateSleeping(offer: Offer, c: Criteria): SleepingResult {
  const guests = c.adults + c.children;
  const beds: Bed[] | null = offer.beds.value;
  if (!beds || beds.length === 0 || beds.some((b) => b.type === "unknown")) {
    return { supported: null, westernSlots: 0, explanation: ["bed configuration unknown"] };
  }
  if (c.sleeping.coupleSeparateBedrooms && c.sleeping.couples > 0) {
    const r = separateBedrooms(offer, c);
    if (r) return r;
  }
  const pool = new Map<BedType, number>();
  for (const b of beds) pool.set(b.type, (pool.get(b.type) ?? 0) + b.count);
  const take = (t: BedType, n = 1) => {
    const have = pool.get(t) ?? 0;
    if (have < n) return false;
    pool.set(t, have - n);
    return true;
  };
  const westernSlots = beds.reduce((s, b) => s + (WESTERN_BEDS.includes(b.type) ? b.count * (COUPLE_BEDS.includes(b.type) ? 2 : 1) : 0), 0);
  const explanation: string[] = [];
  let ok = true;

  for (let i = 1; i <= c.sleeping.couples; i++) {
    const big = (["king", "queen", "double"] as BedType[]).find((t) => (pool.get(t) ?? 0) > 0);
    if (big) {
      take(big);
      explanation.push(`Couple ${i}: 1 ${big}`);
      continue;
    }
    if (c.sleeping.allowTwoSinglesForCouple) {
      const singles = (["single", "semi-double"] as BedType[]).reduce((s, t) => s + (pool.get(t) ?? 0), 0);
      if (singles >= 2) {
        let need = 2;
        for (const t of ["single", "semi-double"] as BedType[]) {
          while (need > 0 && take(t)) need--;
        }
        explanation.push(`Couple ${i}: 2 singles`);
        continue;
      }
    }
    ok = false;
    explanation.push(`Couple ${i}: no suitable bed`);
  }

  const others = Math.max(0, guests - c.sleeping.couples * 2);
  const order: BedType[] = ["single", "semi-double", "double", "queen", "king", "sofa", "futon", "tatami", "bunk"];
  for (let g = 1; g <= others; g++) {
    const t = order.find((x) => c.sleeping.extraGuestBeds.includes(x) && (pool.get(x) ?? 0) > 0);
    if (t) {
      take(t);
      explanation.push(`Guest ${c.sleeping.couples * 2 + g}: ${t}`);
    } else {
      ok = false;
      explanation.push(`Guest ${c.sleeping.couples * 2 + g}: no accepted bed`);
    }
  }
  return { supported: ok, westernSlots, explanation };
}

/**
 * Each couple in its own bedroom: needs the per-room bed layout. Returns UNKNOWN when the
 * listing does not say which bed is in which room. Living rooms do not count as bedrooms.
 */
function separateBedrooms(offer: Offer, c: Criteria): SleepingResult | null {
  const layouts = offer.rooms;
  const westernSlots = (offer.beds.value ?? []).reduce((s, b) => s + (WESTERN_BEDS.includes(b.type) ? b.count * (COUPLE_BEDS.includes(b.type) ? 2 : 1) : 0), 0);
  if (!layouts.length) return { supported: null, westernSlots, explanation: ["per-bedroom bed layout not stated – separate bedrooms for couples cannot be verified"] };
  const bedrooms = layouts.filter((r) => !/living|lounge|common|リビング|客廳/i.test(r.name));
  const used = new Set<number>();
  const explanation: string[] = [];
  let ok = true;
  const roomPool = layouts.map((r) => {
    const m = new Map<BedType, number>();
    for (const b of r.beds) m.set(b.type, (m.get(b.type) ?? 0) + b.count);
    return m;
  });
  for (let i = 1; i <= c.sleeping.couples; i++) {
    let found = -1;
    for (let k = 0; k < layouts.length; k++) {
      if (used.has(k) || !bedrooms.includes(layouts[k])) continue;
      const m = roomPool[k];
      const big = (["king", "queen", "double"] as BedType[]).find((t) => (m.get(t) ?? 0) > 0);
      if (big) {
        m.set(big, (m.get(big) ?? 0) - 1);
        explanation.push(`Couple ${i}: ${layouts[k].name} – 1 ${big}`);
        found = k;
        break;
      }
      const singles = (m.get("single") ?? 0) + (m.get("semi-double") ?? 0);
      if (c.sleeping.allowTwoSinglesForCouple && singles >= 2) {
        let need = 2;
        for (const t of ["single", "semi-double"] as BedType[]) while (need > 0 && (m.get(t) ?? 0) > 0) (m.set(t, (m.get(t) ?? 0) - 1), need--);
        explanation.push(`Couple ${i}: ${layouts[k].name} – 2 singles`);
        found = k;
        break;
      }
    }
    if (found < 0) {
      ok = false;
      explanation.push(`Couple ${i}: no separate bedroom with a suitable bed`);
    } else used.add(found);
  }
  // remaining guests may use any remaining accepted bed in any room
  const rest = new Map<BedType, number>();
  for (const m of roomPool) for (const [t, n] of m) rest.set(t, (rest.get(t) ?? 0) + n);
  const others = Math.max(0, c.adults + c.children - c.sleeping.couples * 2);
  const order: BedType[] = ["single", "semi-double", "double", "queen", "king", "sofa", "futon", "tatami", "bunk"];
  for (let g = 1; g <= others; g++) {
    const t = order.find((x) => c.sleeping.extraGuestBeds.includes(x) && (rest.get(x) ?? 0) > 0);
    if (t) (rest.set(t, (rest.get(t) ?? 0) - 1), explanation.push(`Guest ${c.sleeping.couples * 2 + g}: ${t}`));
    else (ok = false), explanation.push(`Guest ${c.sleeping.couples * 2 + g}: no accepted bed`);
  }
  return { supported: ok, westernSlots, explanation };
}

export function westernBedCount(offer: Offer): number | null {
  const beds = offer.beds.value;
  if (!beds || beds.some((b) => b.type === "unknown")) return null;
  return beds.reduce((s, b) => s + (WESTERN_BEDS.includes(b.type) ? b.count : 0), 0);
}

export function bedSummary(beds: Bed[] | null): string {
  if (!beds?.length) return "UNKNOWN";
  return beds.map((b) => `${b.count} ${b.type}`).join(" + ");
}
