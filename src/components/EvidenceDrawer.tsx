"use client";
import { useEffect, useRef } from "react";
import type { Evidence, Fact, Offer, PropertyResult } from "@/lib/types";
import { PROVIDER_LABEL } from "@/lib/types";
import { confClass, countText, dateTime, money, PROVIDER_STYLE } from "@/lib/format";
import { bedSummary } from "@/lib/engine/sleeping";
import { useLang, useT } from "@/lib/i18n";
import { explainLine } from "@/lib/explain-i18n";

function EvList({ items }: { items: Evidence[] }) {
  const t = useT();
  const lang = useLang();
  if (!items.length) return <div className="text-xs text-stone-400">{t("No evidence captured → value stays UNKNOWN.")}</div>;
  return (
    <ul className="space-y-1.5">
      {items.map((e, i) => (
        <li key={i} className="rounded border border-stone-200 p-2 text-xs dark:border-stone-800">
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
            <span className={`chip ${PROVIDER_STYLE[e.provider]}`}>{PROVIDER_LABEL[e.provider]}</span>
            <span>{e.source.replace(/_/g, " ")}</span>
            <span>· {dateTime(e.checkedAt, lang)}</span>
            <span className={`chip ${e.confidence === "high" ? confClass("VERIFIED") : e.confidence === "medium" ? confClass("LIKELY") : confClass("UNKNOWN")}`}>{t(e.confidence)}</span>
            {e.parsed && <span className="font-medium text-stone-700 dark:text-stone-300">→ {e.parsed}</span>}
          </div>
          <div className="whitespace-pre-wrap break-words text-stone-700 dark:text-stone-300">“{e.rawText}”</div>
        </li>
      ))}
    </ul>
  );
}

function Block({ title, value, fact, evidence }: { title: string; value: string; fact?: Fact<unknown>; evidence: Evidence[] }) {
  const t = useT();
  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <h4 className="text-sm font-semibold">{t(title)}</h4>
        <span className="text-sm">{value === "UNKNOWN" ? t("UNKNOWN") : value}</span>
        {fact && <span className={`chip ${confClass(fact.confidence)}`}>{t(fact.confidence)}</span>}
        {fact?.note && <span className="text-[11px] text-stone-500">{fact.note}</span>}
      </div>
      <EvList items={evidence} />
    </div>
  );
}

function OfferEvidence({ o }: { o: Offer }) {
  const t = useT();
  const lang = useLang();
  const p = o.price;
  return (
    <div className="space-y-4">
      <div className="text-xs text-stone-500">
        <a href={o.url} target="_blank" rel="noreferrer" className="text-accent-600 underline">
          {o.url.split("?")[0]}
        </a>
        {o.detailCheckedAt ? ` · ${t("detail page checked")} ${dateTime(o.detailCheckedAt, lang)}${o.fromCache ? ` ${t("(cache)")}` : ""}` : ` · ${t("search card only (detail page not opened)")}`}
      </div>
      <Block
        title="Availability"
        value={t(o.availability.value ?? "UNKNOWN")}
        fact={o.availability}
        evidence={o.availability.evidence}
      />
      {o.availabilityEvidence && (
        <div className="-mt-2 text-[11px] text-stone-500">
          {t("Bound to")} {o.availabilityEvidence.checkIn} → {o.availabilityEvidence.checkOut}, {o.availabilityEvidence.adults} {t("adults")}, {o.availabilityEvidence.children} {t("children")}, {o.availabilityEvidence.rooms} {t("room(s)")}
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center gap-2">
          <h4 className="text-sm font-semibold">{t("Price")}</h4>
          <span className={`chip ${confClass(p.confidence)}`}>{t(p.confidence)}</span>
          <span className={`chip ${p.completeness === "FULL" ? confClass("VERIFIED") : p.completeness === "PARTIAL" ? confClass("LIKELY") : confClass("UNKNOWN")}`}>{t(p.completeness)}</span>
          {p.estimatedConversion && <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{t("Estimated conversion")}</span>}
        </div>
        <table className="mb-2 text-xs">
          <tbody>
            {(
              [
                ["Base price", p.basePrice],
                ["Tax", p.tax],
                ["Cleaning fee", p.cleaningFee],
                ["Service fee", p.serviceFee],
                ["Other fee", p.otherFee],
                ["Total", p.totalPrice],
              ] as const
            ).map(([k, v]) => (
              <tr key={k}>
                <td className="pr-4 text-stone-500">{t(k)}</td>
                <td className={k === "Total" ? "font-semibold" : ""}>{v == null ? "—" : money(v, p.currency)}</td>
              </tr>
            ))}
            {p.originalCurrency && (
              <tr>
                <td className="pr-4 text-stone-500">{t("Original")}</td>
                <td>
                  {p.originalCurrency} {p.originalTotal?.toLocaleString()}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <EvList items={p.evidence} />
      </div>
      <Block title="Bedrooms" value={countText(o.bedrooms)} fact={o.bedrooms} evidence={o.bedrooms.evidence} />
      <Block
        title="Beds"
        value={o.rooms.length ? o.rooms.map((r) => `${r.name}: ${bedSummary(r.beds)}`).join(" | ") : bedSummary(o.beds.value)}
        fact={o.beds}
        evidence={o.beds.evidence}
      />
      <Block title="Bathrooms" value={countText(o.bathrooms)} fact={o.bathrooms} evidence={o.bathrooms.evidence} />
      <Block title="Toilets" value={countText(o.toilets)} fact={o.toilets} evidence={o.toilets.evidence} />
      <Block title="Bathtubs" value={countText(o.bathtubs)} fact={o.bathtubs} evidence={o.bathtubs.evidence} />
      <Block
        title="Station"
        value={o.station.value ? `${o.station.value.name} ${o.station.value.walkMinutes != null ? `${o.station.value.walkMinutes} ${t("min")}${o.station.value.estimated ? ` ${t("(est.)")}` : ""}` : t("walk time unknown")} ${o.station.value.distanceM != null ? `${o.station.value.distanceM} m` : ""}` : "UNKNOWN"}
        fact={o.station}
        evidence={o.station.evidence}
      />
      <Block
        title="Reviews"
        value={`${o.rating.value ? `${o.rating.value.raw}/${o.rating.value.scale}` : `${t("Rating")} ${t("UNKNOWN")}`} · ${o.reviewCount.value ?? t("UNKNOWN")} ${t("reviews")}`}
        fact={o.rating}
        evidence={[...o.rating.evidence, ...o.reviewCount.evidence]}
      />
      {Object.entries(o.amenities).length > 0 && (
        <div>
          <h4 className="mb-1 text-sm font-semibold">{t("Amenities found")}</h4>
          <div className="flex flex-wrap gap-1">
            {Object.entries(o.amenities).map(([k, f]) => (
              <span key={k} title={f!.evidence.map((e) => e.rawText).join("\n")} className={`chip ${f!.value ? confClass(f!.confidence) : "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300"}`}>
                {f!.value ? "" : "✕ "}
                {t(k.replace(/_/g, " "))}
                {f!.note ? ` (${f!.note})` : ""}
              </span>
            ))}
          </div>
        </div>
      )}
      {o.errors.length > 0 && (
        <div className="text-xs text-amber-700 dark:text-amber-400">
          <h4 className="font-semibold">{t("Errors / notes")}</h4>
          {o.errors.map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EvidenceDrawer({ r, onClose }: { r: PropertyResult; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const closeRef = useRef<HTMLButtonElement>(null);
  // the parent re-renders on every job poll; keep the latest callback without re-running the effect
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, []);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={r.name} className="h-full w-full max-w-2xl overflow-y-auto bg-white p-5 shadow-xl dark:bg-stone-900" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">{r.name}</h3>
            <div className="text-xs text-stone-500">{r.address ?? t("address UNKNOWN")}</div>
          </div>
          <button ref={closeRef} className="btn" onClick={onClose} title={t("Close (Esc)")}>
            {t("Close")}
          </button>
        </div>
        <div className="mb-4">
          <h4 className="mb-1 text-sm font-semibold">{t("Sleeping requirement")}</h4>
          <ul className="text-xs text-stone-600 dark:text-stone-300">
            {r.sleeping.explanation.map((x, i) => (
              <li key={i}>{explainLine(x, lang)}</li>
            ))}
          </ul>
          <h4 className="mb-1 mt-3 text-sm font-semibold">{t("Trust (listing reliability, not area safety)")}: {t(r.trust.level)}</h4>
          <ul className="text-xs text-stone-600 dark:text-stone-300">
            {r.trust.reasons.map((x, i) => (
              <li key={i}>· {explainLine(x, lang)}</li>
            ))}
          </ul>
          <h4 className="mb-1 mt-3 text-sm font-semibold">{t("Score breakdown")} ({r.score})</h4>
          <div className="flex flex-wrap gap-2 text-xs text-stone-600 dark:text-stone-300">
            {Object.entries(r.scoreBreakdown).map(([k, v]) => (
              <span key={k}>
                {t(k)}: {v}
              </span>
            ))}
          </div>
        </div>
        {r.offers.map((o) => (
          <details key={`${o.provider}:${o.providerPropertyId}`} open={o === r.offers[r.primary]} className="mb-3 rounded border border-stone-200 p-3 dark:border-stone-800">
            <summary className="cursor-pointer text-sm font-semibold">
              <span className={`chip mr-2 ${PROVIDER_STYLE[o.provider]}`}>{PROVIDER_LABEL[o.provider]}</span>
              {o.name} {o.roomName ? `– ${o.roomName}` : ""}
            </summary>
            <div className="mt-3">
              <OfferEvidence o={o} />
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
