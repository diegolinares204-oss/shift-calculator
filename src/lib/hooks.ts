"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb, loadContracts, loadJobs } from "@/db/repo";
import { contractAt } from "./engine";
import { todayKey } from "./time";
import type { Job, Absence, ClockBreak, ClockSession, Contract, Holiday, HourAdjustment, Payslip, Profile, Settings, Shift, Template } from "./types";

export function useJobs(): Job[] | undefined {
  return useLiveQuery(() => loadJobs(), []);
}

export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getDb().settings.get("app"), []);
}

export function useProfile(): Profile | undefined {
  return useLiveQuery(() => getDb().profile.get("main"), []);
}

export function useContracts(): Contract[] | undefined {
  return useLiveQuery(() => loadContracts(), []);
}

export function useCurrentContract(): { contract: Contract | null; contracts: Contract[]; loading: boolean } {
  const contracts = useContracts();
  return useMemo(() => ({ contracts: contracts ?? [], contract: contracts ? contractAt(contracts, todayKey()) : null, loading: contracts === undefined }), [contracts]);
}

export function useShifts(): Shift[] | undefined {
  return useLiveQuery(() => getDb().shifts.toArray(), []);
}

export function useShiftsBetween(from: string, to: string): Shift[] | undefined {
  return useLiveQuery(() => getDb().shifts.where("date").between(from, to, true, true).toArray(), [from, to]);
}

export function useHolidays(): Holiday[] | undefined {
  return useLiveQuery(() => getDb().holidays.orderBy("date").toArray(), []);
}

export function useAbsences(): Absence[] | undefined {
  return useLiveQuery(() => getDb().absences.orderBy("startDate").toArray(), []);
}

export function usePayslips(): Payslip[] | undefined {
  return useLiveQuery(() => getDb().payslips.orderBy("period").toArray(), []);
}

export function useTemplates(): Template[] | undefined {
  return useLiveQuery(() => getDb().templates.toArray(), []);
}

export function useAdjustments(): HourAdjustment[] | undefined {
  return useLiveQuery(() => getDb().hourAdjustments.orderBy("date").toArray(), []);
}

export function useSessions(): ClockSession[] | undefined {
  return useLiveQuery(() => getDb().clockSessions.orderBy("startAt").reverse().toArray(), []);
}

export function useClockBreaks(): ClockBreak[] | undefined {
  return useLiveQuery(() => getDb().clockBreaks.toArray(), []);
}

export function useOpenSession() {
  return useLiveQuery(async () => {
    const db = getDb();
    const open = (await db.clockSessions.filter((s) => s.endAt === null).toArray()).sort((a, b) => b.startAt - a.startAt)[0] ?? null;
    if (!open) return { session: null, breaks: [] as ClockBreak[] };
    const breaks = await db.clockBreaks.where("sessionId").equals(open.id).toArray();
    return { session: open, breaks };
  }, []);
}

/**
 * Datos comunes para cálculos y ámbito de trabajos seleccionado.
 *  - scope: "all" o el id del trabajo elegido en el selector global.
 *  - jobIds: trabajos incluidos en el ámbito.
 *  - primaryJobId: trabajo por defecto para crear registros (el elegido o el primero).
 */
export function useCalcData() {
  const shifts = useShifts();
  const contracts = useContracts();
  const holidays = useHolidays();
  const absences = useAbsences();
  const profile = useProfile();
  const jobs = useJobs();
  const settings = useSettings();
  const today = todayKey();
  return useMemo(() => {
    const ready = !!shifts && !!contracts && !!holidays && !!absences && !!profile && !!jobs && jobs.length > 0 && !!settings;
    const jobList = jobs ?? [];
    const requested = settings?.activeJobId ?? "all";
    const scope = requested !== "all" && jobList.some((j) => j.id === requested) ? requested : "all";
    const jobIds = scope === "all" ? jobList.map((j) => j.id) : [scope];
    const primaryJobId = scope !== "all" ? scope : jobList.find((j) => !j.archived)?.id ?? jobList[0]?.id ?? "";
    const allContracts = contracts ?? [];
    const contractFor = (jobId: string) => contractAt(allContracts.filter((c) => c.jobId === jobId), today);
    return {
      ready,
      shifts: shifts ?? [],
      contracts: allContracts,
      holidays: holidays ?? [],
      absences: absences ?? [],
      profile: profile ?? null,
      currency: profile?.currency ?? "EUR",
      jobs: jobList,
      jobMap: new Map(jobList.map((j) => [j.id, j])),
      multi: jobList.length > 1,
      scope,
      jobIds,
      primaryJobId,
      contractFor,
      /** contrato vigente del trabajo principal del ámbito */
      contract: primaryJobId ? contractFor(primaryJobId) : null,
    };
  }, [shifts, contracts, holidays, absences, profile, jobs, settings, today]);
}

/** Marca de tiempo que se actualiza cada `ms` (para contadores en vivo). */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    const vis = () => setNow(Date.now());
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [ms]);
  return now;
}

/** Fecha de hoy que cambia al pasar la medianoche. */
export function useToday() {
  const now = useNow(30_000);
  return useMemo(() => {
    void now;
    return todayKey();
  }, [now]);
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [q]);
  return m;
}
