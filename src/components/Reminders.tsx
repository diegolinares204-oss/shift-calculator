"use client";

import { useEffect, useRef } from "react";
import { getDb } from "@/db/repo";
import { useSettings } from "@/lib/hooks";
import { addDays, fmtDate, toEpoch, todayKey } from "@/lib/time";

/**
 * Recordatorios locales. Limitación real: los navegadores solo permiten mostrar
 * notificaciones programadas mientras la aplicación está abierta (o en segundo plano
 * reciente). No hay servidor de notificaciones push, por diseño (privacidad y coste cero).
 */
export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function notify(title: string, body: string, tag: string) {
  if (!notificationsSupported() || Notification.permission !== "granted") return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" });
    else new Notification(title, { body, tag });
    return true;
  } catch {
    return false;
  }
}

function alreadySent(key: string): boolean {
  try {
    const raw = localStorage.getItem("sc-reminders-sent");
    const sent: Record<string, number> = raw ? JSON.parse(raw) : {};
    if (sent[key]) return true;
    const cutoff = Date.now() - 14 * 86_400_000;
    for (const k of Object.keys(sent)) if (sent[k] < cutoff) delete sent[k];
    sent[key] = Date.now();
    localStorage.setItem("sc-reminders-sent", JSON.stringify(sent));
    return false;
  } catch {
    return false;
  }
}

export function Reminders() {
  const settings = useSettings();
  const cfg = settings?.reminders;
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; }, [cfg]);

  useEffect(() => {
    if (!cfg?.enabled) return;
    const run = async () => {
      const r = cfgRef.current;
      if (!r?.enabled) return;
      const db = getDb();
      const now = Date.now();
      const today = todayKey();
      // turnos próximos
      if (r.shiftMinutesBefore > 0) {
        const shifts = await db.shifts.where("date").between(today, addDays(today, 1), true, true).toArray();
        for (const s of shifts) {
          if (s.status !== "planned") continue;
          const start = toEpoch(s.planned.start);
          const diff = start - now;
          if (diff > 0 && diff <= r.shiftMinutesBefore * 60_000 && !alreadySent(`shift-${s.id}-${s.planned.start}`)) {
            await notify("Próximo turno", `Tu turno empieza a las ${s.planned.start.slice(11, 16)}.`, `shift-${s.id}`);
          }
        }
      }
      // fichaje abierto demasiado tiempo
      if (r.openClockHours > 0) {
        const open = await db.clockSessions.filter((s) => s.endAt === null).toArray();
        for (const s of open) {
          if (now - s.startAt >= r.openClockHours * 3_600_000 && !alreadySent(`open-${s.id}`)) {
            await notify("Fichaje abierto", `Llevas más de ${r.openClockHours} h con el fichaje abierto. Revisa si olvidaste fichar la salida.`, `open-${s.id}`);
          }
        }
      }
      // vacaciones próximas
      if (r.vacationDaysBefore > 0) {
        const limit = addDays(today, r.vacationDaysBefore);
        const abs = await db.absences.where("startDate").between(today, limit, true, true).toArray();
        for (const a of abs) {
          if (a.type === "vacation" && a.status !== "rejected" && !alreadySent(`vac-${a.id}`)) {
            await notify("Vacaciones próximas", `Tus vacaciones empiezan el ${fmtDate(a.startDate)}.`, `vac-${a.id}`);
          }
        }
      }
    };
    void run();
    const t = setInterval(() => void run(), 60_000);
    return () => clearInterval(t);
  }, [cfg?.enabled]);

  return null;
}
