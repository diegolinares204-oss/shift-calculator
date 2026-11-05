"use client";

import { useId, useState } from "react";
import { Field, Input } from "./ui";
import { centsToInput, parseMoney, parseNumber, numberToInput } from "@/lib/money";
import { parseHoursInput } from "@/lib/time";

function minutesToInput(min: number): string {
  if (!min) return "";
  return String(Math.round((min / 60) * 100) / 100).replace(".", ",");
}

interface Base {
  label: string;
  hint?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  suffix?: string;
}

function useDraft<T>(value: T, toText: (v: T) => string) {
  const [text, setText] = useState(() => toText(value));
  const [focused, setFocused] = useState(false);
  const [synced, setSynced] = useState(value);
  // sincronizar con cambios externos solo cuando el campo no se está editando
  if (!focused && synced !== value) {
    setSynced(value);
    setText(toText(value));
  }
  return { text, setText, setFocused };
}

function Suffixed({ suffix, children }: { suffix?: string; children: React.ReactNode }) {
  if (!suffix) return <>{children}</>;
  return (
    <div className="relative">
      {children}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-3">{suffix}</span>
    </div>
  );
}

/** Horas en formato decimal ("7,5") u horas:minutos ("7:30"); el valor es en minutos. */
export function HoursField({ label, hint, value, onChange, className, placeholder = "0", disabled, suffix = "h" }: Base & { value: number; onChange: (min: number) => void }) {
  const id = useId();
  const { text, setText, setFocused } = useDraft(value, minutesToInput);
  const parsed = parseHoursInput(text);
  const invalid = text.trim() !== "" && (parsed === null || parsed < 0);
  return (
    <Field label={label} hint={hint ?? "Admite 7,5 o 7:30"} error={invalid ? "Introduce horas válidas (p. ej. 7,5 o 7:30)" : null} htmlFor={id} className={className}>
      <Suffixed suffix={suffix}>
        <Input
          id={id}
          inputMode="decimal"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          className="pr-9"
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); }}
          onChange={(e) => {
            setText(e.target.value);
            const p = parseHoursInput(e.target.value);
            if (e.target.value.trim() === "") onChange(0);
            else if (p !== null && p >= 0) onChange(p);
          }}
        />
      </Suffixed>
    </Field>
  );
}

/** Importe monetario; el valor es en céntimos. */
export function MoneyField({ label, hint, value, onChange, className, placeholder = "0,00", disabled, suffix = "€", allowNegative }: Base & { value: number; onChange: (cents: number) => void; allowNegative?: boolean }) {
  const id = useId();
  const { text, setText, setFocused } = useDraft(value, centsToInput);
  const parsed = parseMoney(text);
  const invalid = text.trim() !== "" && (parsed === null || (!allowNegative && parsed < 0));
  return (
    <Field label={label} hint={hint} error={invalid ? "Importe no válido" : null} htmlFor={id} className={className}>
      <Suffixed suffix={suffix}>
        <Input
          id={id}
          inputMode="decimal"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          className="pr-12 tabular"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setText(e.target.value);
            const p = parseMoney(e.target.value);
            if (e.target.value.trim() === "") onChange(0);
            else if (p !== null && (allowNegative || p >= 0)) onChange(p);
          }}
        />
      </Suffixed>
    </Field>
  );
}

export function NumberField({ label, hint, value, onChange, className, placeholder = "0", disabled, suffix, min, max, integer }: Base & { value: number; onChange: (n: number) => void; min?: number; max?: number; integer?: boolean }) {
  const id = useId();
  const { text, setText, setFocused } = useDraft(value, numberToInput);
  const parsed = parseNumber(text);
  const bad = text.trim() !== "" && (parsed === null || (min != null && parsed < min) || (max != null && parsed > max) || (integer && !Number.isInteger(parsed)));
  return (
    <Field label={label} hint={hint} error={bad ? `Valor no válido${min != null && max != null ? ` (${min}–${max})` : ""}` : null} htmlFor={id} className={className}>
      <Suffixed suffix={suffix}>
        <Input
          id={id}
          inputMode={integer ? "numeric" : "decimal"}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          className={suffix ? "pr-12 tabular" : "tabular"}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            setText(e.target.value);
            const p = parseNumber(e.target.value);
            if (e.target.value.trim() === "") onChange(0);
            else if (p !== null && (min == null || p >= min) && (max == null || p <= max) && (!integer || Number.isInteger(p))) onChange(p);
          }}
        />
      </Suffixed>
    </Field>
  );
}

export function currencySymbol(code: string): string {
  try {
    return new Intl.NumberFormat("es-ES", { style: "currency", currency: code }).formatToParts(0).find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}
