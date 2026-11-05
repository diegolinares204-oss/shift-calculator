"use client";

import { useState } from "react";
import { Coffee, LogIn, LogOut, Play } from "lucide-react";
import { Button, Modal, Toggle, Textarea, Field, LabeledInput, Callout, useFeedback, cx } from "./ui";
import { useCalcData, useNow, useOpenSession, useSettings } from "@/lib/hooks";
import { JobSelect, JobTag } from "./jobs";
import { clockIn, clockOut, endBreak, startBreak, getDb } from "@/db/repo";
import { fmtTimeEpoch, fmtDuration, toLocalDateTime, MINUTE } from "@/lib/time";
import type { ClockBreak } from "@/lib/types";

export function workedMs(startAt: number, breaks: ClockBreak[], now: number, endAt: number | null = null) {
  const end = endAt ?? now;
  const br = breaks.reduce((s, b) => s + Math.max(0, Math.min(b.endAt ?? end, end) - Math.max(b.startAt, startAt)), 0);
  return Math.max(0, end - startAt - br);
}

function fmtClock(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/** Hora opcional distinta a "ahora" para registrar la hora real (p. ej. si fichas tarde). */
function TimeOverride({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [on, setOn] = useState(false);
  return (
    <div className="space-y-2">
      <Toggle label="Usar otra hora" description="Por defecto se registra la hora actual." checked={on} onChange={(v) => { setOn(v); onChange(v ? toLocalDateTime(new Date()) : ""); }} />
      {on && <LabeledInput label="Fecha y hora real" type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

export function ClockWidget({ compact = false }: { compact?: boolean }) {
  const data = useOpenSession();
  const { jobs, jobMap, primaryJobId } = useCalcData();
  const [jobId, setJobId] = useState<string | null>(null);
  const settings = useSettings();
  const now = useNow(1000);
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [outOpen, setOutOpen] = useState(false);
  const [inOpen, setInOpen] = useState(false);
  const [sync, setSync] = useState(true);
  const [paidBreaks, setPaidBreaks] = useState(false);
  const [notes, setNotes] = useState("");
  const [when, setWhen] = useState("");

  if (data === undefined) return <div className="h-32 animate-pulse rounded-2xl bg-surface-2" />;
  const s = data.session;
  const onBreak = data.breaks.some((b) => b.endAt === null);
  const worked = s ? workedMs(s.startAt, data.breaks, now) : 0;
  const breakMs = s ? data.breaks.reduce((a, b) => a + ((b.endAt ?? now) - b.startAt), 0) : 0;
  const limitH = settings?.reminders.openClockHours || 12;
  const tooLong = s && now - s.startAt > limitH * 3_600_000;
  const at = () => (when ? new Date(when).getTime() : Date.now());

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      return true;
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo completar", "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx("rounded-2xl border p-4 sm:p-5", s ? (onBreak ? "border-warn/40 bg-warn-soft" : "border-ok/40 bg-ok-soft") : "border-line bg-surface")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-fg-3">{s ? (onBreak ? "En descanso" : "Trabajando") : "Sin fichaje activo"}</p>
          {s && jobs.length > 1 && <JobTag job={jobMap.get(s.jobId)} />}
          <p className={cx("font-semibold tabular tracking-tight text-fg", compact ? "text-3xl" : "text-4xl sm:text-5xl")} aria-live="off">{fmtClock(worked)}</p>
          {s && (
            <p className="mt-1 text-xs text-fg-2">
              Entrada {fmtTimeEpoch(s.startAt)}{breakMs > 0 && ` · Descansos ${fmtDuration(Math.round(breakMs / MINUTE))}`}
            </p>
          )}
        </div>
        <span className={cx("mt-1 size-3 rounded-full", s ? (onBreak ? "bg-warn" : "animate-pulse bg-ok") : "bg-line")} aria-hidden />
      </div>
      {tooLong && <div className="mt-3"><Callout tone="warn">El fichaje lleva abierto más de {limitH} h. Si olvidaste fichar la salida, ficha ahora indicando la hora real.</Callout></div>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        {!s ? (
          <Button variant="primary" size="lg" className="col-span-2" icon={<LogIn className="size-5" />} loading={busy} onClick={() => { setWhen(""); setNotes(""); setInOpen(true); }}>Fichar entrada</Button>
        ) : (
          <>
            {onBreak ? (
              <Button size="lg" icon={<Play className="size-5" />} loading={busy} onClick={() => run(() => endBreak(s.id), "Descanso finalizado")}>Fin descanso</Button>
            ) : (
              <Button size="lg" icon={<Coffee className="size-5" />} loading={busy} onClick={() => run(() => startBreak(s.id), "Descanso iniciado")}>Descanso</Button>
            )}
            <Button variant="danger" size="lg" icon={<LogOut className="size-5" />} onClick={() => { setWhen(""); setNotes(s.notes); setOutOpen(true); }}>Salida</Button>
          </>
        )}
      </div>

      <Modal open={inOpen} onClose={() => setInOpen(false)} title="Fichar entrada" size="sm" footer={<Button variant="primary" loading={busy} onClick={async () => { if (await run(() => clockIn(jobId ?? primaryJobId, at(), notes), "Entrada registrada")) setInOpen(false); }}>Registrar entrada</Button>}>
        <div className="space-y-4">
          <JobSelect value={jobId ?? primaryJobId} onChange={(v) => v && setJobId(v)} jobs={jobs} label="¿En qué trabajo?" />
          <TimeOverride value={when} onChange={setWhen} />
          <Field label="Observaciones (opcional)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </Modal>

      <Modal open={outOpen} onClose={() => setOutOpen(false)} title="Fichar salida" size="sm"
        footer={<Button variant="primary" loading={busy} onClick={async () => {
          if (!s) return;
          let linked = false;
          const ok = await run(async () => {
            await getDb().clockSessions.update(s.id, { notes });
            linked = !!(await clockOut(s.id, at(), { syncShift: sync, breaksPaid: paidBreaks }));
          }, "Salida registrada");
          if (ok && sync) toast(linked ? "Salida registrada y turno actualizado" : "Salida registrada. No se crea turno: duración inferior a 1 minuto", linked ? "ok" : "info");
          if (ok) setOutOpen(false);
        }}>Registrar salida</Button>}>
        <div className="space-y-4">
          <p className="text-sm text-fg-2">Tiempo trabajado: <strong className="tabular">{fmtClock(worked)}</strong></p>
          <TimeOverride value={when} onChange={setWhen} />
          <Toggle label="Registrar como turno realizado" description="Si había un turno previsto ese día se marca como realizado con este horario real; si no, se crea uno nuevo. Así las horas se cuentan una sola vez." checked={sync} onChange={setSync} />
          {sync && <Toggle label="Descansos remunerados" checked={paidBreaks} onChange={setPaidBreaks} />}
          <Field label="Observaciones"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </Modal>
    </div>
  );
}
