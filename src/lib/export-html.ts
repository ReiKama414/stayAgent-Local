import type { Criteria, Evidence, JobStats, Offer, PropertyResult } from "./types";
import { PROVIDER_LABEL } from "./types";
import { translate, type Lang } from "./i18n-dict";
import { explainLine } from "./explain-i18n";
import { bedName } from "./engine/messages";

/** Self-contained, offline HTML report of a result set (no search features, no external resources). */
const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

let U = "UNKNOWN"; // set per export to the translated word
const money = (n: number | null | undefined, cur = "TWD") => (n == null ? U : `${cur === "TWD" ? "NT$" : cur + " "}${Math.round(n).toLocaleString("en-US")}`);
const PCOLOR: Record<string, string> = { booking: "#003b95", agoda: "#c8102e", airbnb: "#d90b3e", trip: "#1b5fc9" };

function count(f: { value: number | null; qualifier?: string; confidence: string }) {
  return f.value == null || f.confidence === "UNKNOWN" ? U : `${f.qualifier === "atLeast" ? "≥" : ""}${f.value}`;
}

function evidenceList(items: Evidence[], t: (s: string) => string) {
  if (!items?.length) return `<p class="muted">${esc(t("No evidence captured → value stays UNKNOWN."))}</p>`;
  return `<ul class="ev">${items
    .slice(0, 8)
    .map((e) => `<li><span class="muted">${esc(PROVIDER_LABEL[e.provider])} · ${esc(e.source.replace(/_/g, " "))} · ${esc(e.checkedAt?.slice(0, 16).replace("T", " "))}${e.parsed ? ` → <b>${esc(e.parsed)}</b>` : ""}</span><br>“${esc(e.rawText)}”</li>`)
    .join("")}</ul>`;
}

function card(r: PropertyResult, c: Criteria, lang: Lang, fav: string | null) {
  const t = (s: string) => translate(lang, s);
  U = t("UNKNOWN");
  const o: Offer = r.offers[r.primary] ?? r.offers[0];
  const st = o.station?.value;
  const beds = o.rooms?.length
    ? o.rooms.map((x) => `${esc(x.name)}: ${x.beds.map((b) => `${b.count} ${esc(bedName(b.type, lang))}`).join(" + ")}`).join(" · ")
    : (o.beds?.value ?? []).map((b) => `${b.count} ${esc(bedName(b.type, lang))}`).join(" + ") || U;
  const platforms = [...new Set(r.offers.map((x) => x.provider))].map((p) => `<span class="chip" style="background:${PCOLOR[p]};color:#fff">${esc(PROVIDER_LABEL[p])}</span>`).join(" ");
  const filters = r.filters
    .filter((f) => f.level !== "IGNORE")
    .map((f) => {
      const cls = f.status === "PASS" ? "pass" : f.status === "WARN" ? "warn" : f.status === "FAIL" ? "fail" : "unk";
      const icon = f.status === "PASS" || f.status === "WARN" ? "✓" : f.status === "FAIL" ? "✕" : "?";
      return `<li class="${cls}">${icon} ${esc(f.text)}${f.level === "PREFERRED" ? ` <span class="muted">(${esc(t("preferred"))})</span>` : ""}</li>`;
    })
    .join("");
  const offers =
    r.offers.length > 1
      ? `<div class="offers"><b>${esc(t("Offers"))}</b>${r.offers
          .map((x) => `<div><a href="${esc(x.url)}" target="_blank" rel="noreferrer">${esc(PROVIDER_LABEL[x.provider])}</a> ${esc(x.roomName ?? "")} — ${money(x.price.totalPrice ?? x.price.basePrice, x.price.currency)} (${esc(t(x.price.completeness))})</div>`)
          .join("")}</div>`
      : "";
  const ev = (title: string, items: Evidence[]) => `<h4>${esc(t(title))}</h4>${evidenceList(items, t)}`;
  return `<article data-status="${r.status}"${fav != null ? ' data-fav="1"' : ""}>
  <div class="top"><div>${platforms} <span class="chip ${o.availability.value === "AVAILABLE" ? "ok" : o.availability.value === "UNAVAILABLE" ? "bad" : "unkc"}">${esc(t(o.availability.value ?? "UNKNOWN"))}</span> <span class="chip">${esc(t("Trust"))} ${esc(t(r.trust.level))}</span>
  <h3><a href="${esc(o.url)}" target="_blank" rel="noreferrer">${esc(r.name)}</a></h3>
  <div class="muted">${esc([o.propertyType, o.roomName, r.address].filter(Boolean).join(" · "))}</div>${fav ? `<div class="note">★ ${esc(fav)}</div>` : ""}</div>
  <div class="price"><div class="big">${o.price.totalPrice != null ? money(o.price.totalPrice, o.price.currency) : o.price.basePrice != null ? money(o.price.basePrice, o.price.currency) + esc(t("+tax")) : U}</div><div class="muted">${o.price.nights} ${esc(t("nights"))}${o.price.pricePerNight != null ? ` · ${money(o.price.pricePerNight, o.price.currency)}${esc(t("/night"))}` : ""}</div><span class="chip">${esc(t(o.price.completeness))}</span></div></div>
  <dl>
   <div><dt>${esc(t("Guests / max"))}</dt><dd>${c.adults + c.children} / ${o.maxGuests?.value ?? "?"}</dd></div>
   <div><dt>${esc(t("Bedrooms"))}</dt><dd>${count(o.bedrooms)}</dd></div>
   <div><dt>${esc(t("Bathrooms"))}</dt><dd>${count(o.bathrooms)}</dd></div>
   <div><dt>${esc(t("Bathtubs"))}</dt><dd>${count(o.bathtubs)} <span class="muted">${o.bathtubs.confidence === "UNKNOWN" ? "" : esc(t(o.bathtubs.confidence))}</span></dd></div>
   <div class="wide"><dt>${esc(t("Bed configuration"))}</dt><dd>${beds}</dd></div>
   <div><dt>${esc(t("Nearest station"))}</dt><dd>${st ? `${esc(st.name)} ${st.walkMinutes != null ? `${st.walkMinutes} ${esc(t("min walk"))}${st.estimated ? ` ${esc(t("(est.)"))}` : ""}` : st.distanceM != null ? `~${Math.ceil(st.distanceM / 80)} ${esc(t("min walk"))} (${st.distanceM} m)` : ""}` : U}</dd></div>
   <div><dt>${esc(t("Rating"))}</dt><dd>${o.rating.value ? `${o.rating.value.raw}/${o.rating.value.scale}` : U} · ${o.reviewCount.value ?? "?"}</dd></div>
   <div class="wide"><dt>${esc(t("Cancellation"))}</dt><dd>${o.cancellation.freeCancellation ? `✓ ${esc(o.cancellation.deadline ?? t("Free cancellation"))}` : o.cancellation.freeCancellation === false ? `✕ ${esc(t("Non-refundable"))}` : U}</dd></div>
  </dl>
  ${offers}
  <div class="match"><b>${r.status === "REJECTED" ? esc(t("Rejected because")) : `MATCH ${r.matchCount}/${r.matchTotal}`}</b>${r.status !== "REJECTED" ? ` <span class="muted">${esc(t("score"))} ${r.score}</span>` : ""}<ul class="filters">${filters}</ul></div>
  <details><summary>${esc(t("View Evidence"))}</summary>
   ${ev("Availability", o.availability.evidence)}${ev("Price", o.price.evidence)}${ev("Bedrooms", o.bedrooms.evidence)}${ev("Beds", o.beds.evidence)}${ev("Bathrooms", o.bathrooms.evidence)}${ev("Bathtubs", o.bathtubs.evidence)}${ev("Station", o.station.evidence)}${ev("Reviews", [...o.rating.evidence, ...o.reviewCount.evidence])}
   <h4>${esc(t("Sleeping requirement"))}</h4><ul>${r.sleeping.explanation.map((x) => `<li>${esc(explainLine(x, lang))}</li>`).join("")}</ul>
   <h4>${esc(t("Trust (listing reliability, not area safety)"))}: ${esc(t(r.trust.level))}</h4><ul>${r.trust.reasons.map((x) => `<li>${esc(explainLine(x, lang))}</li>`).join("")}</ul>
  </details>
</article>`;
}

export function exportHtml(results: PropertyResult[], c: Criteria, stats: JobStats, lang: Lang, favorites: Map<string, string>, sortedIds: string[]): string {
  const t = (s: string) => translate(lang, s);
  const order = new Map(sortedIds.map((id, i) => [id, i]));
  const sorted = [...results].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || b.score - a.score);
  const nights = Math.round((Date.parse(c.checkOut) - Date.parse(c.checkIn)) / 86400000);
  const tabs: [string, string, number][] = [
    ["MATCHED", t("Matched"), stats.matched],
    ["REVIEW", t("Needs review"), stats.review],
    ["REJECTED", t("Rejected"), stats.rejected],
    ["FAV", t("Favorites"), results.filter((r) => favorites.has(r.id)).length],
  ];
  const generated = new Date().toLocaleString(lang === "en" ? "en-GB" : lang === "zh" ? "zh-TW" : "ja-JP");
  return `<!doctype html>
<html lang="${lang === "zh" ? "zh-Hant" : lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stay Agent – ${esc(c.destination)} ${esc(c.checkIn)}</title>
<style>
:root{--bg:#fafaf9;--card:#fff;--fg:#1c1917;--muted:#78716c;--line:#e7e5e4;--pass:#047857;--warn:#b45309;--fail:#be123c;--unk:#78716c;--accent:#23675f}
@media (prefers-color-scheme:dark){:root{--bg:#0c0a09;--card:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#292524;--pass:#34d399;--warn:#fbbf24;--fail:#fb7185;--unk:#a8a29e;--accent:#5fb3a9}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 "Segoe UI","Noto Sans TC",system-ui,sans-serif}
.wrap{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:20px;margin:0}h3{margin:4px 0;font-size:16px}h4{margin:12px 0 4px;font-size:13px}
a{color:var(--accent)}.muted{color:var(--muted);font-size:12px}.summary,.stats,article{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin:12px 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px}.stats b{font-size:22px;display:block}
.tabs{display:flex;flex-wrap:wrap;gap:4px}.tabs button{border:1px solid var(--line);background:var(--card);color:var(--fg);padding:6px 12px;border-radius:6px;cursor:pointer;font:inherit}.tabs button.on{background:var(--fg);color:var(--bg)}
.chip{display:inline-block;border-radius:4px;padding:1px 6px;font-size:11px;font-weight:600;background:var(--line)}.chip.ok{background:#d1fae5;color:#065f46}.chip.bad{background:#ffe4e6;color:#9f1239}.chip.unkc{background:var(--line)}
.top{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.price{text-align:right}.big{font-size:20px;font-weight:600}
dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px 16px;margin:10px 0}dl .wide{grid-column:span 2}dt{color:var(--muted);font-size:12px}dd{margin:0}
@media (max-width:640px){dl{grid-template-columns:repeat(2,minmax(0,1fr))}.price{text-align:left}}
.filters{columns:2;padding-left:0;list-style:none;margin:4px 0;font-size:12.5px}@media (max-width:640px){.filters{columns:1}}
.pass{color:var(--pass)}.warn{color:var(--warn)}.fail{color:var(--fail)}.unk{color:var(--unk)}
.match{border-top:1px solid var(--line);padding-top:8px}.offers{border:1px solid var(--line);border-radius:6px;padding:6px 8px;font-size:12.5px}
details summary{cursor:pointer;color:var(--accent);margin-top:6px}.ev{padding-left:16px;font-size:12px}.ev li{margin:4px 0}.note{color:var(--warn);font-size:12px}
.legend span{margin-right:12px}
</style></head><body><div class="wrap">
<h1>Stay Agent – ${esc(c.name || c.destination)}</h1>
<div class="summary">${esc(c.destination)} · ${esc(c.checkIn)} → ${esc(c.checkOut)} (${nights} ${esc(t("nights"))}) · ${esc(t("Adults"))} ${c.adults}${c.children ? ` · ${esc(t("Children"))} ${c.children}` : ""} · ${esc(t("Rooms"))} ${c.rooms}<br>
<span class="muted">${esc(t("Exported"))}: ${esc(generated)} · ${esc(t("Prices and availability are as captured at that time."))}</span>
<div class="legend muted"><span class="pass">✓ ${esc(t("verified"))}</span><span class="warn">✓ ${esc(t("likely / estimated"))}</span><span class="fail">✕ ${esc(t("does not meet"))}</span><span class="unk">? ${esc(t("not stated on the listing"))}</span></div></div>
<div class="stats">${[
    ["searched", stats.searched],
    ["available", stats.available],
    ["detail verified", stats.detailVerified],
    ["matched", stats.matched],
    ["need review", stats.review],
    ["rejected", stats.rejected],
  ]
    .map(([k, v]) => `<div><b>${v}</b><span class="muted">${esc(t(String(k)))}</span></div>`)
    .join("")}</div>
<div class="tabs">${tabs.map(([k, l, n], i) => `<button data-tab="${k}"${i === 0 ? ' class="on"' : ""}>${esc(l)} (${n})</button>`).join("")}</div>
<div id="list">${sorted.map((r) => card(r, c, lang, favorites.has(r.id) ? favorites.get(r.id) || "" : null)).join("\n")}</div>
</div>
<script>
(function(){var cur="MATCHED";function show(){document.querySelectorAll("article").forEach(function(a){a.style.display=(cur==="FAV"?a.dataset.fav==="1":a.dataset.status===cur)?"":"none"});document.querySelectorAll(".tabs button").forEach(function(b){b.className=b.dataset.tab===cur?"on":""})}
document.querySelectorAll(".tabs button").forEach(function(b){b.onclick=function(){cur=b.dataset.tab;show()}});show()})();
</script></body></html>`;
}
