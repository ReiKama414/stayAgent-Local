import type { Fact, Offer, ProviderId } from "./types";

export const money = (n: number | null | undefined, cur = "TWD") =>
  n == null ? "UNKNOWN" : `${cur === "TWD" ? "NT$" : cur + " "}${Math.round(n).toLocaleString("en-US")}`;

export const countText = (f: Fact<number>) =>
  f.value == null || f.confidence === "UNKNOWN" ? "UNKNOWN" : `${f.qualifier === "atLeast" ? "≥" : ""}${f.value}`;

export const time = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
};

const LOCALE: Record<string, string> = { en: "en-GB", zh: "zh-TW", ja: "ja-JP" };

export const dateTime = (iso: string, lang = "en") => {
  try {
    return new Date(iso).toLocaleString(LOCALE[lang] ?? "en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
};

export const PROVIDER_STYLE: Record<ProviderId, string> = {
  booking: "bg-[#003b95] text-white",
  agoda: "bg-[#c8102e] text-white",
  airbnb: "bg-[#d90b3e] text-white",
  trip: "bg-[#1b5fc9] text-white",
};

export const primaryOffer = (r: { offers: Offer[]; primary: number }) => r.offers[r.primary] ?? r.offers[0];

export const confClass = (c: string) =>
  c === "VERIFIED"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
    : c === "LIKELY"
      ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
      : c === "CONFLICT"
        ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300"
        : "bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400";
