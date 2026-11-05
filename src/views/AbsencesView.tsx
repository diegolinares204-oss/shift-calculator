"use client";

import { useMemo, useRef, useState } from "react";
import { CalendarHeart, ChevronLeft, ChevronRight, Download, Flag, Pencil, Plus, Trash2, Upload, Palmtree, Check, X } from "lucide-react";
import { Badge, Button, Callout, Card, CardTitle, EmptyState, Field, IconButton, LabeledInput, LabeledSelect, Modal, PageHeader, Spinner, Stat, Tabs, Textarea, Toggle, useFeedback, cx } from "@/components/ui";
import { NumberField } from "@/components/inputs";
import { useCalcData, useToday } from "@/lib/hooks";
import { spainNationalHolidays, vacationDaysIn, vacationSummary } from "@/lib/engine";
import { analyzeJobs, jobLabel } from "@/lib/jobs";
import { JobDot, JobSelect, JobTag } from "@/components/jobs";
import { dateRange, endOfMonth, fmtDate, MONTH_NAMES, startOfWeek, addDays, weekdayOf, diffDays } from "@/lib/time";
import { getDb } from "@/db/repo";
import { nowMs, uid } from "@/lib/id";
import { holidaysToCsv, parseHolidayFile, SCOPE_LABELS } from "@/lib/holidays";
import { downloadBlob } from "@/lib/exporters";
import type { Job, Absence, AbsenceStatus, AbsenceType, Holiday, HolidayScope } from "@/lib/types";

export const ABSENCE_LABELS: Record<AbsenceType, string> = { vacation: "Vacaciones", dayoff: "Día libre", permit: "Permiso", absence: "Ausencia", sick: "Baja" };
export const ABSENCE_STATUS: Record<AbsenceStatus, string> = { requested: "Solicitada", approved: "Aprobada", taken: "Disfrutada", rejected: "Rechazada" };
const STATUS_TONE = { requested: "warn", approved: "accent", taken: "ok", rejected: "danger" } as const;

type Tab = "absences" | "holidays" | "year";

export function AbsencesView() {
  const [tab, setTab] = useState<Tab>("absences");
  const today = useToday();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  return (
    <div>
      <PageHeader title="Vacaciones y ausencias" actions={
        <div className="flex items-center">
          <IconButton label="Año anterior" onClick={() => setYear(year - 1)}><ChevronLeft className="size-5" /></IconButton>
          <span className="w-14 text-center font-semibold tabular">{year}</span>
          <IconButton label="Año siguiente" onClick={() => setYear(year + 1)}><ChevronRight className="size-5" /></IconButton>
        </div>
      } />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "absences", label: "Vacaciones y ausencias", icon: <Palmtree className="size-4" /> }, { value: "holidays", label: "Festivos", icon: <Flag className="size-4" /> }, { value: "year", label: "Calendario anual", icon: <CalendarHeart className="size-4" /> }]} />
      {tab === "absences" && <AbsencesTab year={year} />}
      {tab === "holidays" && <HolidaysTab year={year} />}
      {tab === "year" && <YearCalendar year={year} />}
    </div>
  );
}

const emptyAbsence = (date: string, type: AbsenceType = "vacation", status: AbsenceStatus = "approved", jobId: string | null = null): Absence => ({ id: uid(), jobId, type, startDate: date, endDate: date, status, justified: true, paid: true, notes: "", createdAt: Date.now(), updatedAt: Date.now() });

function AbsencesTab({ year }: { year: number }) {
  const d = useCalcData();
  const today = useToday();
  const { toast, confirm } = useFeedback();
  const [edit, setEdit] = useState<Absence | null>(null);
  const [daysJob, setDaysJob] = useState<Job | null>(null);
  const [annual, setAnnual] = useState(0);
  const [countMode, setCountMode] = useState<"working" | "natural">("working");
  const holMap = useMemo(() => new Map(d.holidays.map((h) => [h.date, h])), [d.holidays]);
  if (!d.ready || !d.profile) return <Spinner />;
  // las vacaciones se cuentan por trabajo: cada uno tiene sus días anuales y su calendario
  const scopeJobs = d.jobs.filter((j) => d.jobIds.includes(j.id) && (!j.archived || d.scope === j.id));
  const summaries = scopeJobs.map((job) => ({
    job,
    summary: vacationSummary(d.absences.filter((a) => !a.jobId || a.jobId === job.id), d.contractFor(job.id), d.holidays, job.annualVacationDays, job.vacationCountMode, year, today),
    unit: job.vacationCountMode === "working" ? "días laborables" : "días naturales",
  }));
  const list = d.absences.filter((a) => (!a.jobId || d.jobIds.includes(a.jobId)) && (a.startDate.slice(0, 4) === String(year) || a.endDate.slice(0, 4) === String(year))).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const defaultJobFor = d.scope === "all" ? null : d.scope;

  const setStatus = async (a: Absence, status: AbsenceStatus) => {
    await getDb().absences.put({ ...a, status, updatedAt: nowMs() });
    toast(`Marcada como ${ABSENCE_STATUS[status].toLowerCase()}`);
  };

  return (
    <div className="space-y-4">
      {summaries.map(({ job, summary, unit }) => (
      <Card key={job.id}>
        <CardTitle action={<Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => { setAnnual(job.annualVacationDays); setCountMode(job.vacationCountMode); setDaysJob(job); }}>Configurar</Button>}>
          {d.multi ? <span className="inline-flex items-center gap-2"><JobDot job={job} />Vacaciones {year} · {jobLabel(job)}</span> : `Vacaciones ${year}`}
        </CardTitle>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Stat label="Días anuales" value={String(summary.annual)} hint={unit} />
          <Stat label="Disfrutados" value={String(summary.used)} />
          <Stat label="Programados" value={String(summary.scheduled)} hint="Aprobados" />
          <Stat label="Solicitados" value={String(summary.requested)} hint="Pendientes" />
          <Stat label="Disponibles" value={String(summary.available)} tone={summary.available < 0 ? "danger" : "accent"} />
        </div>
        {summary.annual === 0 && <p className="mt-3 text-sm text-fg-3">Indica cuántos días de vacaciones te corresponden al año para calcular los disponibles.</p>}
      </Card>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(emptyAbsence(today, "vacation", "requested", defaultJobFor))}>Solicitar vacaciones</Button>
        <Button icon={<Plus className="size-4" />} onClick={() => setEdit(emptyAbsence(today, "absence", "approved", defaultJobFor))}>Registrar ausencia o baja</Button>
      </div>
      {list.length === 0 ? <EmptyState icon={<Palmtree className="size-8" />} title={`Sin registros en ${year}`} /> : (
        <div className="space-y-2">
          {list.map((a) => {
            const aJob = a.jobId ? d.jobMap.get(a.jobId) : summaries[0]?.job;
            const aMode = aJob?.vacationCountMode ?? "working";
            const unit = aMode === "working" ? "días laborables" : "días naturales";
            const n = a.type === "vacation" ? vacationDaysIn(a, aJob ? d.contractFor(aJob.id) : null, holMap, aMode) : diffDays(a.startDate, a.endDate) + 1;
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{ABSENCE_LABELS[a.type]}</span>
                    <Badge tone={STATUS_TONE[a.status]}>{ABSENCE_STATUS[a.status]}</Badge>
                    {a.type !== "vacation" && <Badge tone={a.justified ? "ok" : "danger"}>{a.justified ? "Justificada" : "No justificada"}</Badge>}
                    {!a.paid && <Badge>No retribuida</Badge>}
                  </div>
                  {d.multi && (a.jobId ? <JobTag job={d.jobMap.get(a.jobId)} /> : <span className="text-xs text-fg-3">Todos los trabajos</span>)}
                  <p className="text-sm text-fg-2 tabular">{fmtDate(a.startDate)}{a.endDate !== a.startDate && ` – ${fmtDate(a.endDate)}`} · {n} {a.type === "vacation" ? unit : "días naturales"}</p>
                  {a.notes && <p className="text-xs text-fg-3">{a.notes}</p>}
                </div>
                <div className="flex items-center">
                  {a.status === "requested" && <>
                    <IconButton label="Aprobar" className="text-ok" onClick={() => setStatus(a, "approved")}><Check className="size-4" /></IconButton>
                    <IconButton label="Rechazar" className="text-danger" onClick={() => setStatus(a, "rejected")}><X className="size-4" /></IconButton>
                  </>}
                  {a.status === "approved" && a.type === "vacation" && a.startDate <= today && <Button size="sm" variant="ghost" onClick={() => setStatus(a, "taken")}>Disfrutada</Button>}
                  <IconButton label="Editar" onClick={() => setEdit(a)}><Pencil className="size-4" /></IconButton>
                  <IconButton label="Eliminar" onClick={async () => { if (await confirm({ title: "Eliminar", message: "¿Eliminar este registro?", danger: true, confirmLabel: "Eliminar" })) { await getDb().absences.delete(a.id); toast("Eliminado"); } }}><Trash2 className="size-4" /></IconButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
      <AbsenceEditor value={edit} onClose={() => setEdit(null)} />
      <Modal open={!!daysJob} onClose={() => setDaysJob(null)} title={d.multi && daysJob ? `Días de vacaciones · ${jobLabel(daysJob)}` : "Días de vacaciones"} size="sm" footer={<Button variant="primary" onClick={async () => { if (daysJob) await getDb().jobs.update(daysJob.id, { annualVacationDays: annual, vacationCountMode: countMode, updatedAt: nowMs() }); setDaysJob(null); toast("Guardado"); }}>Guardar</Button>}>
        <div className="space-y-4">
          <NumberField label="Días de vacaciones al año" integer min={0} max={366} value={annual} onChange={setAnnual} />
          <LabeledSelect label="Cómo se cuentan" value={countMode} onChange={(e) => setCountMode(e.target.value as "working" | "natural")}>
            <option value="working">Días laborables (excluye descansos y festivos)</option>
            <option value="natural">Días naturales</option>
          </LabeledSelect>
        </div>
      </Modal>
    </div>
  );
}

function AbsenceEditor({ value, onClose }: { value: Absence | null; onClose: () => void }) {
  const { toast } = useFeedback();
  const { jobs } = useCalcData();
  const [a, setA] = useState<Absence | null>(value);
  const [prev, setPrev] = useState<Absence | null>(value);
  if (value !== prev) { setPrev(value); setA(value); }
  if (!a) return null;
  const invalid = a.endDate < a.startDate;
  return (
    <Modal open={!!value} onClose={onClose} title={a.type === "vacation" ? "Vacaciones" : "Ausencia"} footer={<Button variant="primary" disabled={invalid} onClick={async () => { await getDb().absences.put({ ...a, updatedAt: Date.now() }); toast("Guardado"); onClose(); }}>Guardar</Button>}>
      <div className="space-y-4">
        <JobSelect value={a.jobId} onChange={(v) => setA({ ...a, jobId: v })} jobs={jobs} allowAll label="Afecta a" />
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledSelect label="Tipo" value={a.type} onChange={(e) => setA({ ...a, type: e.target.value as AbsenceType })}>
            {Object.entries(ABSENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </LabeledSelect>
          <LabeledSelect label="Estado" value={a.status} onChange={(e) => setA({ ...a, status: e.target.value as AbsenceStatus })}>
            {Object.entries(ABSENCE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </LabeledSelect>
          <LabeledInput label="Desde" type="date" value={a.startDate} onChange={(e) => e.target.value && setA({ ...a, startDate: e.target.value, endDate: a.endDate < e.target.value ? e.target.value : a.endDate })} />
          <LabeledInput label="Hasta" type="date" min={a.startDate} value={a.endDate} onChange={(e) => e.target.value && setA({ ...a, endDate: e.target.value })} />
        </div>
        {a.type !== "vacation" && <Toggle label="Justificada" description="Las ausencias justificadas no cuentan como horas pendientes." checked={a.justified} onChange={(v) => setA({ ...a, justified: v })} />}
        <Toggle label="Retribuida" checked={a.paid} onChange={(v) => setA({ ...a, paid: v })} />
        <Field label="Observaciones"><Textarea rows={2} value={a.notes} onChange={(e) => setA({ ...a, notes: e.target.value })} /></Field>
        {invalid && <Callout tone="danger">La fecha final es anterior a la inicial.</Callout>}
        <p className="text-xs text-fg-3">Las solicitudes son solo locales: sirven para planificar y no se envían a nadie.</p>
      </div>
    </Modal>
  );
}

function HolidaysTab({ year }: { year: number }) {
  const d = useCalcData();
  const { toast, confirm } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const [edit, setEdit] = useState<Holiday | null>(null);
  const [importScope, setImportScope] = useState<HolidayScope>("local");
  if (!d.ready) return <Spinner />;
  const list = d.holidays.filter((h) => h.date.startsWith(String(year)));

  const addMany = async (items: Omit<Holiday, "id">[]) => {
    const db = getDb();
    const existing = new Set((await db.holidays.toArray()).map((h) => `${h.date}|${h.name.toLowerCase()}`));
    const fresh = items.filter((h) => !existing.has(`${h.date}|${h.name.toLowerCase()}`)).map((h) => ({ ...h, id: uid() }));
    if (fresh.length) await db.holidays.bulkPut(fresh);
    return { added: fresh.length, skipped: items.length - fresh.length };
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ id: uid(), date: `${year}-01-01`, name: "", scope: "local" })}>Añadir festivo</Button>
        {d.profile?.country === "España" && (
          <Button icon={<Flag className="size-4" />} onClick={async () => { const r = await addMany(spainNationalHolidays(year).map((h) => ({ ...h, scope: "national" as const }))); toast(`${r.added} festivos añadidos${r.skipped ? `, ${r.skipped} ya existían` : ""}`); }}>Festivos nacionales {year}</Button>
        )}
        <Button icon={<Upload className="size-4" />} onClick={() => fileRef.current?.click()}>Importar archivo</Button>
        <Button variant="ghost" icon={<Download className="size-4" />} disabled={!d.holidays.length} onClick={() => downloadBlob(new Blob([holidaysToCsv(d.holidays)], { type: "text/csv;charset=utf-8" }), "festivos.csv")}>Exportar CSV</Button>
        <input ref={fileRef} type="file" accept=".csv,.txt,.json,text/csv,application/json" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const parsed = parseHolidayFile(await f.text(), importScope);
          if (!parsed.items.length) { toast(parsed.errors[0] ?? "No se encontraron festivos", "error"); return; }
          const r = await addMany(parsed.items);
          toast(`${r.added} festivos importados${r.skipped ? `, ${r.skipped} duplicados` : ""}${parsed.errors.length ? `, ${parsed.errors.length} líneas con errores` : ""}`);
        }} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-2">
        <span>Ámbito por defecto al importar:</span>
        <select aria-label="Ámbito por defecto" value={importScope} onChange={(e) => setImportScope(e.target.value as HolidayScope)} className="h-9 rounded-lg border border-line bg-surface px-2">
          {Object.entries(SCOPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <Callout>
        Formato de importación: CSV con <code>fecha;nombre;ámbito</code> (fecha DD/MM/AAAA o AAAA-MM-DD; ámbito nacional, autonómico o local) o JSON <code>[{"{"}&quot;date&quot;,&quot;name&quot;,&quot;scope&quot;{"}"}]</code>. Los festivos nacionales se calculan en el dispositivo: verifica siempre el calendario oficial de tu comunidad y municipio.
      </Callout>
      {list.length === 0 ? <EmptyState icon={<Flag className="size-8" />} title={`Sin festivos en ${year}`} /> : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <ul className="divide-y divide-line">
            {list.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className="w-24 text-sm tabular text-fg-2">{fmtDate(h.date)}</span>
                <span className="flex-1 text-sm font-medium">{h.name}</span>
                <Badge tone={h.scope === "national" ? "danger" : h.scope === "regional" ? "warn" : "accent"}>{SCOPE_LABELS[h.scope]}</Badge>
                <IconButton label="Editar" onClick={() => setEdit(h)}><Pencil className="size-4" /></IconButton>
                <IconButton label="Eliminar" onClick={async () => { if (await confirm({ title: "Eliminar festivo", message: `¿Eliminar «${h.name}»?`, danger: true, confirmLabel: "Eliminar" })) await getDb().holidays.delete(h.id); }}><Trash2 className="size-4" /></IconButton>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Festivo" size="sm" footer={<Button variant="primary" disabled={!edit?.name.trim()} onClick={async () => { if (edit) { await getDb().holidays.put({ ...edit, name: edit.name.trim() }); toast("Festivo guardado"); setEdit(null); } }}>Guardar</Button>}>
        {edit && (
          <div className="space-y-3">
            <LabeledInput label="Fecha" type="date" value={edit.date} onChange={(e) => e.target.value && setEdit({ ...edit, date: e.target.value })} />
            <LabeledInput label="Nombre" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <LabeledSelect label="Ámbito" value={edit.scope} onChange={(e) => setEdit({ ...edit, scope: e.target.value as HolidayScope })}>
              {Object.entries(SCOPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </LabeledSelect>
          </div>
        )}
      </Modal>
    </div>
  );
}

function YearCalendar({ year }: { year: number }) {
  const d = useCalcData();
  const today = useToday();
  const info = useMemo(() => {
    if (!d.ready) return null;
    const worked = analyzeJobs(d, d.jobIds, `${year}-01-01`, `${year}-12-31`, "worked");
    const planned = analyzeJobs(d, d.jobIds, `${year}-01-01`, `${year}-12-31`, "planned");
    const hol = new Set(d.holidays.map((h) => h.date));
    const abs = new Map<string, Absence>();
    for (const a of d.absences) if (a.status !== "rejected" && (!a.jobId || d.jobIds.includes(a.jobId))) for (const x of dateRange(a.startDate, a.endDate)) if (x.startsWith(String(year)) && !abs.has(x)) abs.set(x, a);
    return { worked, planned, hol, abs };
  }, [d, year]);
  if (!info) return <Spinner />;
  const color = (x: string) => {
    const a = info.abs.get(x);
    if (info.hol.has(x)) return "bg-danger-soft text-danger font-semibold";
    if (a?.type === "vacation") return a.status === "requested" ? "bg-s3/10 text-fg ring-1 ring-inset ring-s3/50" : "bg-s3/25 text-fg font-semibold";
    if (a?.type === "sick") return "bg-warn-soft text-warn font-semibold";
    if (a) return "bg-surface-2 text-fg-2 font-semibold";
    if (info.worked.byDay[x]?.paid) return "bg-ok-soft text-ok";
    if (info.planned.byDay[x]?.paid) return "bg-accent-soft text-accent";
    return "text-fg-3";
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {MONTH_NAMES.map((name, m) => {
          const ym = `${year}-${String(m + 1).padStart(2, "0")}`;
          const days = dateRange(startOfWeek(`${ym}-01`), addDays(startOfWeek(endOfMonth(ym)), 6));
          return (
            <Card key={name} className="!p-3">
              <h3 className="mb-2 text-sm font-semibold">{name}</h3>
              <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
                {"LMXJVSD".split("").map((l) => <span key={l} className="py-0.5 text-fg-3">{l}</span>)}
                {days.map((x) => x.slice(0, 7) !== ym ? <span key={x} /> : (
                  <span key={x} title={`${fmtDate(x)}${info.hol.has(x) ? " · festivo" : ""}${info.abs.get(x) ? ` · ${ABSENCE_LABELS[info.abs.get(x)!.type]}` : ""}`} className={cx("rounded-md py-1 tabular", color(x), x === today && "ring-2 ring-accent", weekdayOf(x) >= 5 && color(x) === "text-fg-3" && "text-fg-3/60")}>{Number(x.slice(8))}</span>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-fg-2">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-ok-soft ring-1 ring-ok/40" />Trabajado</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-accent-soft ring-1 ring-accent/40" />Turno previsto</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-s3/25" />Vacaciones</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-s3/10 ring-1 ring-s3/50" />Vacaciones solicitadas</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-danger-soft" />Festivo</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-warn-soft" />Baja</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-surface-2" />Permiso / ausencia / día libre</span>
      </div>
    </div>
  );
}
