"use client";

/** Pestaña inicial a partir del fragmento de la URL (#...). Las vistas solo se renderizan en el cliente. */
export function initialFromHash<T extends string>(map: Record<string, T>, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  return map[window.location.hash.slice(1)] ?? fallback;
}
