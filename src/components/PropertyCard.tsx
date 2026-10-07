"use client";
import { useState } from "react";
import type { Criteria, PropertyResult } from "@/lib/types";
import { PROVIDER_LABEL } from "@/lib/types";
import { confClass, countText, money, primaryOffer, PROVIDER_STYLE } from "@/lib/format";
import { bedSummary, westernBedCount } from "@/lib/engine/sleeping";
import { useT } from "@/lib/i18n";
import type { Fact } from "@/lib/types";

/** Number + confidence chip; an unknown value is shown once as a grey chip. */
function Count({ f, t }: { f: Fact<number>; t: (s: string) => string }) {
  if (f.value == null || f.confidence === "UNKNOWN") return <span className={`chip ${confClass("UNKNOWN")}`}>{t("UNKNOWN")}</span>;
  return (
    <>
      {countText(f)} <span className={`chip ${confClass(f.confidence)}`}>{t(f.confidence)}</span>
    </>
  );
}

const AV_STYLE = {
  AVAILABLE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  UNAVAILABLE: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300",
  UNKNOWN: "bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400",
};

export default function PropertyCard({
  r,
  c,
  onEvidence,
  compared,
  compareFull,
  onCompare,
  favorite,
  onFavorite,
}: {
  r: PropertyResult;
  c: Criteria;
  onEvidence: () => void;
  compared: boolean;
  compareFull?: boolean;
  onCompare: () => void;
  favorite: { note: string } | null;
  onFavorite: (note: string | null) => void;
}) {
  const t = useT();
  const o = primaryOffer(r);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(favorite?.note ?? "");
  const av = o.availability.value ?? "UNKNOWN";
  const wb = westernBedCount(o);
  const st = o.station.value;
  const shown = r.filters.filter((f) => f.level !== "IGNORE");
  const nights = o.price.nights;

  return (
    <article className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            {[...new Set(r.offers.map((x) => x.provider))].map((p) => (
              <span key={p} className={`chip ${PROVIDER_STYLE[p]}`}>
                {PROVIDER_LABEL[p]}
              </span>
            ))}
            <span className={`chip ${AV_STYLE[av]}`}>{t(av)}</span>
            {o.availability.value === "AVAILABLE" && o.availability.confidence !== "VERIFIED" && <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{t("search page only")}</span>}
            <span className={`chip ${r.trust.level === "HIGH" ? confClass("VERIFIED") : r.trust.level === "MEDIUM" ? confClass("LIKELY") : confClass("UNKNOWN")}`}>{t("Trust")} {t(r.trust.level)}</span>
            {r.stage === "cheap" && <span className="chip bg-stone-100 text-stone-500 dark:bg-stone-800">{t("card only")}</span>}
          </div>
          <h3 className="break-words text-base font-semibold sm:truncate">
            <a href={o.url} target="_blank" rel="noreferrer" className="hover:underline">
              {r.name}
            </a>
          </h3>
          <div className="truncate text-xs text-stone-500">
            {[o.propertyType ? t(o.propertyType) : null, o.roomName, r.address].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xl font-semibold tabular-nums">{o.price.totalPrice != null ? money(o.price.totalPrice, o.price.currency) : o.price.basePrice != null ? `${money(o.price.basePrice, o.price.currency)}${t("+tax")}` : t("UNKNOWN")}</div>
          <div className="text-xs text-stone-500">
            {nights} {t("nights")}{o.price.pricePerNight != null ? ` · ${money(o.price.pricePerNight, o.price.currency)}${t("/night")}` : ""}
          </div>
          <div className="mt-0.5 flex justify-end gap-1">
            <span className={`chip ${o.price.completeness === "FULL" ? confClass("VERIFIED") : o.price.completeness === "PARTIAL" ? confClass("LIKELY") : confClass("UNKNOWN")}`}>{t(o.price.completeness)}</span>
            {o.price.estimatedConversion && <span className="chip bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" title={t("Converted with your exchange rate")}>{t("EST.")} {c.currency}</span>}
          </div>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-stone-500">{t("Guests / max")}</dt>
          <dd>
            {c.adults + c.children} / {o.maxGuests.value ?? "?"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{t("Bedrooms")}</dt>
          <dd>
            <Count f={o.bedrooms} t={t} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{t("Western beds")}</dt>
          <dd>{wb ?? <span className={`chip ${confClass("UNKNOWN")}`}>{t("UNKNOWN")}</span>}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{t("Bathrooms")}</dt>
          <dd>
            <Count f={o.bathrooms} t={t} />
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-stone-500">{t("Bed configuration")}</dt>
          <dd className="text-xs">{o.rooms.length ? o.rooms.map((x) => `${x.name}: ${bedSummary(x.beds)}`).join(" · ") : bedSummary(o.beds.value)}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{t("Bathtubs")}</dt>
          <dd>
            <Count f={o.bathtubs} t={t} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{t("Nearest station")}</dt>
          <dd className="text-xs">{st ? `${st.name} · ${st.walkMinutes != null ? `${st.walkMinutes} ${t("min walk")}${st.estimated ? ` ${t("(est.)")}` : ""}` : t("walk time unknown")}${st.distanceM != null ? ` · ${st.distanceM} m` : ""}` : t("UNKNOWN")}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{t("Rating")}</dt>
          <dd>{o.rating.value ? `${o.rating.value.raw}/${o.rating.value.scale}` : t("UNKNOWN")}</dd>
        </div>
        <div>
          <dt className="text-xs text-stone-500">{t("Reviews")}</dt>
          <dd>{o.reviewCount.value ?? t("UNKNOWN")}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-xs text-stone-500">{t("Cancellation")}</dt>
          <dd className="text-xs">{o.cancellation.freeCancellation ? (o.cancellation.deadline ? `${t("Free cancellation until")} ${o.cancellation.deadline}` : t("Free cancellation")) : o.cancellation.freeCancellation === false ? t("Non-refundable") : t("UNKNOWN")}{o.cancellation.payLater ? ` · ${t("pay later")}` : ""}</dd>
        </div>
      </dl>

      {r.offers.length > 1 && (
        <div className="mt-3 rounded border border-stone-200 p-2 text-xs dark:border-stone-800">
          <div className="mb-1 font-semibold">{t("Offers")}</div>
          {r.offers.map((x) => (
            <div key={`${x.provider}${x.providerPropertyId}`} className="flex justify-between gap-2">
              <span>
                <span className={`chip ${PROVIDER_STYLE[x.provider]}`}>{PROVIDER_LABEL[x.provider]}</span> {x.roomName}
              </span>
              <span className="tabular-nums">
                {money(x.price.totalPrice, x.price.currency)} {x.price.completeness !== "FULL" ? `(${t(x.price.completeness)})` : ""} · {x.cancellation.freeCancellation ? t("free cancel") : x.cancellation.freeCancellation === false ? t("Non-refundable") : t("cancellation ?")}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 border-t border-stone-200 pt-3 dark:border-stone-800">
        <div className="mb-1 text-xs font-semibold">
          {r.status === "REJECTED" ? t("Rejected because") : `${t("Matched")} ${r.matchCount}/${r.matchTotal}`}
          {r.status !== "REJECTED" && <span className="ml-2 font-normal text-stone-500">{t("score")} {r.score}</span>}
        </div>
        {r.status === "REJECTED" && (
          <ul className="mb-2 space-y-0.5 text-xs text-rose-700 dark:text-rose-400">
            {r.rejectReasons.map((x, i) => (
              <li key={i}>✕ {x}</li>
            ))}
          </ul>
        )}
        <ul className="grid gap-x-4 gap-y-0.5 text-xs sm:grid-cols-2">
          {shown.map((f) => (
            <li key={f.id} className={f.status === "PASS" ? "text-emerald-700 dark:text-emerald-400" : f.status === "WARN" ? "text-amber-700 dark:text-amber-400" : f.status === "FAIL" ? "text-rose-700 dark:text-rose-400" : "text-stone-500 dark:text-stone-400"}>
              {f.status === "PASS" || f.status === "WARN" ? "✓" : f.status === "FAIL" ? "✕" : "?"} {f.text}
              {f.level === "PREFERRED" && <span className="text-stone-400"> ({t("preferred")})</span>}
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="btn h-8" onClick={onEvidence}>
          {t("View Evidence")}
        </button>
        <button className={`btn h-8 ${compared ? "border-accent-600 text-accent-700" : ""}`} aria-pressed={compared} disabled={!compared && compareFull} title={!compared && compareFull ? t("Up to 5 properties can be compared.") : undefined} onClick={onCompare}>
          {compared ? t("✓ Comparing") : t("Compare")}
        </button>
        <button className="btn h-8" aria-pressed={!!favorite} onClick={() => (favorite ? onFavorite(null) : setNoteOpen(true))}>
          {favorite ? t("★ Favorite") : t("☆ Favorite")}
        </button>
        {favorite && !noteOpen && (
          <button className="text-xs text-stone-500 underline" onClick={() => setNoteOpen(true)}>
            {favorite.note ? `“${favorite.note}”` : t("add note")}
          </button>
        )}
        <a className="ml-auto text-xs text-accent-600 underline" href={o.url} target="_blank" rel="noreferrer">
          {t("Open on")} {PROVIDER_LABEL[o.provider]}
        </a>
      </div>
      {noteOpen && (
        <form
          className="mt-2 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onFavorite(note);
            setNoteOpen(false);
          }}
        >
          <input className="input" autoFocus aria-label={t("Note (e.g. nice bathtub, best location)")} placeholder={t("Note (e.g. nice bathtub, best location)")} value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNoteOpen(false)} />
          <button className="btn-primary" type="submit">
            {t("Save")}
          </button>
          <button className="btn" type="button" onClick={() => setNoteOpen(false)}>
            {t("Cancel")}
          </button>
        </form>
      )}
    </article>
  );
}
