"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CriteriaSchema, type Criteria, type JobSnapshot, type Offer, type PropertyResult, type ResultStatus } from "@/lib/types";
import { KYOTO_PRESET, PRESETS } from "@/lib/presets";
import { buildResults, computeStats } from "@/lib/engine/evaluate";
import { westernBedCount } from "@/lib/engine/sleeping";
import { dateTime, primaryOffer, PROVIDER_STYLE } from "@/lib/format";
import { PROVIDER_LABEL } from "@/lib/types";
import SearchBar, { searchProblems } from "./SearchBar";
import FilterPanel from "./FilterPanel";
import { ActivityLog, BrowserView, Dashboard } from "./StatusPanel";
import PropertyCard from "./PropertyCard";
import EvidenceDrawer from "./EvidenceDrawer";
import CompareTable from "./CompareTable";
import { exportHtml } from "@/lib/export-html";
import { LANGS, LangProvider, translate, type Lang } from "@/lib/i18n";

const STORE_KEY = "stay-agent:criteria";
const BASIC_KEYS = ["destination", "checkIn", "checkOut", "adults", "children", "childrenAges", "rooms", "currency"] as const;

type HistoryRow = { id: string; created_at: string; name: string; destination: string; check_in: string; check_out: string; adults: number; status: string; stats: { matched: number; searched: number } | null; saved: boolean };
type Fav = { property_id: string; name: string; note: string };

const SORTS: [string, string][] = [
  ["best", "Best Match"],
  ["price", "Lowest Total Price"],
  ["rating", "Highest Rating"],
  ["reviews", "Most Reviews"],
  ["station", "Closest Station"],
  ["bedrooms", "Most Bedrooms"],
  ["beds", "Most Beds"],
  ["cancellation", "Best Cancellation"],
  ["trust", "Highest Trust"],
];

function sortResults(list: PropertyResult[], key: string) {
  const big = Number.MAX_SAFE_INTEGER;
  const by = (f: (r: PropertyResult) => number, dir = 1) => [...list].sort((a, b) => dir * (f(a) - f(b)));
  switch (key) {
    case "price":
      return by((r) => primaryOffer(r).price.totalPrice ?? big);
    case "rating":
      return by((r) => primaryOffer(r).rating.value?.normalized ?? -1, -1);
    case "reviews":
      return by((r) => primaryOffer(r).reviewCount.value ?? -1, -1);
    case "station":
      return by((r) => {
        const s = primaryOffer(r).station.value;
        return s?.walkMinutes != null ? s.walkMinutes * 80 : s?.distanceM ?? big;
      });
    case "bedrooms":
      return by((r) => primaryOffer(r).bedrooms.value ?? -1, -1);
    case "beds":
      return by((r) => westernBedCount(primaryOffer(r)) ?? -1, -1);
    case "cancellation":
      return by((r) => (primaryOffer(r).cancellation.freeCancellation ? 0 : primaryOffer(r).cancellation.freeCancellation === false ? 2 : 1));
    case "trust":
      return by((r) => r.trust.score, -1);
    default:
      return by((r) => r.score, -1);
  }
}

const JOB_STATUS_LABEL: Record<string, string> = { RUNNING: "Running", PAUSED: "Paused", WAITING_FOR_USER: "Waiting", STOPPING: "Stopping…", STOPPED: "Stopped", COMPLETED: "Completed", FAILED: "Failed" };

export default function App() {
  const [criteria, setCriteria] = useState<Criteria>(KYOTO_PRESET);
  const [job, setJob] = useState<JobSnapshot | null>(null);
  const [browser, setBrowser] = useState<{ open: boolean; channel: string | null }>({ open: false, channel: null });
  const [loaded, setLoaded] = useState<{ criteria: Criteria; results: PropertyResult[]; logs: JobSnapshot["logs"]; id: string; at?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<ResultStatus | "FAV">("MATCHED");
  // render long lists in pages so a 500-result tab stays responsive
  const PAGE = 60;
  const [shownCount, setShownCount] = useState(PAGE);
  useEffect(() => setShownCount(PAGE), [tab, criteria.sort]);
  const [evidence, setEvidence] = useState<PropertyResult | null>(null);
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [favs, setFavs] = useState<Fav[]>([]);
  const [dark, setDark] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lang, setLang] = useState<Lang>("zh");
  const [userPresets, setUserPresets] = useState<{ name: string; criteria: Criteria }[]>([]);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const t = (s: string) => translate(lang, s);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    try {
      const l = localStorage.getItem("stay-agent:lang");
      if (l === "en" || l === "zh" || l === "ja") setLang(l);
    } catch {
      /* storage unavailable */
    }
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const p = CriteriaSchema.safeParse(JSON.parse(raw));
        if (p.success) setCriteria(p.data);
      }
    } catch {
      /* storage unavailable */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(criteria));
    } catch {
      /* ignore */
    }
  }, [criteria]);

  const upd = useCallback((fn: (c: Criteria) => void) => {
    setCriteria((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  const active = !!job && ["RUNNING", "PAUSED", "WAITING_FOR_USER", "STOPPING"].includes(job.status);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/job", { cache: "no-store" });
      const d = (await r.json()) as { job: JobSnapshot | null; browser: { open: boolean; channel: string | null } };
      setJob(d.job);
      setBrowser(d.browser);
    } catch {
      /* server restarting */
    }
  }, []);
  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch("/api/history", { cache: "no-store" });
      setHistory(((await r.json()) as { searches: HistoryRow[] }).searches);
    } catch {
      /* ignore */
    }
  }, []);
  const loadFavs = useCallback(async () => {
    try {
      const r = await fetch("/api/favorites", { cache: "no-store" });
      setFavs(((await r.json()) as { favorites: Fav[] }).favorites);
    } catch {
      /* ignore */
    }
  }, []);

  const loadPresets = useCallback(async () => {
    try {
      const r = await fetch("/api/presets", { cache: "no-store" });
      setUserPresets(((await r.json()) as { presets: { name: string; criteria: Criteria }[] }).presets);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    poll();
    loadHistory();
    loadFavs();
    loadPresets();
  }, [poll, loadHistory, loadFavs, loadPresets]);
  useEffect(() => {
    const t = setInterval(poll, active ? 1500 : 6000);
    return () => clearInterval(t);
  }, [active, poll]);
  useEffect(() => {
    if (job && !active) loadHistory();
  }, [job?.status, active, loadHistory, job]);

  const startSearch = async (override?: Criteria) => {
    const problems = searchProblems(override ?? criteria);
    // the search bar already lists problems with the current form
    if (problems.length) return;
    setError(null);
    setLoaded(null);
    const r = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ criteria: override ?? criteria }) });
    const d = await r.json();
    if (!r.ok) {
      setError(d.error ?? t("Search failed to start"));
      return;
    }
    setTab("MATCHED");
    setCompare([]);
    poll();
  };

  const control = async (action: string) => {
    await fetch("/api/job/control", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    poll();
  };

  const openHistory = async (id: string, rerun = false) => {
    const r = await fetch(`/api/history/${id}`, { cache: "no-store" });
    if (!r.ok) return;
    const d = (await r.json()) as { search: { criteria: Criteria }; results: PropertyResult[]; logs: JobSnapshot["logs"] };
    const parsed = CriteriaSchema.safeParse(d.search.criteria);
    if (parsed.success) setCriteria(parsed.data);
    setShowHistory(false);
    if (rerun && parsed.success) {
      setLoaded(null);
      startSearch(parsed.data);
    } else setLoaded({ criteria: parsed.success ? parsed.data : criteria, results: d.results, logs: d.logs, id });
  };

  // After a server restart there is no job in memory: show the latest saved search instead of an empty page
  const [polled, setPolled] = useState(false);
  const autoLoaded = useRef(false);
  useEffect(() => {
    if (job) setPolled(true);
  }, [job]);
  useEffect(() => {
    const t = setTimeout(() => setPolled(true), 2500);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (autoLoaded.current || !polled || job || loaded) return;
    const last = history.find((h) => h.status === "COMPLETED" || h.status === "STOPPED");
    if (!last) return;
    autoLoaded.current = true;
    fetch(`/api/history/${last.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { search: { criteria: Criteria }; results: PropertyResult[]; logs: JobSnapshot["logs"] } | null) => {
        if (!d) return;
        const parsed = CriteriaSchema.safeParse(d.search.criteria);
        setLoaded({ criteria: parsed.success ? parsed.data : criteria, results: d.results, logs: d.logs, id: last.id });
      })
      .catch(() => {});
  }, [polled, job, loaded, history, criteria]);

  /** Loading a preset shows that preset's latest saved results (instead of whatever ran last). */
  const showSavedFor = (p: Criteria) => {
    const same = history.filter((x) => (x.status === "COMPLETED" || x.status === "STOPPED") && (x.name === p.name || (x.destination === p.destination && x.check_in === p.checkIn && x.check_out === p.checkOut)));
    // a search the user saved wins, then a finished one, then a stopped (partial) one; newest first within each
    const rank = (x: (typeof same)[number]) => (x.saved ? 0 : x.status === "COMPLETED" ? 1 : 2);
    const h = same.find((x) => rank(x) === Math.min(...same.map(rank)));
    if (!h) {
      setLoaded(null);
      return;
    }
    fetch(`/api/history/${h.id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { search: { criteria: Criteria; created_at: string }; results: PropertyResult[]; logs: JobSnapshot["logs"] } | null) => {
        if (!d) return;
        const parsed = CriteriaSchema.safeParse(d.search.criteria);
        setLoaded({ criteria: parsed.success ? parsed.data : p, results: d.results, logs: d.logs, id: h.id, at: d.search.created_at });
      })
      .catch(() => {});
  };

  // Source = loaded history search, else the current/last job
  const source: { criteria: Criteria; results: PropertyResult[]; logs: JobSnapshot["logs"]; id: string; at?: string } | null = loaded ?? (job ? { criteria: job.criteria, results: job.results, logs: job.logs, id: job.id, at: job.startedAt } : null);

  // Re-evaluate collected offers with the current filter settings (search basics stay bound to the search that collected them)
  const results = useMemo(() => {
    if (!source) return [];
    const offers = new Map<string, Offer>();
    for (const r of source.results) for (const o of r.offers) offers.set(`${o.provider}:${o.providerPropertyId}`, o);
    // Live filter tuning only applies to results of the same trip (destination/dates/guests);
    // results of a different search keep that search's own filters.
    const sameTrip = BASIC_KEYS.every((k) => JSON.stringify(source.criteria[k]) === JSON.stringify(criteria[k]));
    const evalC = sameTrip ? ({ ...criteria } as Criteria) : source.criteria;
    for (const k of BASIC_KEYS) (evalC as Record<string, unknown>)[k] = source.criteria[k];
    try {
      return buildResults([...offers.values()], evalC, lang);
    } catch {
      return source.results;
    }
  }, [source, criteria, lang]);

  const stats = useMemo(() => computeStats(results), [results]);
  const favMap = useMemo(() => new Map(favs.map((f) => [f.property_id, f])), [favs]);
  const tabList = useMemo(() => {
    const list = tab === "FAV" ? results.filter((r) => favMap.has(r.id)) : results.filter((r) => r.status === tab);
    return sortResults(list, criteria.sort);
  }, [results, tab, criteria.sort, favMap]);

  const setFavorite = async (r: PropertyResult, note: string | null) => {
    if (note == null) await fetch(`/api/favorites?id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
    else await fetch("/api/favorites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ propertyId: r.id, name: r.name, note, snapshot: { name: r.name, url: primaryOffer(r).url, total: primaryOffer(r).price.totalPrice } }) });
    loadFavs();
  };

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  const compareItems = results.filter((r) => compare.includes(r.id));
  const searchDirty = source && BASIC_KEYS.some((k) => JSON.stringify(source.criteria[k]) !== JSON.stringify(criteria[k]));

  const changeLang = (l: Lang) => {
    setLang(l);
    document.documentElement.lang = l === "zh" ? "zh-Hant" : l;
    try {
      localStorage.setItem("stay-agent:lang", l);
    } catch {
      /* ignore */
    }
  };

  return (
    <LangProvider value={lang}>
    <div className="mx-auto max-w-[1500px] px-4 pb-16">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Stay Agent</h1>
          <p className="text-xs text-stone-500">{t("Local accommodation research · Booking · Agoda · Airbnb · Trip.com")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input h-9 w-auto max-w-64"
            aria-label={t("Load preset…")}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              const p = v.startsWith("b:") ? PRESETS.find((x) => x.name === v.slice(2)) : userPresets.find((x) => x.name === v.slice(2))?.criteria;
              if (!p) return;
              setCriteria(structuredClone(p));
              showSavedFor(p);
            }}
          >
            <option value="">{t("Load preset…")}</option>
            <optgroup label={t("Built-in presets")}>
              {PRESETS.map((p) => (
                <option key={p.name} value={`b:${p.name}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            {userPresets.length > 0 && (
              <optgroup label={t("My presets")}>
                {userPresets.map((p) => (
                  <option key={p.name} value={`u:${p.name}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button className="btn" onClick={() => setPresetOpen(!presetOpen)}>
            {t("Save as preset")}
          </button>
          <button className="btn" onClick={() => setShowHistory(!showHistory)}>
            {t("History")}
          </button>
          <button className="btn" title="Open the 4 sites in the persistent Chromium profile to sign in once" onClick={() => fetch("/api/browser", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "login" }) }).then(poll)}>
            {t("Open browser for sign-in")}
          </button>
          <button className="btn" onClick={toggleTheme} aria-label={t("Toggle dark mode")}>
            {dark ? t("Light") : t("Dark")}
          </button>
          <select className="input h-9 w-auto" value={lang} onChange={(e) => changeLang(e.target.value as Lang)} aria-label="Language">
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </header>

      {presetOpen && (
        <div className="card mb-4 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input className="input max-w-sm" placeholder={t("Preset name")} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
            <button
              className="btn-primary"
              disabled={!presetName.trim()}
              onClick={async () => {
                await fetch("/api/presets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: presetName.trim(), criteria: { ...criteria, name: presetName.trim() } }) });
                setPresetName("");
                loadPresets();
              }}
            >
              {t("Save")}
            </button>
            <span className="text-xs text-stone-500">{t("Saves all current search settings and filters.")}</span>
          </div>
          {userPresets.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2 text-xs">
              {userPresets.map((p) => (
                <li key={p.name} className="flex items-center gap-1 rounded border border-stone-200 px-2 py-1 dark:border-stone-700">
                  <button className="hover:underline" onClick={() => setCriteria(structuredClone(p.criteria))}>
                    {p.name}
                  </button>
                  <button className="text-stone-400 hover:text-rose-600" title={t("Delete")} onClick={() => fetch(`/api/presets?name=${encodeURIComponent(p.name)}`, { method: "DELETE" }).then(loadPresets)}>
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showHistory && (
        <div className="card mb-4 max-h-80 overflow-y-auto p-3">
          <div className="mb-2 text-sm font-semibold">{t("Previous searches")}</div>
          {!history.length && <div className="text-sm text-stone-500">{t("No searches yet.")}</div>}
          <ul className="divide-y divide-stone-200 text-sm dark:divide-stone-800">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <span className="font-medium">{h.name}</span>{" "}
                  <span className="text-xs text-stone-500">
                    {h.check_in} → {h.check_out} · {t("{n} adults").replace("{n}", String(h.adults))} · {dateTime(h.created_at, lang)} · {t(JOB_STATUS_LABEL[h.status] ?? h.status)}
                    {h.stats ? ` · ${t("searched")} ${h.stats.searched} · ${t("matched")} ${h.stats.matched}` : ""}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn h-7 text-xs text-rose-700 dark:text-rose-400"
                    disabled={active && job?.id === h.id}
                    onClick={async () => {
                      if (!window.confirm(`${t("Delete this search from the history?")}\n${h.name}`)) return;
                      await fetch(`/api/history/${h.id}`, { method: "DELETE" });
                      if (loaded?.id === h.id) setLoaded(null);
                      loadHistory();
                    }}
                  >
                    {t("Delete")}
                  </button>
                  <button className="btn h-7 text-xs" onClick={() => openHistory(h.id)}>
                    {t("View results")}
                  </button>
                  <button className="btn h-7 text-xs" disabled={active} onClick={() => openHistory(h.id, true)}>
                    {t("Run again")}
                  </button>
                  <button
                    className="btn h-7 text-xs"
                    onClick={() => fetch(`/api/history/${h.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ saved: !h.saved }) }).then(loadHistory)}
                    title="Saved searches are kept for a future watchlist; no background monitoring runs yet"
                  >
                    {h.saved ? t("★ Saved") : t("Save search")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <SearchBar c={criteria} upd={upd} onSearch={() => startSearch()} busy={active} error={error} />

      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside>
          <button className="btn mb-2 w-full lg:hidden" onClick={() => setFiltersOpen(!filtersOpen)}>
            {filtersOpen ? t("Hide filters") : t("Show filters")}
          </button>
          <div className={`${filtersOpen ? "block" : "hidden"} lg:sticky lg:top-4 lg:block lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto`}>
            <FilterPanel c={criteria} upd={upd} />
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {source && (
            <div className="card flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              <span className="text-xs text-stone-500">{t("Showing results of")}</span>
              <span className="font-semibold">{source.criteria.name || source.criteria.destination}</span>
              <span>{source.criteria.destination} · {source.criteria.checkIn} → {source.criteria.checkOut} · {t("Adults")} {source.criteria.adults} · {t("Rooms")} {source.criteria.rooms}</span>
              <span className="flex gap-1">{source.criteria.providers.map((p) => <span key={p} className={`chip ${PROVIDER_STYLE[p]}`}>{PROVIDER_LABEL[p]}</span>)}</span>
              {source.at && <span className="text-xs text-stone-500">{dateTime(source.at, lang)}</span>}
            </div>
          )}
          <Dashboard stats={stats} job={loaded ? null : job} />
          {!loaded && <BrowserView job={job} onControl={control} browser={browser} />}
          {source && <ActivityLog logs={source.logs} running={active} />}
          {loaded && (
            <div className="flex items-center justify-between rounded border border-stone-300 bg-stone-100 px-3 py-2 text-xs dark:border-stone-700 dark:bg-stone-900">
              {t("Saved results")} ({loaded.criteria.destination} {loaded.criteria.checkIn} → {loaded.criteria.checkOut}). {t("Prices and availability are as captured at that time.")}
              <button className="btn h-7 text-xs" onClick={() => setLoaded(null)}>
                {t("Back to current")}
              </button>
            </div>
          )}
          {searchDirty && <div className="text-xs text-amber-700 dark:text-amber-400">{t("Destination/dates/guests changed – results below still belong to the previous search. Press Search to run again.")}</div>}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="tablist" aria-label={t("Results")} className="flex flex-wrap overflow-hidden rounded-md border border-stone-300 text-sm dark:border-stone-700">
              {(
                [
                  ["MATCHED", `${t("Matched")} (${stats.matched})`],
                  ["REVIEW", `${t("Needs review")} (${stats.review})`],
                  ["REJECTED", `${t("Rejected")} (${stats.rejected})`],
                  ["FAV", `${t("Favorites")} (${results.filter((r) => favMap.has(r.id)).length})`],
                ] as const
              ).map(([k, label]) => (
                <button key={k} role="tab" aria-selected={tab === k} className={`px-3 py-1.5 ${tab === k ? "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900" : "hover:bg-stone-100 dark:hover:bg-stone-800"}`} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              {compare.length > 0 && (
                <button className="btn-primary h-8" onClick={() => setShowCompare(true)}>
                  {t("Compare")} {compare.length}
                </button>
              )}
              <button
                className="btn h-8"
                disabled={!results.length || !source}
                title={t("Export HTML")}
                onClick={() => {
                  if (!source) return;
                  const favNotes = new Map(favs.map((f) => [f.property_id, f.note ?? ""]));
                  const ids = sortResults(results, criteria.sort).map((r) => r.id);
                  const html = exportHtml(results, { ...criteria, ...Object.fromEntries(BASIC_KEYS.map((k) => [k, source.criteria[k]])), name: source.criteria.name } as Criteria, stats, lang, favNotes, ids);
                  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `stay-agent-${source.criteria.destination}-${source.criteria.checkIn}_${source.criteria.checkOut}.html`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 5000);
                }}
              >
                {t("Export HTML")}
              </button>
              <select className="input h-8 w-auto" aria-label={t("Sort")} value={criteria.sort} onChange={(e) => upd((d) => void (d.sort = e.target.value))}>
                {SORTS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {t(l)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {tab === "REVIEW" && tabList.length > 0 && <p className="text-xs text-stone-500">{t("No hard failure, but at least one REQUIRED value could not be verified on the listing (UNKNOWN). Check the evidence before booking.")}</p>}

          <div className="space-y-3">
            {tabList.slice(0, shownCount).map((r) => (
              <PropertyCard
                key={r.id}
                r={r}
                c={source?.criteria ?? criteria}
                onEvidence={() => setEvidence(r)}
                compared={compare.includes(r.id)}
                compareFull={compare.length >= 5}
                onCompare={() => setCompare((x) => (x.includes(r.id) ? x.filter((y) => y !== r.id) : x.length >= 5 ? x : [...x, r.id]))}
                favorite={favMap.get(r.id) ?? null}
                onFavorite={(note) => setFavorite(r, note)}
              />
            ))}
            {tabList.length > shownCount && (
              <button className="btn w-full" onClick={() => setShownCount((n) => n + PAGE)}>
                {t("Show more")} ({tabList.length - shownCount})
              </button>
            )}
            {!tabList.length && (
              <div className="card p-8 text-center text-sm text-stone-500">
                {t(!source ? "Enter your requirements and press Search. A Chromium window opens and does the browsing." : active ? "Searching… results appear here as properties are verified." : "Nothing in this tab.")}
              </div>
            )}
          </div>
        </main>
      </div>

      {evidence && <EvidenceDrawer r={evidence} onClose={() => setEvidence(null)} />}
      {showCompare && compareItems.length > 0 && <CompareTable items={compareItems} onClose={() => setShowCompare(false)} onRemove={(id) => setCompare((x) => x.filter((y) => y !== id))} />}
    </div>
    </LangProvider>
  );
}
