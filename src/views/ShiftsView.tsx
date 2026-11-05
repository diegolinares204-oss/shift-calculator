"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, LayoutTemplate, ListChecks, Plus, Repeat, Search, Trash2, Pencil, CalendarRange } from "lucide-react";
import { Button, Card, CardTitle, EmptyState, Field, IconButton, Input, LabeledInput, LabeledSelect, Modal, PageHeader, Segmented, Spinner, Tabs, WeekdayPicker, useFeedback, Badge, Callout } from "@/components/ui";
import { ShiftEditor } from "@/components/ShiftEditor";
import { ShiftItem } from "@/components/ShiftItem";
import { NumberField } from "@/components/inputs";
import { useCalcData, useShiftsBetween, useTemplates, useToday } from "@/lib/hooks";
import { JobSelect } from "@/components/jobs";
import { addDays, addMonths, endOfMonth, endOfWeek, fmtDate, fmtDateLong, fmtDuration, fmtHours, fmtMonth, startOfWeek, WEEKDAY_NAMES, dateRange, weekdayOf } from "@/lib/time";
import { blockDurations, buildBlock, sortShifts, SHIFT_KIND_LABELS, validateBlock } from "@/lib/shifts";
import { applyTemplate, copyDayTo, createRecurring, duplicateWeek, getDb, templateFromWeek, type BulkResult } from "@/db/repo";
import type { Shift, ShiftKind, ShiftSpec, Template } from "@/lib/types";
import { uid } from "@/lib/id";
import { initialFromHash } from "@/lib/hash";

type Tab = "list" | "tools" | "templates";

export function ShiftsView() {
  const [tab, setTab] = useState<Tab>(() => initialFromHash<Tab>({ plantillas: "templates", herramientas: "tools" }, "list"));
  return (
    <div>
      <PageHeader title="Mis turnos" subtitle="Crea, edita, repite y organiza tus turnos." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "list", label: "Turnos", icon: <ListChecks className="size-4" /> }, { value: "tools", label: "Repetir y copiar", icon: <Repeat className="size-4" /> }, { value: "templates", label: "Plantillas", icon: <LayoutTemplate className="size-4" /> }]} />
      {tab === "list" && <ShiftList />}
      {tab === "tools" && <ShiftTools />}
      {tab === "templates" && <Templates />}
    </div>
  );
}

// ------------------------------------------------------------------ lista

function ShiftList() {
  const today = useToday();
  const { jobIds, primaryJobId } = useCalcData();
  const [mode, setMode] = useState<"week" | "month">("week");
  const [anchor, setAnchor] = useState(today);
  const [status, setStatus] = useState<"all" | Shift["status"]>("all");
  const [q, setQ] = useState("");
  const [editor, setEditor] = useState<{ open: boolean; shift?: Shift | null; date?: string }>({ open: false });
  const from = mode === "week" ? startOfWeek(anchor) : `${anchor.slice(0, 7)}-01`;
  const to = mode === "week" ? endOfWeek(anchor) : endOfMonth(anchor.slice(0, 7));
  const all = useShiftsBetween(from, to);
  const shifts = useMemo(() => all?.filter((s) => jobIds.includes(s.jobId)), [all, jobIds]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return sortShifts((shifts ?? []).filter((s) => (status === "all" || s.status === status) && (!needle || s.notes.toLowerCase().includes(needle) || s.tags.some((t) => t.toLowerCase().includes(needle)) || SHIFT_KIND_LABELS[s.kind].toLowerCase().includes(needle))));
  }, [shifts, status, q]);

  const groups = useMemo(() => {
    const m = new Map<string, Shift[]>();
    for (const s of filtered) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return [...m.entries()];
  }, [filtered]);

  const totals = useMemo(() => {
    let planned = 0, done = 0;
    for (const s of shifts ?? []) {
      if (s.status !== "cancelled") planned += blockDurations(s.planned).paid;
      if (s.status === "done") done += blockDurations(s.actual ?? s.planned).paid;
    }
    return { planned, done };
  }, [shifts]);

  const move = (n: number) => setAnchor(mode === "week" ? addDays(anchor, 7 * n) : `${addMonths(anchor.slice(0, 7), n)}-01`);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented ariaLabel="Periodo" value={mode} onChange={setMode} options={[{ value: "week", label: "Semana" }, { value: "month", label: "Mes" }]} />
        <div className="flex items-center">
          <IconButton label="Anterior" onClick={() => move(-1)}><ChevronLeft className="size-5" /></IconButton>
          <button type="button" className="min-w-40 px-1 text-center text-sm font-semibold" onClick={() => setAnchor(today)} title="Ir a hoy">
            {mode === "week" ? `${fmtDate(from)} – ${fmtDate(to)}` : fmtMonth(from.slice(0, 7))}
          </button>
          <IconButton label="Siguiente" onClick={() => move(1)}><ChevronRight className="size-5" /></IconButton>
        </div>
        <Button variant="primary" className="ml-auto hidden sm:inline-flex" icon={<Plus className="size-4" />} onClick={() => setEditor({ open: true, shift: null, date: today >= from && today <= to ? today : from })}>Nuevo turno</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-3" />
          <Input aria-label="Buscar" placeholder="Buscar por etiqueta, tipo u observación" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
        </div>
        <select aria-label="Filtrar por estado" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="h-11 rounded-xl border border-line bg-surface px-3 text-sm">
          <option value="all">Todos</option>
          <option value="planned">Previstos</option>
          <option value="done">Realizados</option>
          <option value="cancelled">Cancelados</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone="accent">Previstas {fmtHours(totals.planned)}</Badge>
        <Badge tone="ok">Realizadas {fmtHours(totals.done)}</Badge>
        <Badge>{(shifts ?? []).length} turnos</Badge>
      </div>
      {!shifts ? <Spinner /> : groups.length === 0 ? (
        <EmptyState icon={<CalendarRange className="size-8" />} title="No hay turnos en este periodo" text="Añade un turno o usa «Repetir y copiar» para crear varios de una vez." action={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditor({ open: true, shift: null, date: from })}>Nuevo turno</Button>} />
      ) : (
        <div className="space-y-4">
          {groups.map(([date, list]) => (
            <section key={date} aria-label={fmtDateLong(date)}>
              <h3 className="mb-2 flex items-center justify-between text-sm font-semibold text-fg-2">
                <span className={date === today ? "text-accent" : ""}>{fmtDateLong(date)}{date === today && " · Hoy"}</span>
                <span className="font-normal text-fg-3 tabular">{fmtDuration(list.filter((s) => s.status !== "cancelled").reduce((a, s) => a + blockDurations(s.status === "done" && s.actual ? s.actual : s.planned).paid, 0))}</span>
              </h3>
              <div className="space-y-2">{list.map((s) => <ShiftItem key={s.id} shift={s} showDate={false} onEdit={(x) => setEditor({ open: true, shift: x })} />)}</div>
            </section>
          ))}
        </div>
      )}
      <button type="button" aria-label="Nuevo turno" onClick={() => setEditor({ open: true, shift: null, date: today })} className="fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] right-4 z-30 flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-fg shadow-xl sm:hidden">
        <Plus className="size-6" />
      </button>
      <ShiftEditor open={editor.open} shift={editor.shift} defaultDate={editor.date} defaultJobId={primaryJobId} onClose={() => setEditor({ open: false })} />
    </div>
  );
}

// ------------------------------------------------------------------ resultados de operaciones en lote

export function useBulk() {
  const { toast, confirm } = useFeedback();
  return async (op: (allowOverlaps: boolean) => Promise<BulkResult>) => {
    let r = await op(false);
    let created = r.created.length;
    if (r.overlaps.length > 0) {
      const ok = await confirm({
        title: "Turnos solapados",
        message: `${r.overlaps.length} turno(s) se solapan con otros existentes (${[...new Set(r.overlaps)].slice(0, 5).map(fmtDate).join(", ")}${r.overlaps.length > 5 ? "…" : ""}). ¿Quieres crearlos igualmente?`,
        confirmLabel: "Crear también",
        cancelLabel: "No, omitirlos",
      });
      if (ok) {
        r = await op(true);
        created += r.created.length;
      }
    }
    const dup = r.skippedDuplicates.length;
    toast(`${created} turno(s) creados${dup ? ` · ${dup} duplicado(s) omitidos` : ""}`, created ? "ok" : "info");
    return created;
  };
}

// ------------------------------------------------------------------ editor de especificación de turno

const emptySpec = (): ShiftSpec => ({ start: "09:00", end: "17:00", breaks: [], kind: "normal", tags: [] });

function specValid(s: ShiftSpec): string | null {
  if (!s.start || !s.end) return "Indica entrada y salida";
  try {
    const errs = validateBlock(buildBlock({ date: "2026-01-05", start: s.start, end: s.end, breaks: s.breaks.filter((b) => b.start && b.end) })).filter((i) => i.level === "error");
    return errs[0]?.message ?? null;
  } catch {
    return "Horario no válido";
  }
}

function SpecFields({ spec, onChange, compact }: { spec: ShiftSpec; onChange: (s: ShiftSpec) => void; compact?: boolean }) {
  const b = spec.breaks[0];
  let dur = 0;
  try { dur = blockDurations(buildBlock({ date: "2026-01-05", start: spec.start, end: spec.end, breaks: spec.breaks.filter((x) => x.start && x.end) })).paid; } catch { dur = 0; }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <LabeledInput label="Entrada" type="time" value={spec.start} onChange={(e) => onChange({ ...spec, start: e.target.value })} />
        <LabeledInput label="Salida" type="time" value={spec.end} onChange={(e) => onChange({ ...spec, end: e.target.value })} />
        <LabeledInput label="Inicio descanso" type="time" value={b?.start ?? ""} onChange={(e) => onChange({ ...spec, breaks: e.target.value ? [{ start: e.target.value, end: b?.end ?? "", paid: b?.paid ?? false }] : [] })} />
        <LabeledInput label="Fin descanso" type="time" value={b?.end ?? ""} disabled={!b?.start} onChange={(e) => onChange({ ...spec, breaks: b ? [{ ...b, end: e.target.value }] : [] })} />
      </div>
      {!compact && (
        <div className="grid grid-cols-2 gap-2">
          <LabeledSelect label="Tipo" value={spec.kind} onChange={(e) => onChange({ ...spec, kind: e.target.value as ShiftKind })}>
            {Object.entries(SHIFT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </LabeledSelect>
          <label className="mt-7 flex items-center gap-2 text-sm text-fg-2">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" disabled={!b} checked={!!b?.paid} onChange={(e) => b && onChange({ ...spec, breaks: [{ ...b, paid: e.target.checked }] })} />
            Descanso remunerado
          </label>
        </div>
      )}
      <p className="text-xs text-fg-3">{dur > 0 ? `Duración retribuida: ${fmtDuration(dur)}` : ""}{spec.end && spec.start && spec.end <= spec.start ? " · cruza la medianoche" : ""}</p>
    </div>
  );
}

// ------------------------------------------------------------------ herramientas

function ShiftTools() {
  const today = useToday();
  const bulk = useBulk();
  const { jobs, scope, primaryJobId } = useCalcData();
  const [jobId, setJobId] = useState<string | null>(null);
  const targetJob = jobId ?? primaryJobId;
  const scopeJob = scope === "all" ? null : scope;
  const [spec, setSpec] = useState<ShiftSpec>(emptySpec());
  const [rFrom, setRFrom] = useState(today);
  const [rTo, setRTo] = useState(addDays(today, 27));
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [every, setEvery] = useState(1);
  const [busy, setBusy] = useState(false);

  const [srcDay, setSrcDay] = useState(today);
  const [copyFrom, setCopyFrom] = useState(addDays(today, 1));
  const [copyTo, setCopyTo] = useState(addDays(today, 1));
  const [copyDays, setCopyDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);

  const [srcWeek, setSrcWeek] = useState(startOfWeek(today));
  const [dstWeek, setDstWeek] = useState(addDays(startOfWeek(today), 7));
  const [weeks, setWeeks] = useState(1);

  const specErr = specValid(spec);
  const recCount = rTo >= rFrom ? dateRange(rFrom, rTo).length : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardTitle icon={<Repeat className="size-4" />}>Crear turnos recurrentes</CardTitle>
        <div className="space-y-4">
          <JobSelect value={targetJob} onChange={(v) => v && setJobId(v)} jobs={jobs} />
          <SpecFields spec={spec} onChange={setSpec} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <LabeledInput label="Desde" type="date" value={rFrom} onChange={(e) => e.target.value && setRFrom(e.target.value)} />
            <LabeledInput label="Hasta" type="date" value={rTo} min={rFrom} onChange={(e) => e.target.value && setRTo(e.target.value)} />
            <NumberField label="Repetir cada" suffix="sem." integer min={1} max={52} value={every} onChange={(v) => setEvery(v || 1)} />
          </div>
          <Field label="Días de la semana"><WeekdayPicker value={days} onChange={setDays} /></Field>
          {specErr && <Callout tone="danger">{specErr}</Callout>}
          {recCount > 400 && <Callout tone="warn">El periodo es muy largo; acórtalo a menos de 400 días.</Callout>}
          <Button variant="primary" loading={busy} disabled={!!specErr || !days.length || rTo < rFrom || recCount > 400} onClick={async () => { setBusy(true); await bulk((allow) => createRecurring({ jobId: targetJob, spec, from: rFrom, to: rTo, weekdays: days, everyWeeks: every }, { allowOverlaps: allow })); setBusy(false); }}>Crear turnos</Button>
        </div>
      </Card>

      <Card>
        <CardTitle icon={<Copy className="size-4" />}>Copiar los turnos de un día</CardTitle>
        <div className="space-y-3">
          <LabeledInput label="Día de origen" type="date" value={srcDay} onChange={(e) => e.target.value && setSrcDay(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput label="Copiar desde" type="date" value={copyFrom} onChange={(e) => e.target.value && setCopyFrom(e.target.value)} />
            <LabeledInput label="Hasta" type="date" value={copyTo} min={copyFrom} onChange={(e) => e.target.value && setCopyTo(e.target.value)} />
          </div>
          <Field label="Solo estos días"><WeekdayPicker value={copyDays} onChange={setCopyDays} /></Field>
          <Button variant="primary" disabled={copyTo < copyFrom || !copyDays.length} onClick={async () => {
            const targets = dateRange(copyFrom, copyTo).filter((d) => d !== srcDay && copyDays.includes(weekdayOf(d)));
            await bulk((allow) => copyDayTo(srcDay, targets, { allowOverlaps: allow, jobId: scopeJob }));
          }}>Copiar</Button>
        </div>
      </Card>

      <Card>
        <CardTitle icon={<CalendarRange className="size-4" />}>Duplicar una semana</CardTitle>
        <div className="space-y-3">
          <LabeledInput label="Semana de origen (cualquier día)" type="date" value={srcWeek} onChange={(e) => e.target.value && setSrcWeek(startOfWeek(e.target.value))} hint={`Del ${fmtDate(startOfWeek(srcWeek))} al ${fmtDate(endOfWeek(srcWeek))}`} />
          <LabeledInput label="Primera semana de destino" type="date" value={dstWeek} onChange={(e) => e.target.value && setDstWeek(startOfWeek(e.target.value))} hint={`Empieza el ${fmtDate(startOfWeek(dstWeek))}`} />
          <NumberField label="Número de semanas" integer min={1} max={52} value={weeks} onChange={(v) => setWeeks(v || 1)} />
          <Button variant="primary" onClick={() => bulk((allow) => duplicateWeek(srcWeek, dstWeek, weeks, { allowOverlaps: allow, jobId: scopeJob }))}>Duplicar</Button>
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ plantillas

function Templates() {
  const templates = useTemplates();
  const { jobs, scope, primaryJobId } = useCalcData();
  const [applyJob, setApplyJob] = useState<string | null>(null);
  const today = useToday();
  const { toast, confirm } = useFeedback();
  const bulk = useBulk();
  const [edit, setEdit] = useState<Template | null>(null);
  const [apply, setApply] = useState<Template | null>(null);
  const [fromWeek, setFromWeek] = useState(false);
  const [weekDate, setWeekDate] = useState(startOfWeek(today));
  const [weekName, setWeekName] = useState("");
  const [aFrom, setAFrom] = useState(today);
  const [aTo, setATo] = useState(addDays(today, 27));
  const [aDays, setADays] = useState<number[]>([0, 1, 2, 3, 4]);

  const newTemplate = (kind: Template["kind"]): Template => ({ id: uid(), name: "", kind, shift: kind === "shift" ? emptySpec() : undefined, week: kind === "week" ? [[], [], [], [], [], [], []] : undefined, color: "#6366f1", createdAt: Date.now(), updatedAt: Date.now() });

  const editErr = edit ? (!edit.name.trim() ? "Ponle un nombre" : edit.kind === "shift" ? specValid(edit.shift!) : edit.week!.flat().map(specValid).find(Boolean) ?? null) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(newTemplate("shift"))}>Plantilla de turno</Button>
        <Button icon={<Plus className="size-4" />} onClick={() => setEdit(newTemplate("week"))}>Semana tipo</Button>
        <Button icon={<Copy className="size-4" />} onClick={() => { setWeekName(""); setFromWeek(true); }}>Guardar una semana como plantilla</Button>
      </div>
      {!templates ? <Spinner /> : templates.length === 0 ? (
        <EmptyState icon={<LayoutTemplate className="size-8" />} title="Sin plantillas" text="Guarda tus turnos habituales o semanas tipo y aplícalos a cualquier periodo." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((t) => {
            const total = t.kind === "shift" ? 0 : t.week!.flat().length;
            return (
              <Card key={t.id} as="article" className="flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs text-fg-3">{t.kind === "shift" ? `Turno ${t.shift!.start}–${t.shift!.end}` : `Semana tipo · ${total} turno(s)`}</p>
                  </div>
                  <div className="flex">
                    <IconButton label="Editar plantilla" onClick={() => setEdit(structuredClone(t))}><Pencil className="size-4" /></IconButton>
                    <IconButton label="Eliminar plantilla" onClick={async () => { if (await confirm({ title: "Eliminar plantilla", message: `¿Eliminar «${t.name}»? Los turnos ya creados no se borran.`, danger: true, confirmLabel: "Eliminar" })) { await getDb().templates.delete(t.id); toast("Plantilla eliminada"); } }}><Trash2 className="size-4" /></IconButton>
                  </div>
                </div>
                {t.kind === "week" && (
                  <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                    {t.week!.map((d, i) => <div key={i} className={`rounded-lg py-1.5 ${d.length ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-3"}`}>{"LMXJVSD"[i]}<br />{d.length ? d.map((s) => s.start).join(" ") : "–"}</div>)}
                  </div>
                )}
                <Button size="sm" variant="soft" className="mt-auto" onClick={() => setApply(t)}>Aplicar a un periodo</Button>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.kind === "week" ? "Semana tipo" : "Plantilla de turno"} size="lg"
        footer={<Button variant="primary" disabled={!!editErr} onClick={async () => { if (!edit) return; await getDb().templates.put({ ...edit, name: edit.name.trim(), updatedAt: Date.now() }); toast("Plantilla guardada"); setEdit(null); }}>Guardar</Button>}>
        {edit && (
          <div className="space-y-4">
            <LabeledInput label="Nombre" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Ej.: Mañana, Noche, Semana A" />
            {edit.kind === "shift" ? (
              <SpecFields spec={edit.shift!} onChange={(s) => setEdit({ ...edit, shift: s })} />
            ) : (
              <div className="space-y-3">
                {WEEKDAY_NAMES.map((n, i) => (
                  <div key={n} className="rounded-xl border border-line p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold">{n}</span>
                      <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => { const w = edit.week!.map((d) => [...d]); w[i].push(emptySpec()); setEdit({ ...edit, week: w }); }}>Turno</Button>
                    </div>
                    {edit.week![i].length === 0 && <p className="text-xs text-fg-3">Día libre</p>}
                    {edit.week![i].map((s, j) => (
                      <div key={j} className="flex items-start gap-2">
                        <div className="flex-1"><SpecFields compact spec={s} onChange={(ns) => { const w = edit.week!.map((d) => [...d]); w[i][j] = ns; setEdit({ ...edit, week: w }); }} /></div>
                        <IconButton label="Quitar" className="mt-6" onClick={() => { const w = edit.week!.map((d) => [...d]); w[i].splice(j, 1); setEdit({ ...edit, week: w }); }}><Trash2 className="size-4" /></IconButton>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {editErr && <Callout tone="warn">{editErr}</Callout>}
          </div>
        )}
      </Modal>

      <Modal open={!!apply} onClose={() => setApply(null)} title={`Aplicar «${apply?.name ?? ""}»`} size="sm"
        footer={<Button variant="primary" disabled={aTo < aFrom || (apply?.kind === "shift" && !aDays.length)} onClick={async () => { if (!apply) return; const t = apply; setApply(null); await bulk((allow) => applyTemplate(t, aFrom, aTo, aDays, { allowOverlaps: allow, jobId: applyJob ?? primaryJobId })); }}>Aplicar</Button>}>
        <div className="space-y-3">
          <JobSelect value={applyJob ?? primaryJobId} onChange={(v) => v && setApplyJob(v)} jobs={jobs} label="Crear los turnos en" />
          <div className="grid grid-cols-2 gap-3">
            <LabeledInput label="Desde" type="date" value={aFrom} onChange={(e) => e.target.value && setAFrom(e.target.value)} />
            <LabeledInput label="Hasta" type="date" value={aTo} min={aFrom} onChange={(e) => e.target.value && setATo(e.target.value)} />
          </div>
          {apply?.kind === "shift" && <Field label="Días de la semana"><WeekdayPicker value={aDays} onChange={setADays} /></Field>}
          <p className="text-xs text-fg-3">Los turnos idénticos ya existentes no se duplican.</p>
        </div>
      </Modal>

      <Modal open={fromWeek} onClose={() => setFromWeek(false)} title="Guardar semana como plantilla" size="sm"
        footer={<Button variant="primary" disabled={!weekName.trim()} onClick={async () => { const t = await templateFromWeek(weekDate, weekName.trim(), undefined, scope === "all" ? null : scope); setFromWeek(false); toast(`Plantilla «${t.name}» creada`); }}>Guardar</Button>}>
        <div className="space-y-3">
          <LabeledInput label="Nombre" value={weekName} onChange={(e) => setWeekName(e.target.value)} />
          <LabeledInput label="Semana (cualquier día)" type="date" value={weekDate} onChange={(e) => e.target.value && setWeekDate(startOfWeek(e.target.value))} hint={`Del ${fmtDate(startOfWeek(weekDate))} al ${fmtDate(endOfWeek(weekDate))}`} />
        </div>
      </Modal>
    </div>
  );
}
