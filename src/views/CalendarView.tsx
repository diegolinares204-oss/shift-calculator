"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Copy, Plus, MoveRight, LayoutTemplate } from "lucide-react";
import { Button, IconButton, Modal, PageHeader, Segmented, Spinner, useFeedback, cx, Badge, LabeledInput, Card } from "@/components/ui";
import { ShiftEditor } from "@/components/ShiftEditor";
import { ShiftItem } from "@/components/ShiftItem";
import { useCalcData, useToday } from "@/lib/hooks";
import { absenceCounts } from "@/lib/engine";
import { analyzeJobs, jobLabel } from "@/lib/jobs";
import { JobDot } from "@/components/jobs";
import { addDays, addMonths, dateRange, endOfMonth, endOfWeek, fmtDate, fmtDateLong, fmtDayShort, fmtHours, fmtMonth, startOfWeek, WEEKDAY_ABBR, timeOf, weekdayOf } from "@/lib/time";
import { findOverlaps, shiftBlockToDate, sortShifts, blockDurations } from "@/lib/shifts";
import { duplicateWeek, getDb, saveShift, copyDayTo } from "@/db/repo";
import { useBulk } from "./ShiftsView";
import { ABSENCE_LABELS } from "./AbsencesView";
import type { Absence, Holiday, Shift } from "@/lib/types";

type View = "month" | "week" | "agenda";

const ABS_STYLE: Record<Absence["type"], string> = {
  vacation: "bg-s3/15 text-fg border-s3/40",
  dayoff: "bg-surface-2 text-fg-2 border-line",
  permit: "bg-accent-soft text-fg border-accent/30",
  absence: "bg-surface-2 text-fg-2 border-line",
  sick: "bg-warn-soft text-fg border-warn/40",
};

export function CalendarView() {
  const today = useToday();
  const d = useCalcData();
  const bulk = useBulk();
  const { toast, confirm } = useFeedback();
  const [view, setView] = useState<View>("month");
  const [anchor, setAnchor] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ open: boolean; shift?: Shift | null; date?: string }>({ open: false });
  const [dragId, setDragId] = useState<string | null>(null);

  const ym = anchor.slice(0, 7);
  const range = useMemo(() => {
    if (view === "month") return { from: startOfWeek(`${ym}-01`), to: endOfWeek(endOfMonth(ym)) };
    if (view === "week") return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
    return { from: anchor, to: addDays(anchor, 41) };
  }, [view, anchor, ym]);

  const info = useMemo(() => {
    if (!d.ready) return null;
    const base = { shifts: d.shifts, contracts: d.contracts, holidays: d.holidays, absences: d.absences };
    const worked = analyzeJobs(base, d.jobIds, range.from, range.to, "worked");
    const planned = analyzeJobs(base, d.jobIds, range.from, range.to, "planned");
    const byDate = new Map<string, Shift[]>();
    for (const s of d.shifts) if (d.jobIds.includes(s.jobId) && s.date >= range.from && s.date <= range.to) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
    for (const [k, v] of byDate) byDate.set(k, sortShifts(v));
    const hol = new Map<string, Holiday>(d.holidays.map((h) => [h.date, h]));
    const abs = new Map<string, Absence>();
    for (const a of d.absences) {
      if (a.status === "rejected" || (a.jobId && !d.jobIds.includes(a.jobId))) continue;
      const from = a.startDate < range.from ? range.from : a.startDate;
      const to = a.endDate > range.to ? range.to : a.endDate;
      if (from > to) continue;
      for (const x of dateRange(from, to)) if (!abs.has(x)) abs.set(x, a);
    }
    return { worked, planned, byDate, hol, abs };
  }, [d, range]);

  const move = (n: number) => setAnchor(view === "month" ? `${addMonths(ym, n)}-01` : addDays(anchor, n * (view === "week" ? 7 : 42)));
  const title = view === "month" ? fmtMonth(ym) : `${fmtDate(range.from)} – ${fmtDate(range.to)}`;

  const moveShift = async (s: Shift, date: string) => {
    if (s.date === date) return;
    const planned = shiftBlockToDate(s.planned, date);
    const actual = s.actual ? shiftBlockToDate(s.actual, date) : null;
    const near = await getDb().shifts.where("date").between(addDays(date, -2), addDays(date, 2), true, true).toArray();
    const ov = findOverlaps(planned, near.filter((x) => x.jobId === s.jobId), s.id);
    if (ov.length && !(await confirm({ title: "Turno solapado", message: `En el ${fmtDate(date)} ya hay un turno que se solapa. ¿Moverlo igualmente?`, confirmLabel: "Mover" }))) return;
    const prev = s;
    await saveShift({ ...s, date, planned, actual, overlapConfirmed: ov.length > 0 });
    toast(`Turno movido al ${fmtDate(date)}`, "ok", { label: "Deshacer", run: () => void saveShift(prev) });
  };

  const renderDay = (date: string, tall?: boolean) => {
    const shifts = info?.byDate.get(date) ?? [];
    const h = info?.hol.get(date);
    const a = info?.abs.get(date);
    const w = info?.worked.byDay[date]?.paid ?? 0;
    const p = info?.planned.byDay[date]?.paid ?? 0;
    const out = view === "month" && date.slice(0, 7) !== ym;
    return (
      <div
        key={date}
        role="gridcell"
        tabIndex={0}
        aria-label={`${fmtDateLong(date)}${shifts.length ? `, ${shifts.length} turnos` : ""}${h ? `, festivo ${h.name}` : ""}`}
        onClick={() => setSelected(date)}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSelected(date)}
        onDragOver={(e) => { if (dragId) e.preventDefault(); }}
        onDrop={(e) => { e.preventDefault(); const s = d.shifts.find((x) => x.id === dragId); setDragId(null); if (s) void moveShift(s, date); }}
        className={cx("group relative flex cursor-pointer flex-col gap-1 border-b border-r border-line p-1 text-left transition-colors hover:bg-surface-2/60 sm:p-1.5", tall ? "min-h-40" : "min-h-[76px] sm:min-h-24", out && "bg-surface-2/40 text-fg-3", a && !out && "bg-s3/[0.06]")}
      >
        <div className="flex items-center justify-between gap-1">
          <span className={cx("flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular", date === today ? "bg-accent text-accent-fg" : h ? "text-danger" : "")}>{Number(date.slice(8))}</span>
          {(w > 0 || p > 0) && <span className="hidden text-[10px] tabular text-fg-3 sm:inline">{fmtHours(w || p, 1)}</span>}
        </div>
        {h && <span className="truncate rounded bg-danger-soft px-1 text-[10px] font-medium text-danger" title={h.name}>{h.name}</span>}
        {a && <span className={cx("truncate rounded border px-1 text-[10px] font-medium", ABS_STYLE[a.type])}>{ABSENCE_LABELS[a.type]}{a.status === "requested" ? " (sol.)" : ""}</span>}
        {shifts.slice(0, tall ? 6 : 3).map((s) => (
          <span
            key={s.id}
            draggable
            onDragStart={(e) => { setDragId(s.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => setDragId(null)}
            onClick={(e) => { e.stopPropagation(); setEditor({ open: true, shift: s }); }}
            title={`${timeOf(s.planned.start)}–${timeOf(s.planned.end)} (arrastra para mover)`}
            style={d.multi ? { boxShadow: `inset 3px 0 0 ${d.jobMap.get(s.jobId)?.color ?? "transparent"}` } : undefined}
            className={cx("truncate rounded-md px-1 py-0.5 text-[10px] font-medium tabular sm:text-[11px]", s.status === "done" ? "bg-ok-soft text-ok" : s.status === "planned" ? "bg-accent-soft text-accent" : "bg-surface-2 text-fg-3 line-through")}
          >
            {timeOf((s.status === "done" && s.actual) ? s.actual.start : s.planned.start)}<span className="hidden sm:inline">–{timeOf((s.status === "done" && s.actual) ? s.actual.end : s.planned.end)}</span>
          </span>
        ))}
        {shifts.length > (tall ? 6 : 3) && <span className="text-[10px] text-fg-3">+{shifts.length - (tall ? 6 : 3)}</span>}
      </div>
    );
  };

  const days = dateRange(range.from, range.to);

  return (
    <div>
      <PageHeader title="Calendario" actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditor({ open: true, shift: null, date: selected ?? today })}>Turno</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented ariaLabel="Vista" value={view} onChange={setView} options={[{ value: "month", label: "Mes" }, { value: "week", label: "Semana" }, { value: "agenda", label: "Agenda" }]} />
        <div className="flex items-center">
          <IconButton label="Anterior" onClick={() => move(-1)}><ChevronLeft className="size-5" /></IconButton>
          <h2 className="min-w-36 text-center text-sm font-semibold">{title}</h2>
          <IconButton label="Siguiente" onClick={() => move(1)}><ChevronRight className="size-5" /></IconButton>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setAnchor(today)}>Hoy</Button>
        {view === "week" && (
          <Button size="sm" icon={<Copy className="size-4" />} className="ml-auto" onClick={() => bulk((allow) => duplicateWeek(range.from, addDays(range.from, 7), 1, { allowOverlaps: allow, jobId: d.scope === "all" ? null : d.scope }))}>Duplicar en la semana siguiente</Button>
        )}
        <Link href="/turnos/#plantillas" className={cx("inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-fg-2 hover:bg-surface-2", view !== "week" && "ml-auto")}><LayoutTemplate className="size-4" />Aplicar patrón</Link>
      </div>

      {!info ? <Spinner /> : view === "agenda" ? (
        <Agenda days={days} info={info} onDay={setSelected} onEdit={(s) => setEditor({ open: true, shift: s })} />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <div className="grid grid-cols-7 border-b border-line bg-surface-2/50 text-center text-xs font-medium text-fg-3" role="row">
            {(view === "week" ? days : WEEKDAY_ABBR).map((x, i) => <div key={i} role="columnheader" className="py-2">{view === "week" ? <span className="capitalize">{fmtDayShort(x)}</span> : x}</div>)}
          </div>
          <div className="grid grid-cols-7 border-l border-line [&>*:nth-child(7n)]:border-r-0" role="grid" style={{ marginLeft: -1 }}>
            {days.map((date) => renderDay(date, view === "week"))}
          </div>
          {view === "week" && info && (
            <div className="grid grid-cols-7 border-t border-line text-center text-[11px] text-fg-3">
              {days.map((x) => <div key={x} className="py-1.5 tabular">{fmtHours(info.worked.byDay[x]?.paid ?? 0, 1)}</div>)}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-fg-2" aria-label="Leyenda">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-accent-soft ring-1 ring-accent/40" />Previsto</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-ok-soft ring-1 ring-ok/40" />Realizado</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-surface-2 ring-1 ring-line" />Cancelado / día libre</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-danger-soft ring-1 ring-danger/40" />Festivo</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-s3/20 ring-1 ring-s3/40" />Vacaciones</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-warn-soft ring-1 ring-warn/40" />Baja</span>
        {d.multi && d.jobs.filter((j) => d.jobIds.includes(j.id)).map((j) => <span key={j.id} className="inline-flex items-center gap-1.5"><JobDot job={j} />{jobLabel(j)}</span>)}
        <span className="hidden lg:inline">Arrastra un turno a otro día para moverlo.</span>
      </div>

      <DaySheet
        date={selected}
        onClose={() => setSelected(null)}
        shifts={selected ? info?.byDate.get(selected) ?? d.shifts.filter((s) => s.date === selected && d.jobIds.includes(s.jobId)) : []}
        holiday={selected ? d.holidays.find((h) => h.date === selected) : undefined}
        absence={selected ? d.absences.find((a) => a.status !== "rejected" && a.startDate <= selected && a.endDate >= selected) : undefined}
        workedMin={selected ? info?.worked.byDay[selected]?.paid ?? 0 : 0}
        plannedMin={selected ? info?.planned.byDay[selected]?.paid ?? 0 : 0}
        onAdd={(date) => { setSelected(null); setEditor({ open: true, shift: null, date }); }}
        onEdit={(s) => { setSelected(null); setEditor({ open: true, shift: s }); }}
        onMove={moveShift}
        onCopy={async (from, to) => { await bulk((allow) => copyDayTo(from, [to], { allowOverlaps: allow, jobId: d.scope === "all" ? null : d.scope })); }}
      />
      <ShiftEditor open={editor.open} shift={editor.shift} defaultDate={editor.date} defaultJobId={d.primaryJobId} onClose={() => setEditor({ open: false })} />
    </div>
  );
}

function Agenda({ days, info, onDay, onEdit }: { days: string[]; info: { byDate: Map<string, Shift[]>; hol: Map<string, Holiday>; abs: Map<string, Absence> }; onDay: (d: string) => void; onEdit: (s: Shift) => void }) {
  const withEvents = days.filter((x) => info.byDate.get(x)?.length || info.hol.has(x) || info.abs.has(x));
  if (!withEvents.length) return <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-fg-3">Sin eventos en las próximas seis semanas.</p>;
  return (
    <div className="space-y-4">
      {withEvents.map((x) => (
        <section key={x}>
          <button type="button" onClick={() => onDay(x)} className="mb-2 text-sm font-semibold text-fg-2 hover:text-accent">{fmtDateLong(x)}</button>
          <div className="space-y-2">
            {info.hol.get(x) && <Badge tone="danger">Festivo · {info.hol.get(x)!.name}</Badge>}
            {info.abs.get(x) && <Badge tone="ok">{ABSENCE_LABELS[info.abs.get(x)!.type]}</Badge>}
            {(info.byDate.get(x) ?? []).map((s) => <ShiftItem key={s.id} shift={s} showDate={false} onEdit={onEdit} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function DaySheet({ date, onClose, shifts, holiday, absence, workedMin, plannedMin, onAdd, onEdit, onMove, onCopy }: {
  date: string | null; onClose: () => void; shifts: Shift[]; holiday?: Holiday; absence?: Absence; workedMin: number; plannedMin: number;
  onAdd: (d: string) => void; onEdit: (s: Shift) => void; onMove: (s: Shift, d: string) => Promise<void>; onCopy: (from: string, to: string) => Promise<void>;
}) {
  const [moving, setMoving] = useState<Shift | null>(null);
  const [target, setTarget] = useState("");
  const [copyTarget, setCopyTarget] = useState("");
  if (!date) return null;
  const breaks = shifts.filter((s) => s.status !== "cancelled").reduce((a, s) => a + blockDurations(s.planned).breaks, 0);
  return (
    <Modal open={!!date} onClose={() => { setMoving(null); onClose(); }} title={fmtDateLong(date)} footer={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => onAdd(date)}>Añadir turno</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <Card className="!p-3"><p className="text-[11px] text-fg-3">Previstas</p><p className="font-semibold tabular">{fmtHours(plannedMin)}</p></Card>
          <Card className="!p-3"><p className="text-[11px] text-fg-3">Realizadas</p><p className="font-semibold tabular">{fmtHours(workedMin)}</p></Card>
          <Card className="!p-3"><p className="text-[11px] text-fg-3">Descansos</p><p className="font-semibold tabular">{fmtHours(breaks)}</p></Card>
        </div>
        {holiday && <Badge tone="danger">Festivo {holiday.scope === "national" ? "nacional" : holiday.scope === "regional" ? "autonómico" : "local"}: {holiday.name}</Badge>}
        {absence && <div className="text-sm"><Badge tone="ok">{ABSENCE_LABELS[absence.type]}</Badge> <span className="text-fg-3">del {fmtDate(absence.startDate)} al {fmtDate(absence.endDate)}{absenceCounts(absence) ? "" : " · no reduce horas"}</span></div>}
        {shifts.length === 0 ? <p className="text-sm text-fg-3">Día libre: no hay turnos.</p> : (
          <div className="space-y-2">
            {shifts.map((s) => (
              <div key={s.id} className="space-y-2">
                <ShiftItem shift={s} showDate={false} onEdit={onEdit} />
                {moving?.id === s.id ? (
                  <div className="flex items-end gap-2">
                    <LabeledInput label="Mover a" type="date" value={target} onChange={(e) => setTarget(e.target.value)} className="flex-1" />
                    <Button variant="primary" disabled={!target} onClick={async () => { await onMove(s, target); setMoving(null); onClose(); }}>Mover</Button>
                  </div>
                ) : (
                  <Button size="sm" variant="ghost" icon={<MoveRight className="size-4" />} onClick={() => { setMoving(s); setTarget(addDays(date, 1)); }}>Mover a otro día</Button>
                )}
              </div>
            ))}
            <div className="flex items-end gap-2 border-t border-line pt-3">
              <LabeledInput label="Copiar los turnos de este día a" type="date" value={copyTarget} onChange={(e) => setCopyTarget(e.target.value)} className="flex-1" />
              <Button disabled={!copyTarget || copyTarget === date} icon={<Copy className="size-4" />} onClick={async () => { await onCopy(date, copyTarget); setCopyTarget(""); }}>Copiar</Button>
            </div>
          </div>
        )}
        <p className="text-xs text-fg-3">{weekdayOf(date) >= 5 ? "Fin de semana. " : ""}Las horas de turnos que cruzan la medianoche se reparten entre los dos días.</p>
      </div>
    </Modal>
  );
}
