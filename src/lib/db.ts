import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Criteria, JobStats, LogEntry, Offer, PropertyResult } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");

const g = globalThis as unknown as { __stayDb?: Database.Database };

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS searches (
     id TEXT PRIMARY KEY, created_at TEXT NOT NULL, finished_at TEXT, name TEXT, destination TEXT,
     check_in TEXT, check_out TEXT, adults INTEGER, criteria_json TEXT NOT NULL, status TEXT, stats_json TEXT,
     saved INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS search_filters (
     search_id TEXT NOT NULL, key TEXT NOT NULL, level TEXT, value_json TEXT, PRIMARY KEY (search_id, key))`,
  `CREATE TABLE IF NOT EXISTS properties (
     id TEXT PRIMARY KEY, name TEXT, normalized_name TEXT, address TEXT, latitude REAL, longitude REAL,
     property_type TEXT, updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS property_offers (
     id TEXT PRIMARY KEY, property_id TEXT, provider TEXT NOT NULL, provider_property_id TEXT NOT NULL, url TEXT,
     room_name TEXT, cache_key TEXT, checked_at TEXT, detail_verified INTEGER, data_json TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_offers_cache ON property_offers(cache_key, checked_at)`,
  `CREATE TABLE IF NOT EXISTS availability_checks (
     id INTEGER PRIMARY KEY AUTOINCREMENT, offer_id TEXT, search_id TEXT, checked_at TEXT, status TEXT, evidence_json TEXT)`,
  `CREATE TABLE IF NOT EXISTS price_checks (
     id INTEGER PRIMARY KEY AUTOINCREMENT, offer_id TEXT, search_id TEXT, checked_at TEXT, currency TEXT, total REAL,
     completeness TEXT, data_json TEXT)`,
  `CREATE TABLE IF NOT EXISTS property_evidence (
     id INTEGER PRIMARY KEY AUTOINCREMENT, offer_id TEXT, search_id TEXT, field TEXT, raw_text TEXT, source TEXT,
     url TEXT, checked_at TEXT, confidence TEXT, parsed TEXT)`,
  `CREATE TABLE IF NOT EXISTS search_results (
     search_id TEXT NOT NULL, property_id TEXT NOT NULL, status TEXT, score REAL, result_json TEXT,
     PRIMARY KEY (search_id, property_id))`,
  `CREATE TABLE IF NOT EXISTS favorites (
     property_id TEXT PRIMARY KEY, name TEXT, note TEXT, created_at TEXT, updated_at TEXT, snapshot_json TEXT)`,
  `CREATE TABLE IF NOT EXISTS activity_logs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, search_id TEXT, ts TEXT, level TEXT, provider TEXT, msg TEXT)`,
  `CREATE TABLE IF NOT EXISTS presets (name TEXT PRIMARY KEY, criteria_json TEXT NOT NULL, updated_at TEXT)`,
  // Watchlist: schema only. No background scheduler runs yet.
  `CREATE TABLE IF NOT EXISTS watches (
     id INTEGER PRIMARY KEY AUTOINCREMENT, search_id TEXT, property_id TEXT, kind TEXT, active INTEGER DEFAULT 0,
     created_at TEXT, last_checked_at TEXT, last_total REAL, last_status TEXT)`,
];

export function db(): Database.Database {
  if (g.__stayDb) {
    // a long-running dev server keeps its connection: apply migrations added since it was opened
    const gm = g as unknown as { __stayDbMigrations?: number };
    if (gm.__stayDbMigrations !== MIGRATIONS.length) {
      for (const m of MIGRATIONS) g.__stayDb.exec(m);
      gm.__stayDbMigrations = MIGRATIONS.length;
    }
    return g.__stayDb;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const d = new Database(path.join(DATA_DIR, "stay-agent.sqlite"));
  d.pragma("journal_mode = WAL");
  for (const m of MIGRATIONS) d.exec(m);
  g.__stayDb = d;
  return d;
}

export function cacheKey(o: { provider: string; providerPropertyId: string }, c: Criteria) {
  return [o.provider, o.providerPropertyId, c.checkIn, c.checkOut, c.adults, c.children, c.rooms, c.currency].join("|");
}

export function createSearch(id: string, c: Criteria) {
  const d = db();
  const now = new Date().toISOString();
  d.prepare(
    `INSERT INTO searches (id, created_at, name, destination, check_in, check_out, adults, criteria_json, status) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(id, now, c.name || `${c.destination} ${c.checkIn}`, c.destination, c.checkIn, c.checkOut, c.adults, JSON.stringify(c), "RUNNING");
  const ins = d.prepare(`INSERT OR REPLACE INTO search_filters (search_id, key, level, value_json) VALUES (?,?,?,?)`);
  const tx = d.transaction(() => {
    for (const [k, v] of Object.entries(c)) {
      const level = v && typeof v === "object" && "level" in (v as object) ? String((v as { level: string }).level) : null;
      ins.run(id, k, level, JSON.stringify(v));
    }
  });
  tx();
}

export function finishSearch(id: string, status: string, stats: JobStats) {
  db().prepare(`UPDATE searches SET status=?, finished_at=?, stats_json=? WHERE id=?`).run(status, new Date().toISOString(), JSON.stringify(stats), id);
}

export function saveOffer(searchId: string, o: Offer, c: Criteria) {
  const d = db();
  const offerId = `${o.provider}:${o.providerPropertyId}`;
  const now = new Date().toISOString();
  const tx = d.transaction(() => {
    d.prepare(
      `INSERT INTO properties (id, name, normalized_name, address, latitude, longitude, property_type, updated_at) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, address=COALESCE(excluded.address, address), latitude=COALESCE(excluded.latitude, latitude),
       longitude=COALESCE(excluded.longitude, longitude), property_type=COALESCE(excluded.property_type, property_type), updated_at=excluded.updated_at`,
    ).run(offerId, o.name, o.name.toLowerCase(), o.address, o.latitude, o.longitude, o.propertyType, now);
    if (o.detailVerified && !o.fromCache) {
      d.prepare(
        `INSERT OR REPLACE INTO property_offers (id, property_id, provider, provider_property_id, url, room_name, cache_key, checked_at, detail_verified, data_json) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(`${offerId}|${cacheKey(o, c)}`, offerId, o.provider, o.providerPropertyId, o.url, o.roomName, cacheKey(o, c), o.detailCheckedAt ?? now, 1, JSON.stringify(o));
    }
    if (o.availabilityEvidence) d.prepare(`INSERT INTO availability_checks (offer_id, search_id, checked_at, status, evidence_json) VALUES (?,?,?,?,?)`).run(offerId, searchId, o.availabilityEvidence.checkedAt, o.availabilityEvidence.status, JSON.stringify(o.availabilityEvidence));
    if (o.price.totalPrice != null) d.prepare(`INSERT INTO price_checks (offer_id, search_id, checked_at, currency, total, completeness, data_json) VALUES (?,?,?,?,?,?,?)`).run(offerId, searchId, o.price.verifiedAt ?? now, o.price.currency, o.price.totalPrice, o.price.completeness, JSON.stringify(o.price));
    const evs = [
      ...o.availability.evidence, ...o.price.evidence, ...o.bedrooms.evidence, ...o.beds.evidence, ...o.bathrooms.evidence,
      ...o.toilets.evidence, ...o.bathtubs.evidence, ...o.station.evidence, ...o.rating.evidence, ...o.reviewCount.evidence,
    ];
    const ins = d.prepare(`INSERT INTO property_evidence (offer_id, search_id, field, raw_text, source, url, checked_at, confidence, parsed) VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const e of evs) ins.run(offerId, searchId, e.field, e.rawText, e.source, e.url, e.checkedAt, e.confidence, e.parsed ?? null);
  });
  tx();
}

/** Detail cache: same property + dates + guests within ttl minutes. */
export function getCachedOffer(o: { provider: string; providerPropertyId: string }, c: Criteria, ttlMin = 30): Offer | null {
  const row = db()
    .prepare(`SELECT data_json, checked_at FROM property_offers WHERE cache_key=? ORDER BY checked_at DESC LIMIT 1`)
    .get(cacheKey(o, c)) as { data_json: string; checked_at: string } | undefined;
  if (!row) return null;
  if (Date.now() - Date.parse(row.checked_at) > ttlMin * 60000) return null;
  return JSON.parse(row.data_json) as Offer;
}

export function saveResults(searchId: string, results: PropertyResult[]) {
  const d = db();
  const tx = d.transaction(() => {
    d.prepare(`DELETE FROM search_results WHERE search_id=?`).run(searchId);
    const ins = d.prepare(`INSERT INTO search_results (search_id, property_id, status, score, result_json) VALUES (?,?,?,?,?)`);
    for (const r of results) ins.run(searchId, r.id, r.status, r.score, JSON.stringify(r));
  });
  tx();
}

export function saveLog(searchId: string, l: LogEntry) {
  db().prepare(`INSERT INTO activity_logs (search_id, ts, level, provider, msg) VALUES (?,?,?,?,?)`).run(searchId, l.ts, l.level, l.provider ?? null, l.msg);
}

export function listSearches(limit = 30) {
  return db()
    .prepare(`SELECT id, created_at, finished_at, name, destination, check_in, check_out, adults, status, stats_json, saved FROM searches ORDER BY created_at DESC LIMIT ?`)
    .all(limit)
    .map((r) => {
      const row = r as Record<string, unknown>;
      return { ...row, stats: row.stats_json ? JSON.parse(String(row.stats_json)) : null, saved: !!row.saved };
    });
}

export function getSearch(id: string) {
  const d = db();
  const s = d.prepare(`SELECT * FROM searches WHERE id=?`).get(id) as Record<string, string> | undefined;
  if (!s) return null;
  const results = (d.prepare(`SELECT result_json FROM search_results WHERE search_id=? ORDER BY score DESC`).all(id) as { result_json: string }[]).map((r) => JSON.parse(r.result_json) as PropertyResult);
  const logs = d.prepare(`SELECT ts, level, provider, msg FROM activity_logs WHERE search_id=? ORDER BY id`).all(id) as LogEntry[];
  return { search: { ...s, criteria: JSON.parse(s.criteria_json), stats: s.stats_json ? JSON.parse(s.stats_json) : null }, results, logs };
}

/** Remove one search and its per-search rows (the 30-min listing cache is kept). */
export function deleteSearch(id: string) {
  const d = db();
  d.transaction(() => {
    for (const t of ["search_results", "search_filters", "activity_logs", "availability_checks", "price_checks", "property_evidence"]) d.prepare(`DELETE FROM ${t} WHERE search_id=?`).run(id);
    d.prepare(`DELETE FROM searches WHERE id=?`).run(id);
  })();
}

export function setSaved(id: string, saved: boolean) {
  db().prepare(`UPDATE searches SET saved=? WHERE id=?`).run(saved ? 1 : 0, id);
}

export function listFavorites() {
  return db().prepare(`SELECT * FROM favorites ORDER BY updated_at DESC`).all() as { property_id: string; name: string; note: string; created_at: string; updated_at: string; snapshot_json: string }[];
}

export function upsertFavorite(propertyId: string, name: string, note: string, snapshot: unknown) {
  const now = new Date().toISOString();
  db()
    .prepare(
      `INSERT INTO favorites (property_id, name, note, created_at, updated_at, snapshot_json) VALUES (?,?,?,?,?,?)
       ON CONFLICT(property_id) DO UPDATE SET note=excluded.note, name=excluded.name, updated_at=excluded.updated_at, snapshot_json=COALESCE(excluded.snapshot_json, snapshot_json)`,
    )
    .run(propertyId, name, note, now, now, snapshot ? JSON.stringify(snapshot) : null);
}

export function deleteFavorite(propertyId: string) {
  db().prepare(`DELETE FROM favorites WHERE property_id=?`).run(propertyId);
}

export function listPresets() {
  return (db().prepare(`SELECT name, criteria_json, updated_at FROM presets ORDER BY updated_at DESC`).all() as { name: string; criteria_json: string; updated_at: string }[]).map((r) => ({ name: r.name, criteria: JSON.parse(r.criteria_json), updatedAt: r.updated_at }));
}

export function savePreset(name: string, criteria: Criteria) {
  db().prepare(`INSERT OR REPLACE INTO presets (name, criteria_json, updated_at) VALUES (?,?,?)`).run(name, JSON.stringify({ ...criteria, name }), new Date().toISOString());
}

export function deletePreset(name: string) {
  db().prepare(`DELETE FROM presets WHERE name=?`).run(name);
}
