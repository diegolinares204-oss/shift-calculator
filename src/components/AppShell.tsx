"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { BarChart3, CalendarDays, Clock3, Home, ListChecks, MoreHorizontal, Palmtree, Settings as SettingsIcon, Timer, Wallet, RefreshCw, AlertTriangle } from "lucide-react";
import { FeedbackProvider, Button, cx, Modal } from "./ui";
import { Onboarding } from "./Onboarding";
import { JobSwitcher } from "./jobs";
import { Reminders } from "./Reminders";
import { ensureInitialized } from "@/db/repo";
import { useCurrentContract, useOpenSession, useProfile, useSettings, useNow } from "@/lib/hooks";
import { fmtDuration } from "@/lib/time";

export const NAV = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/calendario/", label: "Calendario", icon: CalendarDays },
  { href: "/turnos/", label: "Mis turnos", icon: ListChecks },
  { href: "/control-horario/", label: "Control horario", icon: Timer },
  { href: "/salario/", label: "Salario", icon: Wallet },
  { href: "/estadisticas/", label: "Estadísticas", icon: BarChart3 },
  { href: "/ausencias/", label: "Vacaciones y ausencias", icon: Palmtree },
  { href: "/configuracion/", label: "Configuración", icon: SettingsIcon },
] as const;

const MOBILE_MAIN = ["/", "/calendario/", "/turnos/", "/control-horario/"];

function normalize(p: string) {
  if (!p || p === "/") return "/";
  return p.endsWith("/") ? p : `${p}/`;
}

function useThemeClass(theme: "system" | "light" | "dark" | undefined) {
  useEffect(() => {
    if (!theme) return;
    try { localStorage.setItem("sc-theme", theme); } catch { /* almacenamiento no disponible */ }
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0d0f13" : "#f5f6f8");
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

function useServiceWorker() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    // Solo se recarga cuando el usuario ha pedido aplicar una actualización (no en la primera instalación).
    const onCtrl = () => {
      if (sessionStorage.getItem("sc-sw-update") === "1") {
        sessionStorage.removeItem("sc-sw-update");
        window.location.reload();
      }
    };
    navigator.serviceWorker.addEventListener("controllerchange", onCtrl);
    navigator.serviceWorker.register("/sw.js").then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const nw = reg.installing;
        nw?.addEventListener("statechange", () => {
          if (nw.state === "installed" && navigator.serviceWorker.controller) setWaiting(nw);
        });
      });
      const check = () => reg.update().catch(() => undefined);
      document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check());
    }).catch(() => undefined);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", onCtrl);
  }, []);
  return {
    waiting,
    apply: () => {
      try { sessionStorage.setItem("sc-sw-update", "1"); } catch { /* sin almacenamiento */ }
      waiting?.postMessage({ type: "SKIP_WAITING" });
    },
  };
}

function OpenClockBanner() {
  const open = useOpenSession();
  const settings = useSettings();
  const now = useNow(30_000);
  const s = open?.session;
  if (!s) return null;
  const limitH = settings?.reminders.openClockHours || 12;
  const elapsed = Math.round((now - s.startAt) / 60_000);
  if (elapsed < limitH * 60) return null;
  return (
    <Link href="/control-horario/" className="mb-4 flex items-center gap-3 rounded-2xl border border-warn/40 bg-warn-soft p-3 text-sm text-fg">
      <AlertTriangle className="size-5 shrink-0 text-warn" />
      <span>Tienes un fichaje abierto desde hace <strong>{fmtDuration(elapsed)}</strong>. Revísalo y ficha la salida o corrígelo; no se cerrará automáticamente.</span>
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const pathname = normalize(usePathname() ?? "/");
  const [more, setMore] = useState(false);
  const { waiting, apply } = useServiceWorker();
  const open = useOpenSession();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const moreActive = !MOBILE_MAIN.some((h) => isActive(h));

  return (
    <div className="min-h-dvh lg:flex">
      {/* lateral (escritorio) */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface px-3 py-5 lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-fg"><Clock3 className="size-5" /></span>
          <span className="text-sm font-bold tracking-wide">SHIFT CALCULATOR</span>
        </Link>
        <nav aria-label="Principal" className="flex flex-1 flex-col gap-0.5">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className={cx("flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors", isActive(href) ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg")}>
              <Icon className="size-[18px]" />
              {label}
              {href === "/control-horario/" && open?.session && <span className="ml-auto size-2 rounded-full bg-ok" aria-label="Fichaje en curso" />}
            </Link>
          ))}
        </nav>
        <p className="px-3 text-[11px] leading-relaxed text-fg-3">Datos guardados solo en este dispositivo.</p>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="safe-top mx-auto w-full max-w-6xl px-4 pb-nav pt-5 sm:px-6 lg:px-8 lg:pt-8">
          {waiting && (
            <div className="anim-pop mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent-soft p-3 text-sm">
              <span className="flex items-center gap-2"><RefreshCw className="size-4 text-accent" />Hay una nueva versión disponible.</span>
              <Button size="sm" variant="primary" onClick={apply}>Actualizar ahora</Button>
            </div>
          )}
          <OpenClockBanner />
          {!pathname.startsWith("/configuracion") && <JobSwitcher />}
          {children}
        </div>
      </main>

      {/* inferior (móvil) */}
      <nav aria-label="Principal" className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface lg:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {NAV.filter((n) => MOBILE_MAIN.includes(n.href)).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className={cx("relative flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] font-medium", isActive(href) ? "text-accent" : "text-fg-3")}>
              <Icon className="size-[22px]" />
              {href === "/control-horario/" ? "Fichaje" : href === "/turnos/" ? "Turnos" : label}
              {href === "/control-horario/" && open?.session && <span className="absolute right-[calc(50%-16px)] top-2 size-2 rounded-full bg-ok" />}
            </Link>
          ))}
          <button type="button" onClick={() => setMore(true)} aria-expanded={more} className={cx("flex flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] font-medium", moreActive ? "text-accent" : "text-fg-3")}>
            <MoreHorizontal className="size-[22px]" />
            Más
          </button>
        </div>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="Más secciones" size="sm">
        <div className="grid grid-cols-2 gap-2 pb-2">
          {NAV.filter((n) => !MOBILE_MAIN.includes(n.href)).map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setMore(false)} className={cx("flex flex-col items-start gap-3 rounded-2xl border p-4 text-sm font-medium", isActive(href) ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface-2/50 text-fg")}>
              <Icon className="size-5" />
              {label}
            </Link>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function Gate({ children }: { children: ReactNode }) {
  const [initError, setInitError] = useState<string | null>(null);
  const [inited, setInited] = useState(false);
  useEffect(() => {
    ensureInitialized()
      .then(() => setInited(true))
      .catch((e: unknown) => setInitError(e instanceof Error ? e.message : String(e)));
    // solicitar almacenamiento persistente para reducir el riesgo de que el navegador borre los datos
    navigator.storage?.persist?.().catch(() => undefined);
  }, []);
  const settings = useSettings();
  const profile = useProfile();
  const { contract } = useCurrentContract();
  useThemeClass(settings?.theme);

  if (initError) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold">No se puede acceder al almacenamiento local</h1>
        <p className="text-sm text-fg-3">El navegador no permite usar IndexedDB (por ejemplo, en algunos modos privados). SHIFT CALCULATOR necesita almacenamiento local para guardar tus datos en el dispositivo.</p>
        <p className="mt-3 text-xs text-fg-3">{initError}</p>
      </div>
    );
  }
  if (!inited || !settings) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Cargando">
        <div className="flex size-12 animate-pulse items-center justify-center rounded-2xl bg-accent text-accent-fg"><Clock3 className="size-6" /></div>
      </div>
    );
  }
  if (!settings.onboardingDone) return <Onboarding initialProfile={profile} initialContract={contract} />;
  return (
    <>
      <Reminders />
      <Shell>{children}</Shell>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <FeedbackProvider>
      <Gate>{children}</Gate>
    </FeedbackProvider>
  );
}
