"use client";
import { useId } from "react";
import { PROVIDERS, PROVIDER_LABEL, type Criteria } from "@/lib/types";
import { Check } from "./ui";
import { useT } from "@/lib/i18n";
import DestinationPicker, { QuickPicks } from "./DestinationPicker";

type Upd = (fn: (c: Criteria) => void) => void;

/** Problems that would make the search pointless; shown inline and block the Search button. */
export function searchProblems(c: Criteria): string[] {
  const out: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  if (!c.destination.trim()) out.push("Enter a destination.");
  if (!c.checkIn || !c.checkOut) out.push("Pick check-in and check-out dates.");
  else {
    if (c.checkOut <= c.checkIn) out.push("Check-out must be after check-in.");
    if (c.checkIn < today) out.push("Check-in date is in the past.");
  }
  if (!c.providers.length) out.push("Select at least one site.");
  if (c.rooms > c.adults) out.push("More rooms than adults.");
  return out;
}

export default function SearchBar({ c, upd, onSearch, busy, error }: { c: Criteria; upd: Upd; onSearch: () => void; busy: boolean; error: string | null }) {
  const t = useT();
  const id = useId();
  const nights = Math.max(0, Math.round((Date.parse(c.checkOut) - Date.parse(c.checkIn)) / 86400000));
  const problems = searchProblems(c);
  const airbnbSkipped = c.rooms > 1 && c.providers.includes("airbnb");
  return (
    <form
      className="card p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!problems.length) onSearch();
      }}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-[2fr_1fr_1fr_0.7fr_0.7fr_0.7fr_0.8fr_auto]">
        <div className="col-span-2 md:col-span-1">
          <label className="label" htmlFor={`${id}-dest`}>
            {t("Destination / City")}
          </label>
          <DestinationPicker id={`${id}-dest`} value={c.destination} onChange={(v) => upd((d) => void (d.destination = v))} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-in`}>
            {t("Check-in")}
          </label>
          <input id={`${id}-in`} type="date" className="input" value={c.checkIn} onChange={(e) => upd((d) => void (d.checkIn = e.target.value))} required />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-out`}>
            {t("Check-out")} {nights ? `· ${nights} ${t("nights")}` : ""}
          </label>
          <input id={`${id}-out`} type="date" className="input" min={c.checkIn || undefined} value={c.checkOut} onChange={(e) => upd((d) => void (d.checkOut = e.target.value))} required aria-invalid={!!c.checkIn && !!c.checkOut && c.checkOut <= c.checkIn} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-ad`}>
            {t("Adults")}
          </label>
          <input id={`${id}-ad`} type="number" min={1} className="input" value={c.adults} onChange={(e) => upd((d) => void (d.adults = Math.max(1, Number(e.target.value) || 1)))} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-ch`}>
            {t("Children")}
          </label>
          <input
            id={`${id}-ch`}
            type="number"
            min={0}
            className="input"
            value={c.children}
            onChange={(e) =>
              upd((d) => {
                d.children = Math.max(0, Number(e.target.value) || 0);
                d.childrenAges = Array.from({ length: d.children }, (_, i) => d.childrenAges[i] ?? 8);
              })
            }
          />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-rm`}>
            {t("Rooms")}
          </label>
          <input id={`${id}-rm`} type="number" min={1} className="input" value={c.rooms} onChange={(e) => upd((d) => void (d.rooms = Math.max(1, Number(e.target.value) || 1)))} />
        </div>
        <div>
          <label className="label" htmlFor={`${id}-cur`}>
            {t("Currency")}
          </label>
          <select id={`${id}-cur`} className="input" value={c.currency} onChange={(e) => upd((d) => void (d.currency = e.target.value))}>
            <option>TWD</option>
            <option>JPY</option>
            <option>USD</option>
          </select>
        </div>
        <div className="col-span-2 flex items-end md:col-span-1">
          <button type="submit" className="btn-primary w-full px-6" disabled={busy || problems.length > 0} title={problems.map(t).join("\n")}>
            {busy ? t("Searching…") : t("Search")}
          </button>
        </div>
      </div>

      <QuickPicks value={c.destination} onChange={(v) => upd((d) => void (d.destination = v))} />

      {c.children > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label={t("Children ages")}>
          <span className="label mb-0">{t("Children ages")}</span>
          {c.childrenAges.map((a, i) => (
            <input
              key={i}
              type="number"
              min={0}
              max={17}
              className="input w-16"
              aria-label={`${t("Children ages")} ${i + 1}`}
              value={a}
              onChange={(e) =>
                upd((d) => {
                  d.childrenAges[i] = Math.min(17, Math.max(0, Number(e.target.value) || 0));
                })
              }
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-stone-200 pt-3 text-sm dark:border-stone-800">
        <div className="flex flex-wrap items-center gap-3">
          {PROVIDERS.map((p) => (
            <Check
              key={p}
              checked={c.providers.includes(p)}
              onChange={(v) => upd((d) => void (d.providers = v ? [...new Set([...d.providers, p])].sort((a, b) => PROVIDERS.indexOf(a) - PROVIDERS.indexOf(b)) : d.providers.filter((x) => x !== p)))}
              label={PROVIDER_LABEL[p]}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <label className="label mb-0" htmlFor={`${id}-br`}>
            {t("Browser")}
          </label>
          <select id={`${id}-br`} className="input h-8 w-auto" value={c.settings.headless ? "headless" : "visible"} onChange={(e) => upd((d) => void (d.settings.headless = e.target.value === "headless"))}>
            <option value="visible">{t("Visible Browser")}</option>
            <option value="headless">{t("Headless")}</option>
          </select>
        </div>
        <Check checked={c.settings.forceRefresh} onChange={(v) => upd((d) => void (d.settings.forceRefresh = v))} label={t("Force refresh (ignore 30-min cache)")} />
        <div className="flex items-center gap-2">
          <label className="label mb-0" htmlFor={`${id}-fx`}>
            JPY→TWD
          </label>
          <input id={`${id}-fx`} type="number" step={0.001} min={0} className="input h-8 w-20" value={c.settings.exchangeRates.JPY ?? ""} onChange={(e) => upd((d) => void (d.settings.exchangeRates.JPY = Number(e.target.value)))} />
        </div>
      </div>
      {airbnbSkipped && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{t("Airbnb is skipped when booking more than 1 room (it rents whole listings, not several rooms).")}</p>}
      <p className="mt-2 text-[11px] text-stone-500">{t("Uses every result page and opens every detail page that passes the basic filters. Big searches take a while.")}</p>
      {problems.length > 0 && (
        <ul className="mt-2 text-sm text-rose-600 dark:text-rose-400" role="alert">
          {problems.map((p) => (
            <li key={p}>• {t(p)}</li>
          ))}
        </ul>
      )}
      {error && (
        <p className="mt-2 text-sm text-rose-600 dark:text-rose-400" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
