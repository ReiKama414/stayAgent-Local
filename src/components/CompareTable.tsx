"use client";
import { useEffect, useRef } from "react";
import type { PropertyResult } from "@/lib/types";
import { AMENITY_LABEL, PROVIDER_LABEL, type AmenityKey } from "@/lib/types";
import { countText, money, primaryOffer } from "@/lib/format";
import { westernBedCount } from "@/lib/engine/sleeping";
import { useT } from "@/lib/i18n";

type Row = [label: string, value: (r: PropertyResult) => string, best?: (r: PropertyResult) => number | null, dir?: "min" | "max"];

export default function CompareTable({ items, onClose, onRemove }: { items: PropertyResult[]; onClose: () => void; onRemove: (id: string) => void }) {
  const t = useT();
  const U = t("UNKNOWN");
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const p = primaryOffer;
  const rows: Row[] = [
    ["Platform", (r) => [...new Set(r.offers.map((o) => PROVIDER_LABEL[o.provider]))].join(", ")],
    ["Status", (r) => t(r.status === "MATCHED" ? "Matched" : r.status === "REVIEW" ? "need review" : "Rejected")],
    ["Availability", (r) => t(p(r).availability.value ?? "UNKNOWN")],
    ["Total price", (r) => (p(r).price.totalPrice != null ? `${money(p(r).price.totalPrice, p(r).price.currency)} (${t(p(r).price.completeness)})` : U), (r) => p(r).price.totalPrice, "min"],
    ["Price/night", (r) => (p(r).price.pricePerNight != null ? money(p(r).price.pricePerNight, p(r).price.currency) : U), (r) => p(r).price.pricePerNight, "min"],
    ["Bedrooms", (r) => (countText(p(r).bedrooms) === "UNKNOWN" ? U : countText(p(r).bedrooms)), (r) => p(r).bedrooms.value, "max"],
    ["Western beds", (r) => String(westernBedCount(p(r)) ?? U), (r) => westernBedCount(p(r)), "max"],
    ["Bathrooms", (r) => (countText(p(r).bathrooms) === "UNKNOWN" ? U : countText(p(r).bathrooms)), (r) => p(r).bathrooms.value, "max"],
    ["Bathtubs", (r) => (countText(p(r).bathtubs) === "UNKNOWN" ? U : `${countText(p(r).bathtubs)} (${t(p(r).bathtubs.confidence)})`), (r) => p(r).bathtubs.value, "max"],
    [
      "Station",
      (r) => {
        const s = p(r).station.value;
        return s ? `${s.name} ${s.walkMinutes != null ? `${s.walkMinutes} ${t("min")}${s.estimated ? ` ${t("(est.)")}` : ""}` : ""} ${s.distanceM != null ? s.distanceM + " m" : ""}` : U;
      },
      (r) => p(r).station.value?.walkMinutes ?? null,
      "min",
    ],
    ["Rating", (r) => (p(r).rating.value ? `${p(r).rating.value!.raw}/${p(r).rating.value!.scale}` : U), (r) => p(r).rating.value?.normalized ?? null, "max"],
    ["Reviews", (r) => String(p(r).reviewCount.value ?? U), (r) => p(r).reviewCount.value, "max"],
    [
      "Cancellation",
      (r) => {
        const c = p(r).cancellation;
        return c.freeCancellation ? (c.deadline ? `${t("Free cancellation until")} ${c.deadline}` : t("Free cancellation")) : c.freeCancellation === false ? t("Non-refundable") : U;
      },
    ],
    [
      "Amenities",
      (r) =>
        Object.entries(p(r).amenities)
          .filter(([, f]) => f?.value)
          .map(([k]) => t(AMENITY_LABEL[k as AmenityKey]))
          .join(", ") || "—",
    ],
    ["Trust", (r) => t(r.trust.level)],
    ["Score", (r) => String(r.score), (r) => r.score, "max"],
  ];
  const bestOf = (row: Row) => {
    const [, , get, dir] = row;
    if (!get || items.length < 2) return null;
    const vals = items.map(get).filter((v): v is number => v != null);
    if (vals.length < 2) return null;
    return dir === "min" ? Math.min(...vals) : Math.max(...vals);
  };
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={t("Compare")} className="max-h-[90vh] w-full max-w-6xl overflow-auto rounded-t-lg bg-white p-4 sm:rounded-lg dark:bg-stone-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">
            {t("Compare")} ({items.length})
          </h3>
          <button className="btn" autoFocus onClick={onClose} title={t("Close (Esc)")}>
            {t("Close")}
          </button>
        </div>
        <table className="w-full text-left text-xs">
          <thead>
            <tr>
              <th className="sticky left-0 w-28 bg-white p-2 dark:bg-stone-900"></th>
              {items.map((r) => (
                <th key={r.id} className="min-w-40 p-2 align-top font-semibold">
                  {r.name}
                  <button className="ml-1 text-stone-400 hover:text-rose-600" aria-label={`${t("Remove")} ${r.name}`} onClick={() => onRemove(r.id)}>
                    ✕
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const [label, f, get] = row;
              const best = bestOf(row);
              return (
                <tr key={label} className="border-t border-stone-200 dark:border-stone-800">
                  <td className="sticky left-0 bg-white p-2 text-stone-500 dark:bg-stone-900">{t(label)}</td>
                  {items.map((r) => (
                    <td key={r.id} className={`p-2 align-top ${best != null && get?.(r) === best ? "font-semibold text-emerald-700 dark:text-emerald-400" : ""}`}>
                      {f(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
