import {
  AMENITIES,
  type AmenityKey,
  type Bed,
  type BedType,
  type Cancellation,
  type Evidence,
  type EvidenceSource,
  type Fact,
  type ProviderId,
  type RoomLayout,
  type Station,
  unknownFact,
} from "../types";
import { clean, NUM, snippet, toNumber, ZH_NUM } from "./text";

export interface TextSource {
  source: EvidenceSource;
  text: string;
  /** list items (facility bullet points) are matched more strictly */
  item?: boolean;
}

export interface ParseCtx {
  provider: ProviderId;
  url: string;
  checkedAt: string;
}

export const ev = (
  ctx: ParseCtx,
  field: string,
  source: EvidenceSource,
  rawText: string,
  confidence: Evidence["confidence"],
  parsed?: string,
): Evidence => ({
  field,
  provider: ctx.provider,
  source,
  rawText: rawText.slice(0, 400),
  parsed,
  url: ctx.url,
  checkedAt: ctx.checkedAt,
  confidence,
});

// ---------------------------------------------------------------- beds

const EN_BED_TYPES: [RegExp, BedType][] = [
  [/extra[-\s]?large double|super[-\s]?king|california king|king(?:[-\s]size)?/i, "king"],
  [/large double|queen(?:[-\s]size)?/i, "queen"],
  [/semi[-\s]?double|small double/i, "semi-double"],
  [/double|full(?:[-\s]size)?/i, "double"],
  [/single|twin/i, "single"],
  [/bunk/i, "bunk"],
  [/sofa|couch|day ?bed/i, "sofa"],
  [/japanese futon|futon|floor mattress|air mattress|toddler bed/i, "futon"],
  [/tatami/i, "tatami"],
];

const EN_BED_RE = new RegExp(
  String.raw`\b${NUM}\s+(?:x\s+)?(extra[-\s]?large double|super[-\s]?king|california king|large double|small double|semi[-\s]?double|double|queen(?:[-\s]size)?|king(?:[-\s]size)?|full(?:[-\s]size)?|single|twin|bunk|sofa|couch|day ?bed)\s+beds?\b` +
    String.raw`|\b${NUM}\s+(?:x\s+)?(japanese futons?|futons?(?: beds?)?|floor mattress(?:es)?|air mattress(?:es)?|couch(?:es)?|sofa beds?|tatami(?: mats?)?|fulls|doubles|singles|twins|queens|kings|bunks)\b(?!\s+beds?)`,
  "gi",
);

const JA_BEDS: [RegExp, BedType][] = [
  [/キング/, "king"],
  [/クイーン/, "queen"],
  [/セミダブル/, "semi-double"],
  [/ダブル/, "double"],
  [/シングル|ツイン/, "single"],
  [/二段/, "bunk"],
  [/ソファ/, "sofa"],
  [/布団|ふとん/, "futon"],
];
const JA_BED_RE = /(キングサイズ|キング|クイーンサイズ|クイーン|セミダブル|ダブル|シングル|ツイン|二段|ソファ|布団|ふとん)(?:ベッド)?\s*(?:[x×✕]\s*)?(\d+)\s*(?:台|組|枚|つ)?/g;

const ZH_BEDS: [RegExp, BedType][] = [
  [/特大|加大雙人|king/i, "king"],
  [/大號|queen|大床/i, "queen"],
  [/雙人/, "double"],
  [/單人|单人/, "single"],
  [/雙層|双层|上下舖/, "bunk"],
  [/沙發|沙发/, "sofa"],
  [/日式床墊|蒲團|和式床墊|床墊/, "futon"],
  [/榻榻米/, "tatami"],
];
const ZH_BED_RE = new RegExp(
  ZH_NUM + String.raw`\s*張\s*(特大雙人床|加大雙人床|特大床|大號雙人床|雙人床|双人床|單人床|单人床|大床|雙層床|双层床|上下舖|沙發床|沙发床|日式床墊|和式床墊|蒲團|榻榻米)`,
  "g",
);

function bedTypeOf(table: [RegExp, BedType][], s: string): BedType {
  for (const [re, t] of table) if (re.test(s)) return t;
  return "unknown";
}

/** Parse bed tokens in a text. Alternatives ("2 single beds or 1 double bed") keep the first option only. */
export function parseBeds(text: string): Bed[] {
  const t = clean(text);
  const beds: Bed[] = [];
  // Split by " or " alternatives: only first option counts (we cannot know which config is given).
  const segments = t.split(/\n/).map((line) => line.split(/\s+or\s+|\s*或\s*|\s*または\s*/i)[0]);
  for (const seg of segments) {
    for (const m of seg.matchAll(EN_BED_RE)) {
      const count = toNumber(m[1] ?? m[3]);
      const kind = m[2] ?? m[4];
      if (!count || !kind) continue;
      beds.push({ type: bedTypeOf(EN_BED_TYPES, kind), count, raw: m[0] });
    }
    for (const m of seg.matchAll(JA_BED_RE)) {
      const count = toNumber(m[2]);
      if (!count) continue;
      beds.push({ type: bedTypeOf(JA_BEDS, m[1]), count, raw: m[0] });
    }
    for (const m of seg.matchAll(ZH_BED_RE)) {
      const count = toNumber(m[1]);
      if (!count) continue;
      beds.push({ type: bedTypeOf(ZH_BEDS, m[2]), count, raw: m[0] });
    }
  }
  return beds;
}

/** Split text with "Bedroom 1 ..." / "Living room ..." headings into room layouts. */
export function parseRoomLayouts(text: string): RoomLayout[] {
  const t = clean(text);
  const re = /(Bedroom\s*\d+|Bedroom|Living room|Common space|Common area|Additional bedroom|Lounge|寝室\s*\d*|ベッドルーム\s*\d*|リビング(?:ルーム)?|臥室\s*\d*|客廳)\s*[:：·•\-]?\s*/gi;
  const marks = [...t.matchAll(re)];
  const rooms: RoomLayout[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = (marks[i].index ?? 0) + marks[i][0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index ?? t.length : Math.min(t.length, start + 160);
    const body = t.slice(start, end);
    const beds = parseBeds(body);
    if (beds.length) rooms.push({ name: marks[i][1].trim(), beds });
  }
  return rooms;
}

export function sumBeds(beds: Bed[]): Bed[] {
  const map = new Map<BedType, Bed>();
  for (const b of beds) {
    const cur = map.get(b.type);
    if (cur) cur.count += b.count;
    else map.set(b.type, { ...b });
  }
  return [...map.values()];
}

// ---------------------------------------------------------------- counts

interface CountHit {
  value: number;
  raw: string;
  source: EvidenceSource;
}

function findCounts(sources: TextSource[], patterns: RegExp[]): CountHit[] {
  const hits: CountHit[] = [];
  for (const s of sources) {
    const t = clean(s.text);
    for (const re of patterns) {
      for (const m of t.matchAll(re)) {
        const v = toNumber(m[1]);
        if (v == null) continue;
        hits.push({ value: v, raw: snippet(t, m.index ?? 0, 60), source: s.source });
      }
    }
  }
  return hits;
}

function resolveCount(ctx: ParseCtx, field: string, hits: CountHit[], round: (n: number) => number = (n) => n): Fact<number> {
  if (!hits.length) return unknownFact();
  const evidence = hits.slice(0, 6).map((h) => ev(ctx, field, h.source, h.raw, h.source === "search_card" ? "medium" : "high", String(round(h.value))));
  const values = [...new Set(hits.map((h) => round(h.value)))];
  if (values.length === 1) {
    const strong = hits.some((h) => h.source !== "search_card");
    return { value: values[0], confidence: strong || hits.length > 1 ? "VERIFIED" : "LIKELY", evidence, qualifier: "exact" };
  }
  // Platform summaries (structured data, overview line, room table) outrank host-written prose.
  const platform = [...new Set(hits.filter((h) => ["structured_data", "property_detail", "room_detail", "accessible_metadata"].includes(h.source)).map((h) => round(h.value)))];
  if (platform.length === 1) {
    const others = values.filter((v) => v !== platform[0]);
    return { value: platform[0], confidence: "VERIFIED", evidence, qualifier: "exact", note: others.length ? `other text mentions ${others.join(", ")}` : undefined };
  }
  // Prefer detail-page values over search card values when they disagree.
  const detail = [...new Set(hits.filter((h) => h.source !== "search_card").map((h) => round(h.value)))];
  if (detail.length === 1) return { value: detail[0], confidence: "LIKELY", evidence, qualifier: "exact", note: "search card differs" };
  return { value: Math.min(...values), confidence: "CONFLICT", evidence, qualifier: "atLeast", note: `conflicting values: ${values.join(", ")}` };
}

export function parseBedroomCount(ctx: ParseCtx, sources: TextSource[]): Fact<number> {
  const hits = findCounts(sources, [
    // same line only, and not a numbered heading ("1 / 2 ⏎ Bedroom 1")
    new RegExp(String.raw`\b${NUM}[ \t]*(?:separate\s+|private\s+)?bedrooms?\b(?![ \t]*\d)`, "gi"),
    /\bbedrooms\s*[:：]\s*(\d+)/gi,
    /(\d+)\s*(?:間)?臥室/g,
    /(?:寝室|ベッドルーム)\s*(\d+)\s*(?:室|部屋|つ)?/g,
    /(\d+)\s*(?:LDK|DK)\b/g,
  ]);
  // enumerated "Bedroom 1 … Bedroom 3" in one source => that many bedrooms; only used when no explicit count
  // exists (carousels may show just the first page of bedrooms)
  for (const s of hits.length ? [] : sources) {
    const nums = [...clean(s.text).matchAll(/\bBedroom\s+(\d)\b/g)].map((m) => Number(m[1]));
    if (nums.length >= 2 && nums.includes(1)) hits.push({ value: Math.max(...nums), raw: `enumerated Bedroom 1…${Math.max(...nums)}`, source: s.source });
  }
  const studio = sources.find((s) => /\bstudio\b|ワンルーム|套房/i.test(s.text));
  if (!hits.length && studio) {
    return { value: 0, confidence: "LIKELY", qualifier: "exact", evidence: [ev(ctx, "bedrooms", studio.source, snippet(clean(studio.text), clean(studio.text).search(/studio|ワンルーム|套房/i)), "medium", "0 (studio)")] };
  }
  return resolveCount(ctx, "bedrooms", hits);
}

export function parseBathroomCount(ctx: ParseCtx, sources: TextSource[]): { bathrooms: Fact<number>; toiletsFromHalf: number } {
  const hits = findCounts(sources, [
    new RegExp(String.raw`\b(\d+(?:\.5)?|an?|one|two|three|four)[ \t]*(?:private\s+|shared\s+|full\s+|separate\s+)?(?:bathrooms?|baths)\b(?!\s*tub)(?![ \t]*\d)`, "gi"),
    /\bbathrooms\s*[:：]\s*(\d+)/gi,
    /\b(\d+(?:\.5)?)\s+bath\b(?!\s*tub)(?!\s+(?:and|&|\+)\s+\d+\s+shower)/gi,
    /(\d+)\s*(?:間)?(?:浴室|衛浴)/g,
    /(?:バスルーム|浴室)\s*(\d+)\s*(?:室|つ|か所)?/g,
  ]);
  // "1 bath + 1 shower room" => 2 bathrooms
  for (const s of sources) {
    const t = clean(s.text);
    for (const m of t.matchAll(/\b(\d+)\s+bath(?:room)?s?\s*(?:\+|and|&|,)\s*(\d+)\s+shower\s*rooms?/gi)) {
      hits.push({ value: Number(m[1]) + Number(m[2]), raw: snippet(t, m.index ?? 0, 60), source: s.source });
    }
  }
  const halves = hits.filter((h) => !Number.isInteger(h.value));
  const fact = resolveCount(ctx, "bathrooms", hits, (n) => Math.floor(n));
  if (halves.length) fact.note = "half bath counted as toilet, not bathroom";
  return { bathrooms: fact, toiletsFromHalf: halves.length ? 1 : 0 };
}

export function parseToiletCount(ctx: ParseCtx, sources: TextSource[], bathrooms: Fact<number>, halfBaths: number): Fact<number> {
  const hits = findCounts(sources, [
    new RegExp(String.raw`\b${NUM}\s+(?:separate\s+|private\s+)?(?:toilets?|wcs?|restrooms?|lavatories)\b`, "gi"),
    /トイレ\s*(\d+)\s*(?:か所|ヶ所|つ|室)?/g,
    /(\d+)\s*(?:間|個)\s*(?:廁所|洗手間)/g,
  ]);
  if (hits.length) return resolveCount(ctx, "toilets", hits);
  if (bathrooms.value != null && bathrooms.confidence !== "UNKNOWN") {
    // A full bathroom contains a toilet in nearly every listing category, but we keep this as a lower bound.
    return {
      value: bathrooms.value + halfBaths,
      qualifier: "atLeast",
      confidence: "LIKELY",
      evidence: [ev(ctx, "toilets", "derived", `derived from ${bathrooms.value} bathroom(s)${halfBaths ? " + half bath" : ""}`, "low")],
      note: "lower bound derived from bathrooms",
    };
  }
  return unknownFact();
}

export function parseGuestCount(ctx: ParseCtx, sources: TextSource[]): Fact<number> {
  const hits = findCounts(sources, [
    /\b(\d+)\+?\s+guests?\b/gi,
    /\bsleeps\s+(\d+)\b/gi,
    /\bmax(?:imum)?\.?\s*(?:occupancy|guests|people|persons)?\s*:?\s*(\d+)\b/gi,
    /最多\s*(\d+)\s*(?:位|人)/g,
    /定員\s*(\d+)\s*名?/g,
  ]);
  if (!hits.length) return unknownFact();
  const max = Math.max(...hits.map((h) => h.value));
  return { value: max, confidence: "LIKELY", qualifier: "exact", evidence: hits.slice(0, 3).map((h) => ev(ctx, "maxGuests", h.source, h.raw, "medium", String(h.value))) };
}

// ---------------------------------------------------------------- bathtub evidence engine

const NOT_A_BATHTUB = /hot\s*tubs?|jacuzzi|whirlpool|spa\s*(?:bath|tub)|onsen|hot\s*spring|open[-\s]air\s*bath|public\s*bath|communal\s*bath|shared\s*bath(?:house|room)?|bath\s*house|sento|露天風呂|大浴場|温泉|溫泉|按摩浴缸|ジャグジー|公共浴池|共用浴室/gi;
const TUB_WORDS = /bath\s?tubs?|soaking tubs?|deep tubs?|浴缸|バスタブ|浴槽|ユニットバス/i;
const TUB_WEAK = /お風呂|bathing tub/i;
const NO_TUB = /no\s+bath\s?tub|without\s+(?:a\s+)?bath\s?tub|shower\s+only|walk-in shower only|bath\s?tub\s*[:：]\s*no|浴缸\s*[:：]?\s*無|無浴缸|沒有浴缸|僅淋浴|只有淋浴|シャワーのみ|浴槽なし|バスタブなし/i;

interface TubHit {
  count: number;
  qualifier: "exact" | "atLeast";
  confidence: "VERIFIED" | "LIKELY";
  evidence: Evidence;
}

/**
 * Bathtub count is only produced from explicit evidence. "2 bathrooms" is never turned into "2 bathtubs".
 * Hot tub / jacuzzi / onsen / public baths are stripped before matching.
 */
export function bathtubEngine(ctx: ParseCtx, sources: TextSource[], bathrooms: Fact<number>): Fact<number> {
  const hits: TubHit[] = [];
  const field = "bathtubs";

  for (const s of sources) {
    const raw = clean(s.text);
    const t = raw.replace(NOT_A_BATHTUB, "〔excluded〕");
    const before = hits.length;

    // Facility bullet item: exact "Bath" / "Bathtub" (Booking lists "Bath" vs "Shower" as separate room facilities)
    if (s.item) {
      if (/^(bath|bathtub|bath tub|浴缸|バスタブ|浴槽)$/i.test(t.trim())) {
        hits.push({ count: 1, qualifier: "atLeast", confidence: "LIKELY", evidence: ev(ctx, field, s.source, raw, "high", "≥1 bathtub (facility item)") });
      } else if (/bath or shower|bathtub or shower|bath\/shower/i.test(t)) {
        // ambiguous: not counted
      } else if (TUB_WORDS.test(t) && !NO_TUB.test(t)) {
        hits.push({ count: 1, qualifier: "atLeast", confidence: "LIKELY", evidence: ev(ctx, field, s.source, raw, "high", "≥1 bathtub (facility item)") });
      }
      if (NO_TUB.test(t)) hits.push({ count: 0, qualifier: "exact", confidence: "LIKELY", evidence: ev(ctx, field, s.source, raw, "medium", "0 bathtubs") });
      continue;
    }

    // 1) explicit counts: "2 bathtubs", "two separate bathtubs", "浴缸2個"
    for (const m of t.matchAll(new RegExp(String.raw`\b${NUM}\s+(?:separate\s+|private\s+|full[-\s]size\s+|japanese[-\s]style\s+|deep\s+|soaking\s+|western[-\s]style\s+)*(?:bath\s?tubs|bath\s?tub|soaking tubs?)`, "gi"))) {
      const n = toNumber(m[1]);
      if (n) hits.push({ count: n, qualifier: "exact", confidence: "VERIFIED", evidence: ev(ctx, field, s.source, snippet(raw, m.index ?? 0), "high", `${n} bathtub(s)`) });
    }
    for (const m of t.matchAll(new RegExp(ZH_NUM + String.raw`\s*(?:個|座)\s*浴缸|浴缸\s*[x×]?\s*(\d+)|(?:バスタブ|浴槽)\s*[x×]?\s*(\d+)\s*(?:つ|台|か所)?|(\d+)\s*つの(?:バスタブ|浴槽)`, "g"))) {
      const n = toNumber(m[1] ?? m[2] ?? m[3] ?? m[4]);
      if (n) hits.push({ count: n, qualifier: "exact", confidence: "VERIFIED", evidence: ev(ctx, field, s.source, snippet(raw, m.index ?? 0), "high", `${n} bathtub(s)`) });
    }

    // 2) "N bathrooms with bathtub", "both bathrooms have bathtubs", "each bathroom has a bathtub"
    for (const m of t.matchAll(new RegExp(String.raw`\b${NUM}\s+(?:full\s+|private\s+)?bathrooms?\s+(?:each\s+)?(?:with|including|featuring|have|has|equipped with)\s+(?:a\s+|its own\s+)?(?:bath\s?tubs?|soaking tubs?)`, "gi"))) {
      const n = toNumber(m[1]);
      if (n) hits.push({ count: n, qualifier: "exact", confidence: "VERIFIED", evidence: ev(ctx, field, s.source, snippet(raw, m.index ?? 0), "high", `${n} bathroom(s) with bathtub`) });
    }
    const each = t.match(/\b(?:each|both|every|all)\s+(?:of the\s+)?(?:\w+\s+)?bathrooms?\s+(?:has|have|with|includes?|features?|is equipped with|are equipped with|come with)\s+(?:a\s+|its own\s+)?(?:bath\s?tubs?|soaking tubs?)|bath\s?tubs?\s+in\s+(?:each|both|every)\s+bathrooms?/i);
    if (each) {
      const n = /\bboth\b/i.test(each[0]) ? 2 : bathrooms.value;
      if (n) {
        const verified = /\bboth\b/i.test(each[0]) || bathrooms.confidence === "VERIFIED";
        hits.push({ count: n, qualifier: "exact", confidence: verified ? "VERIFIED" : "LIKELY", evidence: ev(ctx, field, s.source, snippet(raw, each.index ?? 0), "high", `${n} bathtub(s) (one per bathroom)`) });
      }
    }

    // 2b) ordinal: "the 2nd bathtub", "a second bathtub" => at least 2
    for (const m of t.matchAll(/\b(2nd|second|3rd|third)\s+(?:\w+\s+){0,2}?(?:bath\s?tub|soaking tub)/gi)) {
      const n = /3|third/i.test(m[1]) ? 3 : 2;
      hits.push({ count: n, qualifier: "atLeast", confidence: "VERIFIED", evidence: ev(ctx, field, s.source, snippet(raw, m.index ?? 0), "high", `≥${n} bathtubs (ordinal mention)`) });
    }
    // 2c) Booking template "2 bathrooms with a bath and a shower": a tub exists, per-bathroom split not stated
    for (const m of t.matchAll(/\b(\d+)\s+bathrooms?\s+with\s+a\s+bath(?:tub)?\s+(?:and|&)\s+(?:a\s+)?shower/gi)) {
      hits.push({ count: 1, qualifier: "atLeast", confidence: "LIKELY", evidence: ev(ctx, field, s.source, snippet(raw, m.index ?? 0), "medium", "≥1 bathtub; not stated per bathroom") });
    }

    // 3) "1 bath and 1 shower room"
    for (const m of t.matchAll(/\b(\d+)\s+bath(?:room)?s?\s*(?:\+|and|&|,)\s*(\d+)\s+shower\s*rooms?/gi)) {
      const n = Number(m[1]);
      hits.push({ count: n, qualifier: "exact", confidence: "LIKELY", evidence: ev(ctx, field, s.source, snippet(raw, m.index ?? 0), "medium", `${n} bathtub(s); shower rooms have no tub`) });
    }

    // 4) enumerated bathrooms: "Bathroom 1: bathtub, shower  Bathroom 2: shower"
    const marks = [...t.matchAll(/(?:bathroom|bath room|浴室|バスルーム|衛浴)\s*(\d+)\s*[:：·\-]?/gi)];
    if (marks.length >= 2) {
      let withTub = 0;
      const pieces: string[] = [];
      for (let i = 0; i < marks.length; i++) {
        const start = (marks[i].index ?? 0) + marks[i][0].length;
        const end = i + 1 < marks.length ? marks[i + 1].index ?? t.length : Math.min(t.length, start + 140);
        const body = t.slice(start, end);
        if (TUB_WORDS.test(body) && !NO_TUB.test(body)) {
          withTub++;
          pieces.push(`Bathroom ${marks[i][1]}: ${body.trim().slice(0, 80)}`);
        }
      }
      if (withTub) {
        hits.push({ count: withTub, qualifier: withTub === marks.length ? "exact" : "atLeast", confidence: "VERIFIED", evidence: ev(ctx, field, s.source, pieces.join(" | "), "high", `${withTub} of ${marks.length} enumerated bathrooms have a bathtub`) });
      }
    }

    // 5) generic single mention => at least 1 (LIKELY)
    if (hits.length === before) {
      const g = t.search(TUB_WORDS);
      if (g >= 0 && !NO_TUB.test(t.slice(Math.max(0, g - 30), g + 40))) {
        hits.push({ count: 1, qualifier: "atLeast", confidence: "LIKELY", evidence: ev(ctx, field, s.source, snippet(raw, g), "medium", "≥1 bathtub mentioned") });
      } else if (TUB_WEAK.test(t)) {
        const w = t.search(TUB_WEAK);
        hits.push({ count: 1, qualifier: "atLeast", confidence: "LIKELY", evidence: ev(ctx, field, s.source, snippet(raw, w), "low", "≥1 bath (お風呂) mentioned") });
      }
    }
    const neg = t.search(NO_TUB);
    if (neg >= 0) hits.push({ count: 0, qualifier: "exact", confidence: "LIKELY", evidence: ev(ctx, field, s.source, snippet(raw, neg), "medium", "no bathtub statement") });
  }

  if (!hits.length) return { ...unknownFact("no bathtub evidence found"), evidence: [] };

  const evidence = hits.map((h) => h.evidence);
  const exactVerified = [...new Set(hits.filter((h) => h.qualifier === "exact" && h.count > 0 && h.confidence === "VERIFIED").map((h) => h.count))];
  const atLeast = Math.max(0, ...hits.filter((h) => h.count > 0).map((h) => h.count));
  const zero = hits.some((h) => h.count === 0);

  if (exactVerified.length > 1) {
    return { value: Math.min(...exactVerified), qualifier: "atLeast", confidence: "CONFLICT", evidence, note: `sources disagree: ${exactVerified.join(" vs ")}` };
  }
  if (exactVerified.length === 1) {
    const v = exactVerified[0];
    if (atLeast > v) return { value: v, qualifier: "atLeast", confidence: "CONFLICT", evidence, note: `another source implies ≥${atLeast}` };
    return { value: v, qualifier: "exact", confidence: "VERIFIED", evidence };
  }
  const exactLikely = hits.filter((h) => h.qualifier === "exact" && h.count > 0);
  if (exactLikely.length) {
    const v = Math.max(...exactLikely.map((h) => h.count));
    return { value: v, qualifier: "exact", confidence: "LIKELY", evidence };
  }
  if (atLeast > 0) {
    if (zero) return { value: atLeast, qualifier: "atLeast", confidence: "CONFLICT", evidence, note: "one source says no bathtub" };
    return { value: atLeast, qualifier: "atLeast", confidence: atLeast >= 2 ? "VERIFIED" : "LIKELY", evidence, note: `at least ${atLeast}; exact count not stated` };
  }
  return { value: 0, qualifier: "exact", confidence: "LIKELY", evidence };
}

// ---------------------------------------------------------------- amenities

const AMENITY_RE: Record<AmenityKey, RegExp> = {
  wifi: /wi-?fi|wireless internet|無線網路|無線LAN|ワイファイ/i,
  kitchen: /\bkitchen\b(?!ette)|full kitchen|廚房|キッチン(?!ネット)/i,
  kitchenette: /kitchenette|簡易廚房|ミニキッチン|キッチネット/i,
  washer: /washing machine|\bwasher\b|laundry machine|in-unit laundry|洗衣機|洗濯機|coin laundry|launderette|laundromat|shared laundry|コインランドリー|投幣式洗衣/i,
  dryer: /(?<!hair\s?|blow\s?)\bdryer\b|tumble dryer|clothes dryer|烘衣機|乾衣機|衣類乾燥機|乾燥機/i,
  balcony: /balcony|terrace|patio|陽台|露台|バルコニー|ベランダ|テラス/i,
  private_bath: /private bathroom|private bath\b|en-?suite|專用衛浴|私人浴室|專屬浴室|専用バスルーム/i,
  hot_tub: /hot tub|jacuzzi|whirlpool|spa bath|按摩浴缸|ジャグジー/i,
  onsen: /onsen|hot spring|溫泉|温泉|露天風呂/i,
  air_conditioning: /air[-\s]?condition|\bA\/C\b|\bAC\b|空調|冷氣|エアコン|冷房/i,
  heating: /heating|heater|暖氣|暖房|ヒーター/i,
  elevator: /elevator|\blift\b|電梯|エレベーター/i,
  parking: /parking|停車場|駐車場|停車位/i,
  luggage_storage: /luggage storage|baggage storage|luggage drop|行李寄存|荷物預かり|手荷物預かり/i,
  front_desk_24h: /24[-\s]?hour front desk|24[-\s]?hour reception|24小時櫃檯|24時間対応フロント|24時間フロント/i,
  refrigerator: /refrigerator|fridge|冰箱|冷蔵庫/i,
  microwave: /microwave|微波爐|電子レンジ/i,
  cookware: /cookware|cooking basics|pots and pans|kitchenware|kitchen utensils|cooking utensils|廚具|調理器具/i,
  non_smoking: /non-?smoking|no smoking|smoking (?:is )?not allowed|smoke-free|禁菸|禁煙/i,
  self_checkin: /self check-?in|keypad|lockbox|smart lock|自助入住|セルフチェックイン/i,
  wheelchair: /wheelchair[-\s]accessible|wheelchair access|無障礙|車椅子/i,
  accessible_bathroom: /accessible bathroom|accessible toilet|grab rails|toilet with grab|無障礙浴室|バリアフリートイレ/i,
  ground_floor: /ground floor|ground-floor|first floor unit|一樓|1階/i,
  pets_allowed: /pets? (?:are )?allowed|pet[-\s]friendly|ペット可|可攜帶寵物|寵物友善/i,
  private_entrance: /private entrance|separate (?:street|building) entrance|專屬入口|独立した入口|専用玄関/i,
  separate_toilet: /separate toilet|toilet (?:is )?separate|バス・?トイレ別|浴廁分離|乾濕分離/i,
  japanese_room: /japanese[-\s]style room|tatami room|和室|日式房|和式房間/i,
  free_parking: /free parking|free on-?site parking|無料駐車場|免費停車/i,
  bidet: /bidet|washlet|温水洗浄便座|免治馬桶|ウォシュレット/i,
};
const NEGATIVE = /^(unavailable|not included|no\b|not available)|\b(not available|unavailable|not allowed|no\s)|無|なし/i;

export function detectAmenities(ctx: ParseCtx, sources: TextSource[]): Partial<Record<AmenityKey, Fact<boolean>>> {
  const out: Partial<Record<AmenityKey, Fact<boolean>>> = {};
  for (const key of AMENITIES) {
    const re = AMENITY_RE[key];
    for (const s of sources) {
      const t = clean(s.text);
      const i = t.search(re);
      if (i < 0) continue;
      const near = s.item ? t : t.slice(Math.max(0, i - 25), i + 40);
      let negative = s.item ? NEGATIVE.test(t) : /\bno\s+\w*\s*$|not available|unavailable/i.test(t.slice(Math.max(0, i - 25), i)) || /^\S*\s*(?:not available|unavailable|is not)/i.test(t.slice(i, i + 40).replace(re, ""));
      if (key === "non_smoking") negative = false;
      if (key === "parking" && /no parking|parking not available|parking is not/i.test(near)) negative = true;
      const shared = key === "washer" && /coin|launderette|laundromat|shared|コインランドリー|投幣/i.test(near);
      const cur = out[key];
      const e = ev(ctx, `amenity:${key}`, s.source, s.item ? t : snippet(t, i, 50), s.item ? "high" : "medium", negative ? "not available" : shared ? "shared laundry" : "available");
      if (!cur) {
        out[key] = { value: !negative, confidence: s.item ? "VERIFIED" : "LIKELY", evidence: [e], note: shared ? "shared" : undefined };
      } else {
        cur.evidence.push(e);
        if (cur.value !== !negative) cur.confidence = "CONFLICT";
        else if (s.item) cur.confidence = cur.confidence === "CONFLICT" ? "CONFLICT" : "VERIFIED";
        if (!shared && !negative) cur.note = undefined;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- station

const ST = String.raw`([A-Z][A-Za-z\-'’ōūÔŌ]+(?:\s+(?![Ss]tation\b)[A-Z][A-Za-z\-'’ōū]+){0,4}\s+(?:[Ss]tation\b|Sta\.))`;

export interface StationHit {
  name: string;
  walkMinutes: number | null;
  distanceM: number | null;
  raw: string;
  source: EvidenceSource;
}

export function parseStations(sources: TextSource[]): StationHit[] {
  const hits: StationHit[] = [];
  for (const s of sources) {
    const t = clean(s.text);
    const add = (name: string, min: number | null, dist: number | null, idx: number) =>
      hits.push({ name: name.replace(/\s+/g, " ").replace(/\b(station)\s+station\b/i, "$1").replace(/^(Train|Subway|Metro|Bus|Tram|Monorail)(?=[A-Z])/, "").replace(/^(?:From|To|At|Near|The|And|Or|Via)\s+/, "").trim(), walkMinutes: min, distanceM: dist, raw: snippet(t, idx, 70), source: s.source });
    // case-sensitive on purpose: the station name must be a proper noun ("nearest station" is not a name)
    for (const m of t.matchAll(new RegExp(String.raw`(\d+)\s*(?:-|–)?\s*[Mm]in(?:ute)?s?\.?(?:'s)?\s*(?:[Oo]n foot|[Ww]alk(?:ing)?(?: distance)?)\s*(?:from|to|away from|of)?\s*(?:[Tt]he\s+)?(?:[Nn]earest\s+)?` + ST, "g")))
      add(m[2], Number(m[1]), null, m.index ?? 0);
    // the minutes must belong to THIS station: no other station name or route arrow in between
    // ("... Station, 8 minutes on foot from Y Station": the minutes belong to Y, handled by the pattern above)
    for (const m of t.matchAll(new RegExp(ST + String.raw`(?:(?![Ss]tation\b)[^.\n|])` + "{0,40}?" + String.raw`(\d+)\s*(?:-|–)?\s*min(?:ute)?s?\.?\s*(?:by\s+)?(?:on foot|walk)(?!(?:ing)?\s+(?:from|to)\b)`, "g")))
      add(m[1], Number(m[2]), null, m.index ?? 0);
    for (const m of t.matchAll(new RegExp(ST + String.raw`\s*[:\-–·•]?\s*(\d+(?:[.,]\d+)?)\s*(km|m)\b`, "g"))) {
      const d = parseFloat(m[2].replace(",", ".")) * (m[3].toLowerCase() === "km" ? 1000 : 1);
      add(m[1], null, Math.round(d), m.index ?? 0);
    }
    // "Sijyo station: 10 mins by walk"
    for (const m of t.matchAll(new RegExp(ST + String.raw`\s*[:：]\s*(\d+)\s*mins?\.?\s*(?:by walk|walk|on foot)`, "g"))) add(m[1], Number(m[2]), null, m.index ?? 0);
    // "315 m from Kyoto Train Station", "Kyoto Train Station is within 0.32 km"
    for (const m of t.matchAll(new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*(km|m)\s+from\s+(?:the\s+)?` + ST, "g"))) {
      const d = parseFloat(m[1].replace(",", ".")) * (m[2].toLowerCase() === "km" ? 1000 : 1);
      add(m[3], null, Math.round(d), m.index ?? 0);
    }
    for (const m of t.matchAll(new RegExp(ST + String.raw`\s+is within\s+(\d+(?:[.,]\d+)?)\s*(km|m)\b`, "g"))) {
      const d = parseFloat(m[2].replace(",", ".")) * (m[3].toLowerCase() === "km" ? 1000 : 1);
      add(m[1], null, Math.round(d), m.index ?? 0);
    }
    for (const m of t.matchAll(new RegExp(String.raw`(\d+(?:[.,]\d+)?)\s*(km|m)\s+walking\s+from\s+` + ST, "g"))) {
      const d = parseFloat(m[1].replace(",", ".")) * (m[2].toLowerCase() === "km" ? 1000 : 1);
      add(m[3], null, Math.round(d), m.index ?? 0);
    }
    // "6mins to metro Tozai Line Nijojomae station" – accepted only inside an explicit on-foot context
    for (const m of t.matchAll(/(\d+)\s*mins?\.?\s+to\s+(?:the\s+)?(?:metro|subway|jr|keihan|hankyu|kintetsu|randen)?\s*(?:[A-Z][\w-]*\s+Line\s+)?([A-Z][A-Za-z\-']+(?:[\s-][A-Z][A-Za-z\-']+){0,3})\s+[Ss]tation/g)) {
      const before = t.slice(Math.max(0, (m.index ?? 0) - 160), m.index ?? 0);
      if (/on foot|walk/i.test(before) && !/\bby (bus|car|taxi|train)\b|drive/i.test(before.slice(-60))) add(`${m[2]} Station`, Number(m[1]), null, m.index ?? 0);
    }
    for (const m of t.matchAll(/([一-龯ぁ-んァ-ヶA-Za-z0-9・ー]{1,12}駅)[^。\n]{0,15}?徒歩\s*(?:約)?\s*(\d+)\s*分/g)) add(m[1], Number(m[2]), null, m.index ?? 0);
    for (const m of t.matchAll(/([一-龯A-Za-z0-9・\-]{1,12}(?:站|駅))[^。\n，,]{0,12}?(?:步行|走路)\s*(?:約|约|僅|仅|只需)?\s*(\d+)\s*分/g)) add(m[1], Number(m[2]), null, m.index ?? 0);
    for (const m of t.matchAll(/(?:步行|徒歩)\s*(?:約|约)?\s*(\d+)\s*分(?:鐘|钟)?[^。\n]{0,8}?(?:即可)?(?:抵達|到達|可達|到)\s*([一-龯A-Za-z0-9・\-]{1,12}(?:站|駅))/g)) add(m[2], Number(m[1]), null, m.index ?? 0);
  }
  return hits;
}

export function resolveStation(ctx: ParseCtx, hits: StationHit[], estimateFromDistance: boolean): Fact<Station> {
  if (!hits.length) return unknownFact("no station information on listing");
  const withMin = hits.filter((h) => h.walkMinutes != null).sort((a, b) => a.walkMinutes! - b.walkMinutes!);
  const evidence = hits.slice(0, 6).map((h) => ev(ctx, "station", h.source, h.raw, h.walkMinutes != null ? "high" : "medium", `${h.name}${h.walkMinutes != null ? ` ${h.walkMinutes} min walk` : ""}${h.distanceM != null ? ` ${h.distanceM} m` : ""}`));
  if (withMin.length) {
    const best = withMin[0];
    const dist = hits.find((h) => h.name === best.name && h.distanceM != null)?.distanceM ?? null;
    return { value: { name: best.name, walkMinutes: best.walkMinutes, distanceM: dist, estimated: false }, confidence: "VERIFIED", evidence };
  }
  const withDist = hits.filter((h) => h.distanceM != null).sort((a, b) => a.distanceM! - b.distanceM!);
  const best = withDist[0] ?? hits[0];
  if (estimateFromDistance && best.distanceM != null) {
    return {
      value: { name: best.name, walkMinutes: Math.ceil(best.distanceM / 80), distanceM: best.distanceM, estimated: true },
      confidence: "LIKELY",
      evidence: [...evidence, ev(ctx, "station", "derived", `${best.distanceM} m ÷ 80 m/min (straight-line distance; user-enabled estimate)`, "low")],
      note: "walk time estimated from listed distance",
    };
  }
  return { value: { name: best.name, walkMinutes: null, distanceM: best.distanceM, estimated: false }, confidence: "LIKELY", evidence, note: "walking minutes not stated on listing" };
}

// ---------------------------------------------------------------- transit (listing text only)

export interface TransitHit {
  target: string;
  minutes: number;
  mode: string;
  raw: string;
  source: EvidenceSource;
}

export function parseTransit(sources: TextSource[]): TransitHit[] {
  const out: TransitHit[] = [];
  for (const s of sources) {
    const t = clean(s.text);
    for (const m of t.matchAll(/(\d+)\s*(?:-|–)?\s*min(?:ute)?s?\.?\s*(?:by\s+(train|subway|metro|bus|jr|rail))\s*(?:to|from)\s+(?:the\s+)?([A-Z][\w\-' ]{2,40}?)(?=[.,;\n)]|\s+(?:and|or|station)\b)/gi))
      out.push({ minutes: Number(m[1]), mode: m[2].toLowerCase(), target: m[3].trim(), raw: snippet(t, m.index ?? 0, 70), source: s.source });
    for (const m of t.matchAll(/([A-Z][\w\-' ]{2,40}?)\s+(?:is|are)\s+(?:just\s+|only\s+|about\s+)?(\d+)\s*min(?:ute)?s?\s+(?:away\s+)?by\s+(train|subway|metro|bus)/gi))
      out.push({ minutes: Number(m[2]), mode: m[3].toLowerCase(), target: m[1].trim(), raw: snippet(t, m.index ?? 0, 70), source: s.source });
    // "Sijyo station: 8 mins by Subway Karasuma Line"
    for (const m of t.matchAll(new RegExp(ST + String.raw`\s*[:：]\s*(\d+)\s*mins?\.?\s*by\s+([A-Za-z]+)`, "g")))
      if (/^(train|subway|metro|bus|jr|rail)$/i.test(m[3])) out.push({ minutes: Number(m[2]), mode: m[3].toLowerCase(), target: m[1].trim(), raw: snippet(t, m.index ?? 0, 70), source: s.source });
    for (const m of t.matchAll(/([一-龯ァ-ヶー]{1,10}駅?)まで\s*(電車|地下鉄|バス|JR)?で?\s*(?:約)?\s*(\d+)\s*分/g))
      out.push({ minutes: Number(m[3]), mode: m[2] ?? "any", target: m[1], raw: snippet(t, m.index ?? 0, 70), source: s.source });
  }
  return out;
}

// ---------------------------------------------------------------- cancellation / meals / times

export function parseCancellation(texts: string[]): Cancellation {
  const t = clean(texts.join("\n"));
  const c: Cancellation = { freeCancellation: null, deadline: null, payLater: null, noPrepayment: null, refundable: null, text: null };
  if (!t) return c;
  const free = t.match(/free cancell?ation[^\n]{0,60}|免費取消[^\n]{0,30}|無料キャンセル[^\n]{0,30}|fully refundable[^\n]{0,40}/i);
  const nonRef = /non-?refundable|no refund|不可退款|不可取消|返金不可|キャンセル不可/i.test(t);
  if (free) {
    c.freeCancellation = true;
    c.refundable = true;
    c.text = free[0];
    const d = free[0].match(/(?:before|until|by)\s+([^·\n]+?(?:\d{4}|\d{1,2}:\d{2}))/i) ?? t.match(/free cancell?ation (?:before|until)\s+([^\n·]+)/i);
    if (d) c.deadline = d[1].trim();
  } else if (nonRef) {
    c.freeCancellation = false;
    c.refundable = false;
    c.text = t.match(/non-?refundable[^\n]{0,40}|不可退款|返金不可/i)?.[0] ?? null;
  }
  if (/no prepayment|no payment needed|不需預付|預付不要|事前決済不要/i.test(t)) c.noPrepayment = true;
  if (/pay later|pay at the property|pay at property|reserve now,? pay later|到店付款|現地払い|稍後付款/i.test(t)) c.payLater = true;
  if (/partial refund|partially refundable/i.test(t) && c.refundable == null) c.refundable = true;
  return c;
}

export function parseMeals(texts: string[]): { breakfast: boolean | null; dinner: boolean | null } {
  const t = clean(texts.join("\n"));
  let breakfast: boolean | null = null;
  let dinner: boolean | null = null;
  if (/breakfast included|breakfast & dinner included|half board|full board|含早餐|朝食付|朝食込み/i.test(t)) breakfast = true;
  if (/dinner included|half board|full board|含晚餐|夕食付|2食付/i.test(t)) dinner = true;
  if (/room only|no meals|不含餐|素泊まり/i.test(t)) {
    breakfast ??= false;
    dinner ??= false;
  }
  return { breakfast, dinner };
}

export function parseTimes(texts: string[]): { checkIn: string | null; checkOut: string | null } {
  const t = clean(texts.join("\n"));
  const ci = t.match(/check-?in\s*(?:time)?\s*[:：]?\s*(?:from|after)?\s*(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?(?:\s*(?:[-–~]|to)\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)?)/i) ?? t.match(/チェックイン\s*[:：]?\s*(\d{1,2}:\d{2}(?:\s*[-～~]\s*\d{1,2}:\d{2})?)/) ?? t.match(/入住時間\s*[:：]?\s*(\d{1,2}:\d{2}[^\n]{0,10})/);
  const coRange = t.match(/check-?out\s*(?:time)?\s*[:：]?\s*from\s*\d{1,2}:\d{2}(?:\s*(?:AM|PM))?\s*(?:to|-|–)\s*(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)/i);
  const co = coRange ?? t.match(/check-?out\s*(?:time)?\s*[:：]?\s*(?:until|before|by)?\s*(\d{1,2}:\d{2}(?:\s*(?:AM|PM))?)/i) ?? t.match(/チェックアウト\s*[:：]?\s*(?:～|~)?\s*(\d{1,2}:\d{2})/) ?? t.match(/退房時間\s*[:：]?\s*(\d{1,2}:\d{2})/);
  return { checkIn: ci?.[1]?.trim() ?? null, checkOut: co?.[1]?.trim() ?? null };
}

export function parseRating(text: string | null | undefined, scale: number): { raw: number; scale: number; normalized: number } | null {
  const t = clean(text);
  const m = t.match(/(\d{1,2}(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const raw = parseFloat(m[1].replace(",", "."));
  if (!(raw > 0) || raw > scale) return null;
  return { raw, scale, normalized: Math.round((raw * 10 * 100) / scale) / 100 };
}

export function parseReviewCount(text: string | null | undefined): number | null {
  const t = clean(text);
  const m = t.match(/(\d{1,3}(?:[,.]\d{3})+|\d+)\s*(?:reviews?|ratings?|則評價|條評價|件のクチコミ|件の口コミ|件|則|則評論|評論|評價)/i) ?? t.match(/(?:reviews?|評價)\s*\(?(\d{1,3}(?:,\d{3})*|\d+)\)?/i);
  if (!m) return null;
  return parseInt(m[1].replace(/[,.]/g, ""), 10);
}

export const TUB_KEYWORDS = TUB_WORDS;
