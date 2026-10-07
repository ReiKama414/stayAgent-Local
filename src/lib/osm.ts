import type { Evidence, Fact, Offer, Station } from "./types";
import { haversineM } from "./parsing/text";

/**
 * Nearest railway/subway station from OpenStreetMap (Overpass API) for listings that give coordinates but no station.
 * Distance = straight-line × 1.2 (typical walking-route factor), always marked as an estimate.
 * Requests are serialized (≥1.2 s apart) and rotate over public Overpass mirrors to respect their rate limits.
 */
const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];

type Hit = { name: string; distanceM: number } | null;
const g = globalThis as unknown as { __osmCache?: Map<string, Hit>; __osmQueue?: Promise<unknown>; __osmLast?: number };
const cache = (g.__osmCache ??= new Map());

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__osmQueue ?? Promise.resolve()).then(async () => {
    const wait = (g.__osmLast ?? 0) + 1200 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      g.__osmLast = Date.now();
    }
  });
  g.__osmQueue = run.catch(() => {});
  return run;
}

async function queryOnce(url: string, lat: number, lng: number): Promise<Hit | undefined> {
  const q = `[out:json][timeout:15];(node(around:2000,${lat},${lng})[railway=station];node(around:2000,${lat},${lng})[station=subway];node(around:2000,${lat},${lng})[railway=halt];);out body;`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const r = await fetch(url, {
      method: "POST",
      body: "data=" + encodeURIComponent(q),
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "stay-agent-local/0.1 (personal travel research)" },
      signal: ctl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return undefined;
    const j = (await r.json()) as { elements?: { lat: number; lon: number; tags?: Record<string, string> }[] };
    let best: Hit = null;
    for (const e of j.elements ?? []) {
      const name = e.tags?.["name:en"] ?? e.tags?.["name:ja_rm"] ?? e.tags?.name;
      if (!name) continue;
      const d = haversineM(lat, lng, e.lat, e.lon);
      if (!best || d * 1.2 < best.distanceM) best = { name: /station|駅/i.test(name) ? name : `${name} Station`, distanceM: Math.round(d * 1.2) };
    }
    return best;
  } catch {
    return undefined;
  }
}

type StationNode = { name: string; lat: number; lon: number };
const g2 = globalThis as unknown as { __osmAreas?: { s: number; w: number; n: number; e: number; stations: StationNode[] }[] };
const areas = (g2.__osmAreas ??= []);

/**
 * One Overpass request for every station inside the bounding box of all listings (instead of one request per
 * listing): polite to the public server and fast. Later lookups inside the box are answered locally.
 */
/** Optional transport: run the POST inside the automation browser (Node's own network path cannot reach Overpass on some machines). */
export type BrowserPost = (url: string, body: string) => Promise<string | null>;

export async function prefetchStations(points: { lat: number; lng: number }[], viaBrowser?: BrowserPost): Promise<number> {
  const pts = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (!pts.length) return 0;
  const pad = 0.02;
  const s = Math.min(...pts.map((p) => p.lat)) - pad;
  const n = Math.max(...pts.map((p) => p.lat)) + pad;
  const w = Math.min(...pts.map((p) => p.lng)) - pad;
  const e = Math.max(...pts.map((p) => p.lng)) + pad;
  if (areas.some((a) => a.s <= s && a.n >= n && a.w <= w && a.e >= e)) return -1;
  const q = `[out:json][timeout:60];(node(${s},${w},${n},${e})[railway=station];node(${s},${w},${n},${e})[railway=halt];node(${s},${w},${n},${e})[station=subway];);out body;`;
  const store = (raw: string) => {
    const j = JSON.parse(raw) as { elements?: { lat: number; lon: number; tags?: Record<string, string> }[] };
    const stations = (j.elements ?? []).map((x) => ({ name: x.tags?.["name:en"] ?? x.tags?.["name:ja_rm"] ?? x.tags?.name ?? "", lat: x.lat, lon: x.lon })).filter((x) => x.name);
    areas.push({ s, w, n, e, stations });
    return stations.length;
  };
  if (viaBrowser) {
    try {
      const raw = await viaBrowser(MIRRORS[0], "data=" + encodeURIComponent(q));
      if (raw) return store(raw);
    } catch {
      /* fall back to Node fetch */
    }
  }
  for (const url of [MIRRORS[0], ...MIRRORS.slice(1)]) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 70000);
      const r = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "user-agent": "stay-agent-local/0.1 (personal travel research)" }, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const j = (await r.json()) as { elements?: { lat: number; lon: number; tags?: Record<string, string> }[] };
      const stations = (j.elements ?? [])
        .map((x) => ({ name: x.tags?.["name:en"] ?? x.tags?.["name:ja_rm"] ?? x.tags?.name ?? "", lat: x.lat, lon: x.lon }))
        .filter((x) => x.name);
      areas.push({ s, w, n, e, stations });
      return stations.length;
    } catch {
      /* next mirror */
    }
  }
  return 0;
}

function nearestInAreas(lat: number, lng: number): Hit | undefined {
  const a = areas.find((x) => lat >= x.s + 0.015 && lat <= x.n - 0.015 && lng >= x.w + 0.015 && lng <= x.e - 0.015);
  if (!a) return undefined;
  let best: Hit = null;
  for (const st of a.stations) {
    const d = haversineM(lat, lng, st.lat, st.lon) * 1.2;
    if (d <= 2400 && (!best || d < best.distanceM)) best = { name: /station|駅/i.test(st.name) ? st.name : `${st.name} Station`, distanceM: Math.round(d) };
  }
  return best;
}

export async function nearestStation(lat: number, lng: number): Promise<Hit> {
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  if (cache.has(key)) return cache.get(key)!;
  const local = nearestInAreas(lat, lng);
  if (local !== undefined) {
    cache.set(key, local);
    return local;
  }
  for (let attempt = 0; attempt < 1; attempt++) {
    const res = await serialize(() => queryOnce(MIRRORS[attempt % MIRRORS.length], lat, lng));
    if (res !== undefined) {
      cache.set(key, res);
      return res;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return null; // failures are not cached
}

/** Fill a missing station fact from coordinates. Never overrides what the listing itself states. */
export async function fillStationFromMap(o: Offer): Promise<boolean> {
  if (o.station.value || o.latitude == null || o.longitude == null) return false;
  const s = await nearestStation(o.latitude, o.longitude);
  if (!s) return false;
  const e: Evidence = {
    field: "station",
    provider: o.provider,
    source: "derived",
    rawText: `OpenStreetMap: ${s.name}, ~${s.distanceM} m (straight-line × 1.2 from the listing's map pin)`,
    parsed: `${s.name} ~${Math.ceil(s.distanceM / 80)} min walk (estimate)`,
    url: "https://www.openstreetmap.org/",
    checkedAt: new Date().toISOString(),
    confidence: "low",
  };
  const fact: Fact<Station> = { value: { name: s.name, walkMinutes: null, distanceM: s.distanceM, estimated: true }, confidence: "LIKELY", evidence: [e], note: "estimated from map coordinates" };
  o.station = fact;
  return true;
}
