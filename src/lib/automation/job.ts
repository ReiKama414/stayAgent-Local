import type { Page } from "playwright";
import type { Criteria, JobSnapshot, JobStatus, LogEntry, Offer, ProviderId, ProviderState } from "../types";
import { PROVIDER_LABEL } from "../types";
import { getContext, newPage } from "./browser";
import { buildResults, cheapFilter, computeStats } from "../engine/evaluate";
import { createSearch, deleteSearch, finishSearch, getCachedOffer, saveLog, saveOffer, saveResults } from "../db";
import { PROVIDER_IMPLS } from "@/providers";
import { detectBlock } from "@/providers/common";
import { fillStationFromMap, prefetchStations } from "../osm";
import { StopError, type ProviderRunContext } from "@/providers/types";

/** Every result page is read (capped for politeness) and every candidate that passes the cheap filters gets its detail page opened. */
const LIMITS = { candidates: 200, details: Infinity };
const DETAIL_TABS = 3;

class Job {
  id: string;
  criteria: Criteria;
  status: JobStatus = "RUNNING";
  waitingReason: string | null = null;
  startedAt = new Date().toISOString();
  finishedAt: string | null = null;
  providers: JobSnapshot["providers"];
  currentProvider: ProviderId | null = null;
  currentUrl: string | null = null;
  stageText = "Starting";
  progressVal: { current: number; total: number } | null = null;
  screenshotData: string | null = null;
  logs: LogEntry[] = [];
  offers = new Map<string, Offer>();
  results: JobSnapshot["results"] = [];
  private paused = false;
  private skipped = new Set<ProviderId>();
  private stopped = false;
  private pauseWaiters: (() => void)[] = [];
  private userWaiters: (() => void)[] = [];
  private pages = new Set<Page>();
  private lastShot = 0;

  constructor(id: string, criteria: Criteria) {
    this.id = id;
    this.criteria = criteria;
    this.providers = Object.fromEntries(
      (["booking", "agoda", "airbnb", "trip"] as ProviderId[]).map((p) => [p, { state: (criteria.providers.includes(p) ? "PENDING" : "SKIPPED") as ProviderState, found: 0, detailed: 0 }]),
    ) as JobSnapshot["providers"];
  }

  log(msg: string, level: LogEntry["level"] = "info", provider?: ProviderId) {
    const e: LogEntry = { ts: new Date().toISOString(), level, provider, msg };
    this.logs.push(e);
    if (this.logs.length > 600) this.logs.splice(0, this.logs.length - 600);
    try {
      saveLog(this.id, e);
    } catch {
      /* logging must never break the run */
    }
  }

  snapshot(): JobSnapshot {
    return {
      id: this.id,
      searchId: this.id,
      status: this.status,
      waitingReason: this.waitingReason,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      providers: this.providers,
      currentProvider: this.currentProvider,
      currentUrl: this.currentUrl,
      stage: this.stageText,
      progress: this.progressVal,
      screenshot: this.screenshotData,
      logs: this.logs.slice(-300),
      stats: computeStats(this.results),
      results: this.results,
      criteria: this.criteria,
    };
  }

  pause() {
    if (this.status !== "RUNNING") return;
    this.paused = true;
    this.status = "PAUSED";
    this.log("Paused by user");
  }

  resume() {
    if (this.status === "WAITING_FOR_USER") return this.continueAfterUser();
    if (!this.paused) return;
    this.paused = false;
    this.status = "RUNNING";
    this.log("Resumed");
    this.pauseWaiters.splice(0).forEach((r) => r());
  }

  continueAfterUser() {
    this.log("User pressed continue", "info", this.currentProvider ?? undefined);
    this.userWaiters.splice(0).forEach((r) => r());
  }

  /** Give up on the provider that needs manual interaction; its search-card data is kept. */
  skipProvider() {
    const p = this.currentProvider;
    if (!p) return;
    this.skipped.add(p);
    this.log(`${PROVIDER_LABEL[p]} skipped by user (needs manual interaction)`, "warn", p);
    this.userWaiters.splice(0).forEach((r) => r());
  }

  async stop() {
    if (["STOPPED", "COMPLETED", "FAILED"].includes(this.status)) return;
    this.stopped = true;
    this.status = "STOPPING";
    this.log("Stop requested", "warn");
    this.pauseWaiters.splice(0).forEach((r) => r());
    this.userWaiters.splice(0).forEach((r) => r());
    // closing our tabs makes in-flight navigations reject quickly; the browser/profile stays open
    for (const p of this.pages) await p.close().catch(() => {});
  }

  /**
   * A property may take at most 120 s of running time (time paused or waiting for the user does not count).
   * On timeout its tab is closed so one stuck page can never block the search.
   */
  private async withPropertyTimeout(work: Promise<void>, tab: Page) {
    let done = false;
    let failed: unknown = null;
    work.then(() => (done = true)).catch((e) => ((failed = e), (done = true)));
    let used = 0;
    while (!done) {
      await new Promise((r) => setTimeout(r, 1000));
      if (this.status === "RUNNING") used += 1000;
      if (this.stopped) throw new StopError();
      if (used > 120000) {
        await tab.close().catch(() => {});
        throw new Error("took longer than 120 s – skipped");
      }
    }
    if (failed) throw failed;
  }

  private refresh() {
    this.results = buildResults([...this.offers.values()], this.criteria);
  }

  private makeCtx(provider: ProviderId): ProviderRunContext {
    const self = this;
    const headless = this.criteria.settings.headless;
    return {
      provider,
      criteria: this.criteria,
      log: (msg, level) => self.log(msg, level, provider),
      stage: (t) => {
        self.stageText = t;
      },
      progress: (current, total) => {
        self.progressVal = { current, total };
      },
      isStopped: () => self.stopped,
      async sleep(ms) {
        const end = Date.now() + ms * (0.8 + Math.random() * 0.4);
        while (Date.now() < end) {
          if (self.stopped) throw new StopError();
          await new Promise((r) => setTimeout(r, Math.min(250, end - Date.now())));
        }
      },
      async newPage() {
        const p = await newPage(headless);
        self.pages.add(p);
        p.on("close", () => self.pages.delete(p));
        return p;
      },
      async screenshot(page) {
        if (!self.criteria.settings.screenshots || Date.now() - self.lastShot < 2500) return;
        self.lastShot = Date.now();
        try {
          const buf = await page.screenshot({ type: "jpeg", quality: 45, timeout: 4000 });
          self.screenshotData = `data:image/jpeg;base64,${buf.toString("base64")}`;
        } catch {
          /* optional */
        }
      },
      async checkpoint(page, label) {
        if (self.stopped) throw new StopError();
        if (self.skipped.has(provider)) throw new Error("NEEDS_MANUAL_INTERACTION: skipped by user");
        while (self.paused) {
          await new Promise<void>((r) => self.pauseWaiters.push(r));
          if (self.stopped) throw new StopError();
        }
        try {
          self.currentUrl = page.url();
        } catch {
          /* page closed */
        }
        await this.screenshot(page);
        let reason = await detectBlock(page);
        let rounds = 0;
        while (reason) {
          if (headless) {
            self.providers[provider].state = "WAITING";
            throw new Error(`NEEDS_MANUAL_INTERACTION: ${reason} – switch to Visible Browser and retry`);
          }
          rounds++;
          self.status = "WAITING_FOR_USER";
          self.waitingReason = `${PROVIDER_LABEL[provider]}: ${reason}${label ? ` (${label})` : ""}`;
          self.providers[provider].state = "WAITING";
          self.log(`${PROVIDER_LABEL[provider]} needs manual verification: ${reason}. Complete it in the Chromium window, then press Continue.`, "warn", provider);
          await page.bringToFront().catch(() => {});
          await new Promise<void>((r) => self.userWaiters.push(r));
          if (self.stopped) throw new StopError();
          if (self.skipped.has(provider)) {
            self.status = self.paused ? "PAUSED" : "RUNNING";
            self.waitingReason = null;
            throw new Error("NEEDS_MANUAL_INTERACTION: skipped by user");
          }
          await new Promise((r) => setTimeout(r, 800));
          reason = await detectBlock(page);
          if (reason && rounds < 20) self.log(`Still blocked: ${reason}`, "warn", provider);
          if (rounds >= 20) break;
        }
        if (self.status === "WAITING_FOR_USER") {
          self.status = self.paused ? "PAUSED" : "RUNNING";
          self.waitingReason = null;
          self.providers[provider].state = "RUNNING";
          self.log(`${PROVIDER_LABEL[provider]} resumed from current page`, "success", provider);
        }
      },
      async requestUser(page, reason) {
        if (headless) throw new Error(`NEEDS_MANUAL_INTERACTION: ${reason} – switch to Visible Browser and retry`);
        self.status = "WAITING_FOR_USER";
        self.waitingReason = `${PROVIDER_LABEL[provider]}: ${reason}`;
        self.providers[provider].state = "WAITING";
        self.log(`${PROVIDER_LABEL[provider]} needs manual interaction: ${reason}. Use the Chromium window, then press Continue (or Skip platform).`, "warn", provider);
        await page.bringToFront().catch(() => {});
        await new Promise<void>((r) => self.userWaiters.push(r));
        if (self.stopped) throw new StopError();
        self.status = self.paused ? "PAUSED" : "RUNNING";
        self.waitingReason = null;
        self.providers[provider].state = "RUNNING";
        if (self.skipped.has(provider)) throw new Error("NEEDS_MANUAL_INTERACTION: skipped by user");
        self.log(`${PROVIDER_LABEL[provider]} resumed from current page`, "success", provider);
      },
    };
  }

  async run() {
    const c = this.criteria;
    const limits = LIMITS;
    this.log(`Search started: ${c.destination} ${c.checkIn} → ${c.checkOut}, ${c.adults} adults, ${c.settings.headless ? "headless" : "visible browser"}`);
    try {
      await getContext(c.settings.headless);
    } catch (e) {
      this.log(`Could not start Chromium: ${(e as Error).message}`, "error");
      this.status = "FAILED";
      this.finish();
      return;
    }
    for (const pid of c.providers) {
      if (this.stopped) break;
      if (pid === "airbnb" && c.rooms > 1) {
        this.providers.airbnb.state = "SKIPPED";
        this.log(`Airbnb rents whole listings only; skipped because ${c.rooms} separate rooms were requested`, "warn", "airbnb");
        continue;
      }
      await this.runProvider(pid, limits);
    }
    this.refresh();
    this.status = this.stopped ? "STOPPED" : "COMPLETED";
    const s = computeStats(this.results);
    this.log(`Search ${this.stopped ? "stopped" : "complete"}: ${s.searched} searched, ${s.available} available, ${s.detailVerified} detail-verified, ${s.matched} matched, ${s.review} need review, ${s.rejected} rejected`, "success");
    this.finish();
  }

  private finish() {
    this.finishedAt = new Date().toISOString();
    this.currentProvider = null;
    this.stageText = this.status === "COMPLETED" ? "Done" : this.status === "STOPPED" ? "Stopped" : this.status === "FAILED" ? "Failed" : this.status;
    this.progressVal = null;
    try {
      // stopped before anything was collected: nothing worth keeping in the history
      if (this.status === "STOPPED" && !this.results.length) return deleteSearch(this.id);
      saveResults(this.id, this.results);
      finishSearch(this.id, this.status, computeStats(this.results));
    } catch (e) {
      this.log(`DB save failed: ${(e as Error).message}`, "error");
    }
  }

  private async runProvider(pid: ProviderId, limits: { candidates: number; details: number }) {
    const impl = PROVIDER_IMPLS[pid];
    const ctx = this.makeCtx(pid);
    const st = this.providers[pid];
    this.currentProvider = pid;
    st.state = "RUNNING";
    this.log(`${impl.label} search started`, "info", pid);
    let page: Page | null = null;
    let detailFailures = 0;
    try {
      page = await ctx.newPage();
      await impl.search(ctx, page);
      ctx.stage("Collecting search results");
      const found = await impl.parseSearchResults(ctx, page, limits.candidates);
      st.found = found.length;
      this.log(`Found ${found.length} properties`, found.length ? "info" : "warn", pid);
      for (const o of found) this.offers.set(`${o.provider}:${o.providerPropertyId}`, o);
      this.refresh();
      // Stop pressed while the list was loading: the cards collected so far are kept as card-only results
      if (this.stopped) throw new StopError();

      // Stage 4: cheap filters on search-card data
      const candidates: Offer[] = [];
      for (const o of found) {
        const fails = cheapFilter(o, this.criteria);
        const multi = o.errors.find((e) => e.includes("combines")) && this.criteria.rooms === 1;
        if (!fails.length && !multi) candidates.push(o);
      }
      this.log(`${candidates.length} passed cheap filters`, "info", pid);
      const toDetail = candidates.slice(0, limits.details);
      if (!toDetail.length) {
        st.state = found.length ? "DONE" : "PARTIAL";
        return;
      }

      // Stage 6-8: property detail verification with limited concurrency
      const queue = [...toDetail];
      let done = 0;
      const total = toDetail.length;
      const worker = async (first: Page | null) => {
        let wp: Page | null = first;
        while (queue.length && !this.stopped) {
          const o = queue.shift()!;
          const idx = ++done;
          this.progressVal = { current: idx, total };
          const cached = !this.criteria.settings.forceRefresh ? getCachedOffer(o, this.criteria, 30) : null;
          if (cached) {
            const age = Date.now() - Date.parse(cached.detailCheckedAt ?? "");
            cached.fromCache = true;
            if (age > 15 * 60000 && cached.availability.confidence === "VERIFIED") {
              cached.availability = { ...cached.availability, confidence: "LIKELY", note: `cached ${Math.round(age / 60000)} min ago` };
            }
            // this search's platform filters (not stored in the cache) still apply to the cached listing
            cached.platformTypes = o.platformTypes ?? cached.platformTypes ?? null;
            cached.platformFeatures = o.platformFeatures;
            this.offers.set(`${o.provider}:${o.providerPropertyId}`, cached);
            st.detailed++;
            this.log(`Property ${idx}/${total} from cache (${Math.round(age / 60000)} min old): ${o.name}`, "info", pid);
            this.refresh();
            continue;
          }
          try {
            wp ??= await ctx.newPage();
            ctx.stage(`Checking property ${idx} / ${total}`);
            this.log(`Opening property ${idx}/${total}: ${o.name}`, "info", pid);
            const tab = wp;
            await this.withPropertyTimeout(
              (async () => {
                await impl.openProperty(ctx, tab, o);
                ctx.stage(`Parsing property ${idx} / ${total} – rooms, beds, bathrooms`);
                await impl.parsePropertyDetails(ctx, tab, o);
                ctx.stage(`Verifying availability ${idx} / ${total}`);
                await impl.verifyAvailability(ctx, tab, o);
                await impl.verifyPrice(ctx, tab, o);
              })(),
              tab,
            );
            o.detailVerified = true;
            o.detailCheckedAt = new Date().toISOString();
            st.detailed++;
            const bits = [
              `avail ${o.availability.value}`,
              `bedrooms ${o.bedrooms.value ?? "?"}`,
              `baths ${o.bathrooms.value ?? "?"}`,
              `tubs ${o.bathtubs.value != null ? (o.bathtubs.qualifier === "atLeast" ? "≥" : "") + o.bathtubs.value : "?"} ${o.bathtubs.confidence}`,
              `total ${o.price.totalPrice ?? (o.price.basePrice != null ? `${o.price.basePrice} + tax?` : "?")} (${o.price.completeness})`,
            ];
            this.log(`Parsed ${o.name}: ${bits.join(", ")}`, "success", pid);
            try {
              saveOffer(this.id, o, this.criteria);
            } catch (e) {
              this.log(`DB: ${(e as Error).message}`, "error", pid);
            }
          } catch (e) {
            if (e instanceof StopError || this.stopped) throw new StopError();
            const msg = (e as Error).message?.split("\n")[0] ?? String(e);
            if (msg.startsWith("NEEDS_MANUAL_INTERACTION")) throw e;
            detailFailures++;
            o.errors.push(`detail: ${msg}`);
            this.log(`Property ${idx}/${total} failed (${msg}); continuing`, "warn", pid);
            if (wp && wp.isClosed()) wp = null;
          }
          this.refresh();
          await ctx.sleep(1500);
        }
        if (wp && wp !== page) await wp.close().catch(() => {});
      };
      const n = DETAIL_TABS;
      await Promise.all([worker(page), ...Array.from({ length: n - 1 }, () => worker(null))]);
      // second pass: listings that still have no station get the nearest one from OpenStreetMap (sequential, rate-limited)
      const missing = [...this.offers.values()].filter((o) => o.provider === pid && o.detailVerified && !o.station.value && o.latitude != null);
      if (missing.length && !this.stopped) {
        ctx.stage(`Looking up nearest stations on OpenStreetMap (${missing.length})`);
        // the request runs inside the browser tab (same-origin on overpass-api.de); Node's network path is not always allowed out
        const viaBrowser = async (url: string, body: string) => {
          const tab = await ctx.newPage();
          try {
            await tab.goto(new URL(url).origin + "/api/status", { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
            return await tab.evaluate(
              async ([u, b]) => {
                const r = await fetch(u, { method: "POST", body: b, headers: { "content-type": "application/x-www-form-urlencoded" } });
                return r.ok ? await r.text() : null;
              },
              [url, body] as const,
            );
          } catch {
            return null;
          } finally {
            await tab.close().catch(() => {});
          }
        };
        const got = await prefetchStations(
          missing.map((o) => ({ lat: o.latitude!, lng: o.longitude! })),
          viaBrowser,
        );
        let filled = 0;
        // never fall back to one request per listing: if the area query failed, skip (OpenStreetMap is a shared free service)
        for (const o of got === 0 ? [] : missing) {
          if (this.stopped) break;
          if (await fillStationFromMap(o)) filled++;
        }
        this.log(got === 0 ? `OpenStreetMap is not responding right now – nearest station not added for ${missing.length} listings (try again later)` : `OpenStreetMap: nearest station added for ${filled}/${missing.length} listings without one (estimates)`, got === 0 ? "warn" : "info", pid);
        this.refresh();
      }
      st.state = detailFailures > total / 2 ? "PARTIAL" : "DONE";
      this.log(`${impl.label} done: ${st.found} found, ${st.detailed} detail-checked`, "success", pid);
    } catch (e) {
      if (e instanceof StopError || this.stopped) {
        st.state = "STOPPED";
        this.log(`${impl.label} stopped`, "warn", pid);
      } else {
        const msg = (e as Error).message?.split("\n")[0] ?? String(e);
        st.state = st.found > 0 ? "PARTIAL" : "FAILED";
        st.error = msg;
        this.log(`${impl.label} ${st.state}: ${msg}`, "error", pid);
      }
    } finally {
      this.refresh();
      if (page && !page.isClosed()) await page.close().catch(() => {});
    }
  }
}

const g = globalThis as unknown as { __stayJob?: Job | null };

export function currentJob() {
  return g.__stayJob ?? null;
}

export function startJob(criteria: Criteria): Job {
  const cur = g.__stayJob;
  if (cur && ["RUNNING", "PAUSED", "WAITING_FOR_USER", "STOPPING"].includes(cur.status)) throw new Error("A search is already running");
  const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  createSearch(id, criteria);
  const job = new Job(id, criteria);
  g.__stayJob = job;
  job.run().catch((e) => {
    job.log(`Unexpected error: ${(e as Error).message}`, "error");
    job.status = "FAILED";
  });
  return job;
}
