import type { Criteria, Offer } from "./types";

export interface TransitEstimate {
  target: string;
  minutes: number;
  mode: string;
  source: string;
  raw: string;
}

/**
 * Transit time from a property to a target area. Implementations must return null instead of guessing.
 * Future: Google Maps / Navitime / Yahoo Transit / OpenStreetMap routing providers.
 */
export interface TransitProvider {
  id: string;
  estimate(offer: Offer, target: string, mode: Criteria["transit"]["mode"]): TransitEstimate | null;
}

/** Uses only transit statements written on the listing itself (e.g. "8 mins by Subway to Shijo Station"). */
export const ListingTextTransitProvider: TransitProvider = {
  id: "listing-text",
  estimate(offer, target, mode) {
    const t = romaji(target);
    const hits = offer.transitHits.filter(
      (h) => romaji(h.target).includes(t) && (mode === "any" || h.mode.includes(mode) || (mode === "train" && /jr|rail|電車/.test(h.mode))),
    );
    const best = hits.sort((a, b) => a.minutes - b.minutes)[0];
    return best ? { target, minutes: best.minutes, mode: best.mode, source: "listing", raw: best.raw } : null;
  },
};

export const TRANSIT_PROVIDERS: TransitProvider[] = [ListingTextTransitProvider];

export function bestTransit(offer: Offer, targets: string[], mode: Criteria["transit"]["mode"]): TransitEstimate | null {
  let best: TransitEstimate | null = null;
  for (const p of TRANSIT_PROVIDERS)
    for (const target of targets) {
      const e = p.estimate(offer, target, mode);
      if (e && (!best || e.minutes < best.minutes)) best = e;
    }
  return best;
}

/** Loose romanization match: "Shijō" / "Sijyo" / "Shijo" → "shijo" */
export function romaji(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s*(station|sta\.|駅|站)\s*$/, "")
    .replace(/jy/g, "j")
    .replace(/sy/g, "sh")
    .replace(/ty/g, "ch")
    .replace(/\bsi/g, "shi")
    .replace(/ou/g, "o")
    .replace(/oo/g, "o")
    .replace(/[^a-z0-9一-龯ぁ-んァ-ヶ]/g, "");
}
