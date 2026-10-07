"use client";
import { useId, useState, type ReactNode } from "react";
import type { Level } from "@/lib/types";
import { useT } from "@/lib/i18n";

export function Section({ title, children, defaultOpen = true, badge }: { title: string; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-stone-200 py-3 last:border-0 dark:border-stone-800">
      <button type="button" className="flex w-full items-center justify-between text-left text-sm font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="flex items-center gap-2">
          {title}
          {badge}
        </span>
        <span className="text-stone-400">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </div>
  );
}

const LEVEL_STYLE: Record<Level, string> = {
  REQUIRED: "bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900",
  PREFERRED: "bg-accent-100 text-accent-700 dark:bg-accent-700/40 dark:text-accent-100",
  IGNORE: "bg-transparent text-stone-400",
};

const LEVEL_NAME: Record<Level, string> = { REQUIRED: "Required", PREFERRED: "Preferred", IGNORE: "Ignore" };

export function LevelSelect({ value, onChange, label }: { value: Level; onChange: (v: Level) => void; label?: string }) {
  const t = useT();
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded border border-stone-300 text-[10px] font-semibold dark:border-stone-700">
      {(["REQUIRED", "PREFERRED", "IGNORE"] as Level[]).map((l) => (
        <button key={l} type="button" aria-pressed={value === l} title={t(LEVEL_NAME[l])} aria-label={t(LEVEL_NAME[l])} onClick={() => onChange(l)} className={`px-1.5 py-0.5 ${value === l ? LEVEL_STYLE[l] : "text-stone-400 hover:bg-stone-100 dark:hover:bg-stone-800"}`}>
          {l === "REQUIRED" ? "REQ" : l === "PREFERRED" ? "PREF" : "IGN"}
        </button>
      ))}
    </div>
  );
}

export function Row({ label, level, onLevel, children }: { label: string; level?: Level; onLevel?: (l: Level) => void; children?: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span id={id} className="text-xs font-medium text-stone-600 dark:text-stone-300">
          {label}
        </span>
        {level && onLevel && <LevelSelect value={level} onChange={onLevel} label={label} />}
      </div>
      {children}
    </div>
  );
}

export function NumInput({ value, onChange, placeholder, min, step, className, label }: { value: number | null; onChange: (v: number | null) => void; placeholder?: string; min?: number; step?: number; className?: string; label?: string }) {
  const t = useT();
  return (
    <input
      type="number"
      aria-label={label ?? t(placeholder ?? "any")}
      className={`input ${className ?? ""}`}
      value={value ?? ""}
      min={min}
      step={step}
      placeholder={t(placeholder ?? "any")}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm">
      <input type="checkbox" className="h-4 w-4 accent-[#23675f]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`chip ${className}`}>{children}</span>;
}
