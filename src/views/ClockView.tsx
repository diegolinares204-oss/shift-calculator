"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ClipboardList, History, PiggyBank, Plus, Pencil, Trash2, Timer, Scale } from "lucide-react";
import { Button, Card, CardTitle, EmptyState, Field, IconButton, LabeledInput, Modal, PageHeader, Segmented, Spinner, Stat, Tabs, Textarea, Toggle, useFeedback, Badge, Callout } from "@/components/ui";
import { ClockWidget, workedMs } from "@/components/ClockWidget";
import { BarChart, LineChart } from "@/components/charts";
import { HoursField } from "@/components/inputs";
import { useAdjustments, useCalcData, useClockBreaks, useSessions, useToday } from "@/lib/hooks";
import { analyze, computeBank, referencePeriodFor } from "@/lib/engine";
import { forJob } from "@/lib/jobs";
import { JobSelect, JobTag } from "@/components/jobs";
import { addDays, addMonths, endOfMonth, fmtDate, fmtDateLong, fmtDateTimeEpoch, fmtDuration, fmtHours, fmtMonth, fmtSignedHours, fmtTimeEpoch, MINUTE, toDateKey, toLocalDateTime, endOfWeek, startOfWeek } from "@/lib/time";
import { deleteSession, getDb, saveManualSession } from "@/db/repo";
import { uid } from "@/lib/id";
import { initialFromHash } from "@/lib/hash";
import type { AuditEntry, ClockBreak, ClockSession } from "@/lib/types";
import { useLiveQuery } from "dexie-react-hooks";

type Tab = "clock" | "history" | "hours";

export function ClockView() {
  const [tab, setTab] = useState<Tab>(() => initialFromHash<Tab>({ historial: "history", horas: "hours" }, "clock"));
  return (
    <div>
      <PageHeader title="Control horario" subtitle="Fichajes, horas contratadas y bolsa de horas." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "clock", label: "Fichaje", icon: <Timer className="size-4" /> }, { value: "history", label: "Historial", icon: <History className="size-4" /> }, { value: "hours", label: "Horas y bolsa", icon: <Scale className="size-4" /> }]} />
      {tab === "clock" && <ClockTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "hours" && <HoursTab />}
    </div>
  );
}

// ------------------------------------------------------------------ fichaje

function ClockTab() {
  const sessions = useSessions();
  const breaks = useClockBreaks();
  const today = useToday();
  const [manual, setManual] = useState<ClockSession | null | "new">(null);
  const { jobIds } = useCalcData();
  const todays = (sessions ?? []).filter((s) => jobIds.includes(s.jobId) && toDateKey(new Date(s.startAt)) === today && s.endAt !== null);
  const total = todays.reduce((a, s) => a + workedMs(s.startAt, (breaks ?? []).filter((b) => b.sessionId === s.id), 0, s.endAt), 0);
  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <ClockWidget />
      <Card>
        <CardTitle action={<Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={() => setManual("new")}>Fichaje manual</Button>}>Hoy</CardTitle>
        {todays.length === 0 ? <p className="text-sm text-fg-3">Aún no hay fichajes cerrados hoy.</p> : (
          <ul className="space-y-2">
            {todays.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-xl bg-surface-2/60 px-3 py-2 text-sm">
                <span className="tabular">{fmtTimeEpoch(s.startAt)} – {fmtTimeEpoch(s.endAt!)}</span>
                <span className="font-medium tabular">{fmtDuration(Math.round(workedMs(s.startAt, (breaks ?? []).filter((b) => b.sessionId === s.id), 0, s.endAt) / MINUTE))}</span>
              </li>
            ))}
            <li className="flex justify-between px-3 pt-1 text-sm font-semibold"><span>Total</span><span className="tabular">{fmtDuration(Math.round(total / MINUTE))}</span></li>
          </ul>
        )}
        <p className="mt-4 text-xs text-fg-3">El fichaje abierto se conserva aunque cierres la aplicación o apagues el dispositivo. Nunca se cierra automáticamente.</p>
      </Card>
      <SessionEditor session={manual} breaks={breaks ?? []} onClose={() => setManual(null)} />
    </div>
  );
}

// ------------------------------------------------------------------ editor de fichajes

function SessionEditor({ session, breaks, onClose }: { session: ClockSession | null | "new"; breaks: ClockBreak[]; onClose: () => void }) {
  if (!session) return null;
  return <SessionForm key={session === "new" ? "new" : session.id} session={session} breaks={breaks} onClose={onClose} />;
}

function initialSession(session: ClockSession | "new", breaks: ClockBreak[]) {
  if (session === "new") {
    const now = new Date();
    now.setSeconds(0, 0);
    return { start: toLocalDateTime(new Date(now.getTime() - 8 * 3_600_000)), end: toLocalDateTime(now), brs: [] as { id: string; start: string; end: string }[], notes: "" };
  }
  return {
    start: toLocalDateTime(new Date(session.startAt)),
    end: toLocalDateTime(session.endAt ? new Date(session.endAt) : new Date()),
    brs: breaks.filter((b) => b.sessionId === session.id).map((b) => ({ id: b.id, start: toLocalDateTime(new Date(b.startAt)), end: toLocalDateTime(b.endAt ? new Date(b.endAt) : new Date()) })),
    notes: session.notes,
  };
}

function SessionForm({ session, breaks, onClose }: { session: ClockSession | "new"; breaks: ClockBreak[]; onClose: () => void }) {
  const { toast } = useFeedback();
  const editing = session !== "new" ? session : null;
  const { jobs, primaryJobId } = useCalcData();
  const [jobSel, setJobId] = useState<string | null>(editing?.jobId ?? null);
  // el trabajo por defecto se resuelve al guardar (los trabajos pueden no haber cargado aún al abrir)
  const jobId = jobSel || primaryJobId;
  const [init] = useState(() => initialSession(session, breaks));
  const [start, setStart] = useState(init.start);
  const [end, setEnd] = useState(init.end);
  const [brs, setBrs] = useState(init.brs);
  const [notes, setNotes] = useState(init.notes);
  const [reason, setReason] = useState("");
  const [sync, setSync] = useState(true);
  const [paid, setPaid] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setErr(null);
    if (editing && !reason.trim()) { setErr("Indica el motivo de la corrección (queda registrado)."); return; }
    setBusy(true);
    try {
      await saveManualSession({
        id: editing?.id,
        jobId,
        startAt: new Date(start).getTime(),
        endAt: new Date(end).getTime(),
        breaks: brs.filter((b) => b.start && b.end).map((b) => ({ startAt: new Date(b.start).getTime(), endAt: new Date(b.end).getTime() })),
        notes, reason: reason.trim() || "Registro manual", syncShift: sync, breaksPaid: paid,
      });
      toast(editing ? "Fichaje corregido" : "Fichaje registrado");
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  };

  const dur = start && end ? Math.round((new Date(end).getTime() - new Date(start).getTime()) / MINUTE) : 0;
  return (
    <Modal open onClose={onClose} title={editing ? (editing.endAt === null ? "Corregir fichaje abierto" : "Corregir fichaje") : "Registrar fichaje anterior"} size="md" footer={<Button variant="primary" loading={busy} onClick={save}>Guardar</Button>}>
      <div className="space-y-4">
        <JobSelect value={jobId} onChange={(v) => v && setJobId(v)} jobs={jobs} />
        {editing?.endAt === null && <Callout tone="warn">Este fichaje está abierto. Al guardar se cerrará con la hora de salida indicada.</Callout>}
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledInput label="Entrada" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
          <LabeledInput label="Salida" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} hint={dur > 0 ? `Duración ${fmtDuration(dur)}` : undefined} />
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium text-fg-2">Descansos</span><Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setBrs([...brs, { id: uid(), start: start, end: start }])}>Añadir</Button></div>
          {brs.map((b, i) => (
            <div key={b.id} className="mb-2 flex items-end gap-2">
              <LabeledInput className="flex-1" label="Inicio" type="datetime-local" value={b.start} onChange={(e) => setBrs(brs.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              <LabeledInput className="flex-1" label="Fin" type="datetime-local" value={b.end} onChange={(e) => setBrs(brs.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              <IconButton label="Quitar descanso" onClick={() => setBrs(brs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></IconButton>
            </div>
          ))}
        </div>
        <Field label="Observaciones"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {editing && <LabeledInput label="Motivo de la corrección (obligatorio)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: olvidé fichar la salida" />}
        <Toggle label="Registrar como turno realizado" description="Actualiza el turno vinculado o el previsto de ese día con este horario real." checked={sync} onChange={setSync} />
        {sync && <Toggle label="Descansos remunerados" checked={paid} onChange={setPaid} />}
        {err && <Callout tone="danger">{err}</Callout>}
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ historial

function HistoryTab() {
  const today = useToday();
  const [ym, setYm] = useState(today.slice(0, 7));
  const sessions = useSessions();
  const breaks = useClockBreaks();
  const { confirm, toast } = useFeedback();
  const [edit, setEdit] = useState<ClockSession | null | "new">(null);
  const [showLog, setShowLog] = useState(false);
  const log = useLiveQuery(async (): Promise<AuditEntry[]> => (showLog ? getDb().auditLog.orderBy("at").reverse().limit(300).toArray() : []), [showLog]);
  const { jobIds, jobMap, multi } = useCalcData();
  const list = (sessions ?? []).filter((s) => jobIds.includes(s.jobId) && toDateKey(new Date(s.startAt)).slice(0, 7) === ym);
  const total = list.reduce((a, s) => a + (s.endAt ? workedMs(s.startAt, (breaks ?? []).filter((b) => b.sessionId === s.id), 0, s.endAt) : 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center">
          <IconButton label="Mes anterior" onClick={() => setYm(addMonths(ym, -1))}><ChevronLeft className="size-5" /></IconButton>
          <h2 className="min-w-36 text-center text-sm font-semibold">{fmtMonth(ym)}</h2>
          <IconButton label="Mes siguiente" onClick={() => setYm(addMonths(ym, 1))}><ChevronRight className="size-5" /></IconButton>
        </div>
        <Badge tone="ok">Total {fmtDuration(Math.round(total / MINUTE))}</Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" icon={<ClipboardList className="size-4" />} onClick={() => setShowLog(true)}>Registro de modificaciones</Button>
          <Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit("new")}>Fichaje manual</Button>
        </div>
      </div>
      {!sessions ? <Spinner /> : list.length === 0 ? <EmptyState icon={<History className="size-8" />} title="Sin fichajes este mes" /> : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <ul className="divide-y divide-line">
            {list.map((s) => {
              const br = (breaks ?? []).filter((b) => b.sessionId === s.id);
              const brMin = br.reduce((a, b) => a + Math.round(((b.endAt ?? Date.now()) - b.startAt) / MINUTE), 0);
              return (
                <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium capitalize">{fmtDateLong(toDateKey(new Date(s.startAt)))}</p>
                    <p className="text-sm tabular text-fg-2">
                      {fmtTimeEpoch(s.startAt)} – {s.endAt ? (toDateKey(new Date(s.endAt)) !== toDateKey(new Date(s.startAt)) ? fmtDateTimeEpoch(s.endAt) : fmtTimeEpoch(s.endAt)) : <Badge tone="warn">Abierto</Badge>}
                      {brMin > 0 && <span className="text-fg-3"> · descansos {fmtDuration(brMin)}</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {multi && <JobTag job={jobMap.get(s.jobId)} />}
                      <Badge>{s.source === "live" ? "Fichaje" : "Manual"}</Badge>
                      {s.shiftId && <Badge tone="ok">Vinculado a turno</Badge>}
                      {s.notes && <span className="text-xs text-fg-3">{s.notes}</span>}
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular">{s.endAt ? fmtDuration(Math.round(workedMs(s.startAt, br, 0, s.endAt) / MINUTE)) : ""}</span>
                  <IconButton label="Corregir" onClick={() => setEdit(s)}><Pencil className="size-4" /></IconButton>
                  <IconButton label="Eliminar" onClick={async () => {
                    if (await confirm({ title: "Eliminar fichaje", message: "El fichaje se eliminará y quedará constancia en el registro de modificaciones. El turno vinculado (si lo hay) no se borra.", confirmLabel: "Eliminar", danger: true })) {
                      await deleteSession(s.id, "Eliminado por el usuario");
                      toast("Fichaje eliminado");
                    }
                  }}><Trash2 className="size-4" /></IconButton>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <SessionEditor session={edit} breaks={breaks ?? []} onClose={() => setEdit(null)} />
      <Modal open={showLog} onClose={() => setShowLog(false)} title="Registro de modificaciones" size="lg">
        {!log ? <Spinner /> : log.length === 0 ? <p className="text-sm text-fg-3">Sin cambios registrados.</p> : (
          <ul className="space-y-2 text-sm">
            {log.map((l) => (
              <li key={l.id} className="rounded-xl bg-surface-2/60 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2"><span className="text-xs tabular text-fg-3">{fmtDateTimeEpoch(l.at)}</span><Badge tone={l.action === "delete" ? "danger" : l.action === "create" ? "ok" : "accent"}>{l.action === "create" ? "Alta" : l.action === "update" ? "Cambio" : "Baja"}</Badge></div>
                <p className="mt-1 text-fg">{l.summary}</p>
                {l.reason && <p className="text-xs text-fg-3">Motivo: {l.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}

// ------------------------------------------------------------------ horas y bolsa

function HoursTab() {
  const d = useCalcData();
  const [sel, setSel] = useState<string | null>(null);
  if (!d.ready) return <Spinner />;
  const jobId = sel && d.jobMap.has(sel) ? sel : d.primaryJobId;
  return (
    <div className="space-y-4">
      {d.multi && (
        <div className="sm:w-80">
          <JobSelect value={jobId} onChange={(v) => v && setSel(v)} jobs={d.jobs} label="Horas y bolsa del trabajo" />
        </div>
      )}
      <HoursJob key={jobId} jobId={jobId} />
    </div>
  );
}

function HoursJob({ jobId }: { jobId: string }) {
  const all = useCalcData();
  const d = { ...all, ...forJob(all, jobId), contract: all.contractFor(jobId) };
  const job = all.jobMap.get(jobId);
  const today = useToday();
  const allAdjustments = useAdjustments();
  const adjustments = useMemo(() => allAdjustments?.filter((a) => a.jobId === jobId), [allAdjustments, jobId]);
  const { toast, confirm } = useFeedback();
  const [mode, setMode] = useState<"period" | "week" | "month" | "custom">("period");
  const [anchor, setAnchor] = useState(today);
  const [cFrom, setCFrom] = useState(`${today.slice(0, 7)}-01`);
  const [cTo, setCTo] = useState(today);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjDate, setAdjDate] = useState(today);
  const [adjMin, setAdjMin] = useState(0);
  const [adjNeg, setAdjNeg] = useState(true);
  const [adjReason, setAdjReason] = useState("");

  const range = useMemo(() => {
    if (mode === "custom") return { from: cFrom, to: cTo < cFrom ? cFrom : cTo };
    if (mode === "month") return { from: `${anchor.slice(0, 7)}-01`, to: endOfMonth(anchor.slice(0, 7)) };
    if (mode === "week" || !d.contract) return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
    return referencePeriodFor(d.contract, anchor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, anchor, cFrom, cTo, d.contract?.id, d.contract?.referencePeriod, d.contract?.customPeriodDays, d.contract?.customPeriodAnchor]);

  const res = useMemo(() => {
    if (!d.ready) return null;
    const base = { shifts: d.shifts, contracts: d.contracts, holidays: d.holidays, absences: d.absences, from: range.from, to: range.to };
    const worked = analyze({ ...base, mode: "worked" });
    const planned = analyze({ ...base, mode: "planned" });
    const firstContract = [...d.contracts].sort((x, y) => x.validFrom.localeCompare(y.validFrom))[0];
    const bankStart = job?.bankStartDate || firstContract?.validFrom || today;
    const bank = computeBank({ shifts: d.shifts, contracts: d.contracts, holidays: d.holidays, absences: d.absences, adjustments: adjustments ?? [], startDate: bankStart, initialMinutes: job?.bankInitialMinutes ?? 0, until: d.contract ? referencePeriodFor(d.contract, today).to : today, today });
    return { worked, planned, bank, bankStart };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, jobId, range, adjustments, today]);

  const step = (n: number) => {
    if (mode === "month") setAnchor(`${addMonths(anchor.slice(0, 7), n)}-01`);
    else if (mode === "week") setAnchor(addDays(anchor, 7 * n));
    else setAnchor(n > 0 ? addDays(range.to, 1) : addDays(range.from, -1));
  };

  if (!res) return <Spinner />;
  const { worked, planned, bank } = res;
  const diff = worked.paid - worked.expected;
  const pending = Math.max(0, worked.expected - worked.paid);
  const balance = bank.length ? bank[bank.length - 1].balance : job?.bankInitialMinutes ?? 0;
  const lastRows = bank.slice(-12);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented ariaLabel="Periodo" value={mode} onChange={setMode} options={[{ value: "period", label: "Referencia" }, { value: "week", label: "Semana" }, { value: "month", label: "Mes" }, { value: "custom", label: "Personalizado" }]} />
        {mode !== "custom" ? (
          <div className="flex items-center">
            <IconButton label="Anterior" onClick={() => step(-1)}><ChevronLeft className="size-5" /></IconButton>
            <span className="min-w-44 text-center text-sm font-semibold">{fmtDate(range.from)} – {fmtDate(range.to)}</span>
            <IconButton label="Siguiente" onClick={() => step(1)}><ChevronRight className="size-5" /></IconButton>
          </div>
        ) : (
          <div className="flex gap-2">
            <input aria-label="Desde" type="date" value={cFrom} onChange={(e) => e.target.value && setCFrom(e.target.value)} className="h-10 rounded-xl border border-line bg-surface px-2 text-sm" />
            <input aria-label="Hasta" type="date" value={cTo} onChange={(e) => e.target.value && setCTo(e.target.value)} className="h-10 rounded-xl border border-line bg-surface px-2 text-sm" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <Card><Stat label="Horas contratadas" value={fmtHours(worked.expected)} hint={worked.nominal !== worked.expected ? `Nominal ${fmtHours(worked.nominal)} (descontadas ausencias/festivos)` : "Según tu contrato"} /></Card>
        <Card><Stat label="Horas previstas" value={fmtHours(planned.paid)} hint="Turnos no cancelados" /></Card>
        <Card><Stat label="Horas realizadas" value={fmtHours(worked.paid)} hint="Turnos realizados" tone="accent" /></Card>
        <Card><Stat label="Diferencia con el contrato" value={fmtSignedHours(diff)} tone={diff > 0 ? "warn" : diff < 0 ? undefined : "ok"} hint={diff > 0 ? "Exceso de jornada" : diff < 0 ? "Por debajo del contrato" : "Exacto"} /></Card>
        <Card><Stat label="Horas pendientes" value={fmtHours(pending)} hint="Para llegar al contrato" /></Card>
        <Card><Stat label="Complementarias" value={fmtHours(worked.excess.complementary)} hint={d.contract?.complementary.enabled ? "Según tus reglas" : "Regla no activada"} /></Card>
        <Card><Stat label="Extraordinarias" value={fmtHours(worked.excess.overtime)} hint={d.contract?.overtime.enabled ? "Según tus reglas" : "Regla no activada"} /></Card>
        <Card><Stat label="Exceso sin clasificar" value={fmtHours(worked.excess.unclassified)} hint="No se clasifica sin reglas" /></Card>
      </div>
      {worked.excess.unclassified > 0 && !d.contract?.complementary.enabled && !d.contract?.overtime.enabled && (
        <Callout>Has trabajado {fmtHours(worked.excess.unclassified)} más de lo contratado. No se clasifican como complementarias ni extraordinarias porque no has activado esas reglas (Configuración → Salario → Excesos de jornada).</Callout>
      )}

      <Card>
        <CardTitle icon={<PiggyBank className="size-4" />} action={<Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={() => { setAdjDate(today); setAdjMin(0); setAdjReason(""); setAdjNeg(true); setAdjOpen(true); }}>Ajuste</Button>}>
          Bolsa de horas
        </CardTitle>
        <div className="mb-4 flex flex-wrap items-end gap-6">
          <Stat label="Saldo acumulado" value={fmtSignedHours(balance)} tone={balance > 0 ? "warn" : balance < 0 ? "danger" : "ok"} hint={`Desde el ${fmtDate(res.bankStart)}${job?.bankInitialMinutes ? ` · saldo inicial ${fmtSignedHours(job.bankInitialMinutes)}` : ""}`} />
          <p className="max-w-md text-xs text-fg-3">Saldo = horas realizadas − horas contratadas (hasta hoy en el periodo actual) ± ajustes. Un saldo positivo indica horas trabajadas de más; negativo, horas debidas. Cambia la fecha de inicio y el saldo inicial en Configuración.</p>
        </div>
        {lastRows.length > 0 ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <LineChart title="Evolución del saldo" labels={lastRows.map((r) => fmtDate(r.period.from).slice(0, 5))} values={lastRows.map((r) => Math.round((r.balance / 60) * 100) / 100)} format={(v) => `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} h`} />
            <BarChart title="Contrato frente a realizadas" labels={lastRows.map((r) => fmtDate(r.period.from).slice(0, 5))} series={[{ name: "Contrato", color: "var(--series-1)" }, { name: "Realizadas", color: "var(--series-2)" }]} values={lastRows.map((r) => [Math.round((r.expected / 60) * 10) / 10, Math.round((r.worked / 60) * 10) / 10])} format={(v) => `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} h`} />
          </div>
        ) : <p className="text-sm text-fg-3">La bolsa empieza a contar desde la fecha de inicio configurada.</p>}
        {bank.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-fg-3"><th className="py-2 font-medium">Periodo</th><th className="text-right font-medium">Contrato</th><th className="text-right font-medium">Previstas</th><th className="text-right font-medium">Realizadas</th><th className="text-right font-medium">Ajustes</th><th className="text-right font-medium">Diferencia</th><th className="text-right font-medium">Saldo</th></tr></thead>
              <tbody>
                {[...bank].reverse().slice(0, 26).map((r) => (
                  <tr key={r.period.from} className="border-b border-line/60 tabular">
                    <td className="py-1.5">{fmtDate(r.period.from)} – {fmtDate(r.period.to)} {r.current && <Badge tone="accent">Actual</Badge>}</td>
                    <td className="text-right">{fmtHours(r.expected)}</td>
                    <td className="text-right">{fmtHours(r.planned)}</td>
                    <td className="text-right">{fmtHours(r.worked)}</td>
                    <td className="text-right">{r.adjustments ? fmtSignedHours(r.adjustments) : "—"}</td>
                    <td className="text-right">{fmtSignedHours(r.diff)}</td>
                    <td className="text-right font-semibold">{fmtSignedHours(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(adjustments ?? []).length > 0 && (
          <div className="mt-5">
            <h3 className="mb-2 text-sm font-semibold">Ajustes manuales</h3>
            <ul className="space-y-1.5">
              {(adjustments ?? []).slice().reverse().map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-xl bg-surface-2/60 px-3 py-2 text-sm">
                  <span>{fmtDate(a.date)} · {a.reason || "Sin motivo"}</span>
                  <span className="flex items-center gap-1 font-medium tabular">{fmtSignedHours(a.minutes)}
                    <IconButton label="Eliminar ajuste" onClick={async () => { if (await confirm({ title: "Eliminar ajuste", message: "¿Eliminar este ajuste de la bolsa?", danger: true, confirmLabel: "Eliminar" })) await getDb().hourAdjustments.delete(a.id); }}><Trash2 className="size-4" /></IconButton>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Modal open={adjOpen} onClose={() => setAdjOpen(false)} title="Ajuste de la bolsa de horas" size="sm"
        footer={<Button variant="primary" disabled={!adjMin} onClick={async () => { await getDb().hourAdjustments.put({ id: uid(), jobId, date: adjDate, minutes: adjNeg ? -adjMin : adjMin, reason: adjReason.trim(), createdAt: Date.now() }); toast("Ajuste guardado"); setAdjOpen(false); }}>Guardar</Button>}>
        <div className="space-y-3">
          <Segmented ariaLabel="Tipo de ajuste" value={adjNeg ? "neg" : "pos"} onChange={(v) => setAdjNeg(v === "neg")} options={[{ value: "neg", label: "Restar (p. ej. descanso compensado)" }, { value: "pos", label: "Sumar" }]} className="w-full" />
          <LabeledInput label="Fecha" type="date" value={adjDate} onChange={(e) => e.target.value && setAdjDate(e.target.value)} />
          <HoursField label="Horas" value={adjMin} onChange={setAdjMin} />
          <LabeledInput label="Motivo" value={adjReason} onChange={(e) => setAdjReason(e.target.value)} placeholder="Ej.: horas compensadas con descanso" />
        </div>
      </Modal>
    </div>
  );
}
