"use client";
import { createContext, useContext } from "react";
import { translate, type Lang } from "./i18n-dict";

export { LANGS, translate, type Lang } from "./i18n-dict";

const LangContext = createContext<Lang>("zh");
export const LangProvider = LangContext.Provider;

export function useT() {
  const lang = useContext(LangContext);
  return (s: string) => translate(lang, s);
}

export function useLang() {
  return useContext(LangContext);
}
