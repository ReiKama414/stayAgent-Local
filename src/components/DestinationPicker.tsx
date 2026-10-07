"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DESTINATIONS, QUICK_PICKS, REGION_LABEL, findDestination, type Destination, type Region } from "@/lib/destinations";
import { useLang, useT } from "@/lib/i18n";

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");

export default function DestinationPicker({ id, value, onChange }: { id?: string; value: string; onChange: (v: string) => void }) {
  const lang = useLang();
  const t = useT();
  const li = lang === "en" ? 0 : lang === "zh" ? 1 : 2;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const groups = useMemo(() => {
    const n = norm(q);
    const hit = (d: Destination) => !n || [d.query, d.zh, d.ja, ...(d.aliases ?? [])].some((x) => norm(x).includes(n));
    const out = new Map<Region, Destination[]>();
    for (const d of DESTINATIONS) if (hit(d)) out.set(d.region, [...(out.get(d.region) ?? []), d]);
    return [...out.entries()];
  }, [q]);

  const current = findDestination(value);
  const pick = (d: Destination) => {
    onChange(d[lang]);
    setQ("");
    setOpen(false);
  };
  const sub = (d: Destination) => (lang === "en" ? `${d.ja}` : d.query);

  return (
    <div ref={box} className="relative">
      <div className="flex gap-1">
        <input
          ref={input}
          id={id}
          className="input"
          autoComplete="off"
          aria-expanded={open}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              requestAnimationFrame(() => list.current?.querySelector("button")?.focus());
            }
            if (e.key === "Enter" && open && groups[0]?.[1][0] && q) {
              e.preventDefault();
              pick(groups[0][1][0]);
            }
          }}
          placeholder={t("Destination / City")}
          required
        />
        <button type="button" className="btn w-9 shrink-0 px-0" onClick={() => setOpen(!open)} aria-label={t("Show destinations")} aria-expanded={open}>
          ▾
        </button>
      </div>
      {current && <div className="mt-0.5 text-[11px] text-stone-500" title={t("Text typed into the booking sites")}>→ {current.query}{current.country ? `, ${current.country}` : ""}</div>}
      {open && (
        <div
          ref={list}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              input.current?.focus();
            }
          }}
          className="absolute left-0 z-30 mt-1 max-h-80 w-[min(560px,90vw)] overflow-y-auto rounded-md border border-stone-200 bg-white p-2 shadow-lg dark:border-stone-700 dark:bg-stone-900">
          {!groups.length && <div className="p-2 text-xs text-stone-500">{t("Not in the list – the text is searched as typed.")}</div>}
          {groups.map(([region, list]) => (
            <div key={region} className="mb-2">
              <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{REGION_LABEL[region][li]}</div>
              <div className="flex flex-wrap gap-1">
                {list.map((d) => (
                  <button
                    key={d.query}
                    type="button"
                    onClick={() => pick(d)}
                    className={`rounded border px-2 py-0.5 text-xs hover:bg-stone-100 dark:hover:bg-stone-800 ${current?.query === d.query ? "border-accent-600 text-accent-700" : "border-stone-200 dark:border-stone-700"}`}
                    title={`${d.query} · ${d.zh} · ${d.ja}`}
                  >
                    {d[lang]} <span className="text-stone-400">{sub(d)}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuickPicks({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const lang = useLang();
  const t = useT();
  const current = findDestination(value)?.query;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="label mb-0 mr-1">{t("Quick pick")}</span>
      {QUICK_PICKS.map((qp) => DESTINATIONS.find((d) => d.query === qp)!).map((d) => (
        <button
          key={d.query}
          type="button"
          aria-pressed={current === d.query}
          onClick={() => onChange(d[lang])}
          className={`rounded-full border px-2.5 py-0.5 text-xs ${current === d.query ? "border-accent-600 bg-accent-50 text-accent-700 dark:bg-accent-700/30 dark:text-accent-100" : "border-stone-300 hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"}`}
        >
          {d[lang]}
        </button>
      ))}
    </div>
  );
}
