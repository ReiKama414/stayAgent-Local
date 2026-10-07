"use client";
import { useEffect, useRef, useState } from "react";
import { PROVIDER_LABEL, type JobSnapshot, type JobStats, type ProviderId } from "@/lib/types";
import { PROVIDER_STYLE, time } from "@/lib/format";
import { useLang, useT } from "@/lib/i18n";
import { translateStage } from "@/lib/i18n-dict";

const STATE_TEXT: Record<string, string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  WAITING: "Waiting",
  DONE: "✓",
  PARTIAL: "Partial",
  FAILED: "Failed",
  SKIPPED: "—",
  STOPPED: "Stopped",
};

const JOB_STATUS: Record<string, string> = {
  QUEUED: "Pending",
  RUNNING: "Running",
  PAUSED: "Paused",
  WAITING_FOR_USER: "Waiting",
  STOPPING: "Stopping…",
  STOPPED: "Stopped",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export function Dashboard({ stats, job }: { stats: JobStats; job: JobSnapshot | null }) {
  const t = useT();
  const items: [string, number, string?][] = [
    ["searched", stats.searched],
    ["available", stats.available],
    ["detail verified", stats.detailVerified],
    ["matched", stats.matched, "text-emerald-700 dark:text-emerald-400"],
    ["need review", stats.review, "text-amber-700 dark:text-amber-400"],
    ["rejected", stats.rejected, "text-rose-700 dark:text-rose-400"],
  ];
  const by = stats.rejectedBy;
  const rejectBits = [
    by.budget ? `${t("budget")} ${by.budget}` : null,
    by.availability ? `${t("availability")} ${by.availability}` : null,
    by.bedrooms ? `${t("bedrooms")} ${by.bedrooms}` : null,
    by.bathrooms ? `${t("bathrooms")} ${by.bathrooms}` : null,
    by.bathtubs ? `${t("bathtub")} ${by.bathtubs}` : null,
    by.sleeping ? `${t("beds/couples")} ${by.sleeping}` : null,
    by.station ? `${t("station")} ${by.station}` : null,
    by.rating ? `${t("rating")} ${by.rating}` : null,
  ].filter(Boolean);
  return (
    <div className="card p-4">
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {items.map(([label, n, cls]) => (
          <div key={label}>
            <div className={`text-2xl font-semibold tabular-nums ${cls ?? ""}`}>{n}</div>
            <div className="text-xs text-stone-500">{t(label)}</div>
          </div>
        ))}
      </div>
      {rejectBits.length > 0 && (
        <div className="mt-2 text-xs text-stone-500">
          {t("Rejected by")}: {rejectBits.join(" · ")}
        </div>
      )}
      {job && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-200 pt-3 dark:border-stone-800">
          {(Object.keys(job.providers) as ProviderId[]).map((p) => {
            const s = job.providers[p];
            if (s.state === "SKIPPED") return null;
            const color =
              s.state === "DONE"
                ? "text-emerald-700 dark:text-emerald-400"
                : s.state === "FAILED"
                  ? "text-rose-600"
                  : s.state === "WAITING"
                    ? "text-amber-600"
                    : s.state === "PARTIAL"
                      ? "text-amber-700"
                      : "text-stone-500";
            return (
              <div key={p} className="flex items-center gap-2 rounded border border-stone-200 px-2 py-1 text-xs dark:border-stone-800" title={s.error ?? ""}>
                <span className={`chip ${PROVIDER_STYLE[p]}`}>{PROVIDER_LABEL[p]}</span>
                <span className={`font-semibold ${color}`}>{t(STATE_TEXT[s.state])}</span>
                <span className="text-stone-500">
                  {s.found} {t("found")} · {s.detailed} {t("detailed")}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function BrowserView({ job, onControl, browser }: { job: JobSnapshot | null; onControl: (a: string) => void; browser: { open: boolean; channel: string | null } }) {
  const t = useT();
  const lang = useLang();
  if (!job) return null;
  const active = ["RUNNING", "PAUSED", "WAITING_FOR_USER", "STOPPING"].includes(job.status);
  let domain = "";
  try {
    domain = job.currentUrl ? new URL(job.currentUrl).hostname : "";
  } catch {
    domain = "";
  }
  return (
    <div className="card overflow-hidden">
      {job.status === "WAITING_FOR_USER" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <div>
            <div className="font-semibold">{t("The browser needs you: complete the step in the Chromium window.")}</div>
            <div className="text-xs">{job.waitingReason}</div>
          </div>
          <div className="flex gap-2">
            <button className="btn" onClick={() => onControl("skip")} title={t("Keep this platform's search results, skip remaining detail pages")}>
              {t("Skip platform")}
            </button>
            <button className="btn-primary" onClick={() => onControl("continue")}>
              {t("Continue")}
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-3 p-4 sm:flex-row">
        <div className="min-w-0 flex-1 space-y-1 text-sm">
          <div className="flex items-center gap-2">
            {job.currentProvider && <span className={`chip ${PROVIDER_STYLE[job.currentProvider]}`}>{PROVIDER_LABEL[job.currentProvider].toUpperCase()}</span>}
            <span className="text-xs font-semibold uppercase tracking-wide text-stone-500">{t(JOB_STATUS[job.status] ?? job.status)}</span>
          </div>
          {active && <div className="font-medium">{translateStage(lang, job.stage)}</div>}
          {job.progress && (
            <div>
              <div className="text-xs text-stone-500">
                {t("Property")} {job.progress.current} / {job.progress.total}
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-stone-200 dark:bg-stone-800">
                <div className="h-full bg-accent-500 transition-all" style={{ width: `${(job.progress.current / Math.max(1, job.progress.total)) * 100}%` }} />
              </div>
            </div>
          )}
          {domain && <div className="truncate text-xs text-stone-500">{domain}</div>}
          <div className="text-xs text-stone-400">
            {t("Browser")}: {browser.open ? `${t("open")} (${browser.channel})` : t("closed")} · profile ./browser-profile
          </div>
          {active && (
          <div className="flex flex-wrap gap-2 pt-2">
            {job.status === "PAUSED" ? (
              <button className="btn" onClick={() => onControl("resume")}>
                {t("Resume")}
              </button>
            ) : (
              <button className="btn" disabled={job.status !== "RUNNING"} onClick={() => onControl("pause")}>
                {t("Pause")}
              </button>
            )}
            <button className="btn text-rose-700 dark:text-rose-400" disabled={!active || job.status === "STOPPING"} onClick={() => onControl("stop")}>
              {t("Stop")}
            </button>
          </div>
          )}
        </div>
        {job.screenshot && active && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={job.screenshot} alt={t("Latest browser screenshot")} className="h-36 w-full rounded border border-stone-200 object-cover object-top sm:w-64 dark:border-stone-800" />
        )}
      </div>
    </div>
  );
}

export function ActivityLog({ logs, running }: { logs: JobSnapshot["logs"]; running: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(running);
  // expand while a search runs, fold away once it is finished
  useEffect(() => setOpen(running), [running]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs.length, open]);
  return (
    <div className="card">
      <button className="flex w-full items-center justify-between px-4 py-2 text-sm font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t("Activity log")} <span className="text-xs font-normal text-stone-500">{logs.length} {t("entries")} {open ? "−" : "+"}</span>
      </button>
      {open && (
        <div ref={ref} className="max-h-56 overflow-y-auto border-t border-stone-200 px-4 py-2 font-mono text-[12px] leading-5 dark:border-stone-800">
          {logs.map((l, i) => (
            <div key={i} className={l.level === "error" ? "text-rose-600" : l.level === "warn" ? "text-amber-700 dark:text-amber-400" : l.level === "success" ? "text-emerald-700 dark:text-emerald-400" : ""}>
              <span className="text-stone-400">{time(l.ts)}</span> {l.provider ? <span className="text-stone-500">[{PROVIDER_LABEL[l.provider]}]</span> : null} {l.msg}
            </div>
          ))}
          {!logs.length && <div className="text-stone-400">{t("No activity yet.")}</div>}
        </div>
      )}
    </div>
  );
}
