"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button, Callout, Field, IconButton, Input, LabeledInput, LabeledSelect, Segmented, Textarea, Toggle, Modal, useFeedback, cx } from "./ui";
import type { Shift, ShiftKind, ShiftStatus, TimeBlock } from "@/lib/types";
import { SHIFT_KIND_LABELS, blockDurations, buildBlock, findOverlaps, isDuplicate, validateBlock } from "@/lib/shifts";
import { addDays, dateOf, fmtDate, fmtDuration, resolveAfter, timeOf, todayKey } from "@/lib/time";
import { getDb, newShift, saveShift, deleteShift, duplicateShift } from "@/db/repo";
import { useCalcData } from "@/lib/hooks";
import { jobLabel } from "@/lib/jobs";
import { JobSelect } from "./jobs";

interface BreakDraft { start: string; end: string; paid: boolean }
interface BlockDraft { date: string; start: string; end: string; endDate: string | null; breaks: BreakDraft[] }

export function blockToDraft(b: TimeBlock): BlockDraft {
  const date = dateOf(b.start);
  const auto = resolveAfter(b.start, timeOf(b.end));
  return { date, start: timeOf(b.start), end: timeOf(b.end), endDate: auto === b.end ? null : dateOf(b.end), breaks: b.breaks.map((x) => ({ start: timeOf(x.start), end: timeOf(x.end), paid: x.paid })) };
}

function draftToBlock(d: BlockDraft): TimeBlock | null {
  if (!d.date || !d.start || !d.end) return null;
  try {
    return buildBlock({ date: d.date, start: d.start, end: d.end, endDate: d.endDate, breaks: d.breaks.filter((b) => b.start && b.end) });
  } catch {
    return null;
  }
}

function BlockFields({ value, onChange, idPrefix, showDate = true }: { value: BlockDraft; onChange: (v: BlockDraft) => void; idPrefix: string; showDate?: boolean }) {
  const block = draftToBlock(value);
  const crosses = block ? dateOf(block.end) !== value.date : false;
  return (
    <div className="space-y-3">
      <div className={cx("grid gap-3", showDate ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
        {showDate && <LabeledInput className="col-span-2 sm:col-span-1" label="Fecha" type="date" value={value.date} onChange={(e) => e.target.value && onChange({ ...value, date: e.target.value, endDate: value.endDate && e.target.value > value.endDate ? null : value.endDate })} required />}
        <LabeledInput name={`${idPrefix}-start`} label="Entrada" type="time" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} required />
        <LabeledInput name={`${idPrefix}-end`} label="Salida" type="time" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} required />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {crosses && !value.endDate && <span className="rounded-full bg-accent-soft px-2 py-1 font-medium text-accent">Termina el día siguiente ({block && fmtDate(dateOf(block.end))})</span>}
        <label className="flex items-center gap-2 text-fg-2">
          <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={value.endDate !== null} onChange={(e) => onChange({ ...value, endDate: e.target.checked ? (block ? dateOf(block.end) : addDays(value.date, 1)) : null })} />
          Indicar fecha de salida (turnos de más de 24 h o cambios de fecha)
        </label>
      </div>
      {value.endDate !== null && <LabeledInput label="Fecha de salida" type="date" min={value.date} value={value.endDate} onChange={(e) => e.target.value && onChange({ ...value, endDate: e.target.value })} />}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-fg-2">Descansos</span>
          <Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => onChange({ ...value, breaks: [...value.breaks, { start: "", end: "", paid: false }] })}>Añadir descanso</Button>
        </div>
        {value.breaks.length === 0 && <p className="text-xs text-fg-3">Sin descansos.</p>}
        <div className="space-y-2">
          {value.breaks.map((b, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 rounded-xl bg-surface-2/60 p-2">
              <Field label="Inicio" className="w-[calc(50%-1.5rem)] sm:w-32"><Input type="time" aria-label={`Inicio descanso ${i + 1}`} value={b.start} onChange={(e) => { const br = [...value.breaks]; br[i] = { ...b, start: e.target.value }; onChange({ ...value, breaks: br }); }} /></Field>
              <Field label="Fin" className="w-[calc(50%-1.5rem)] sm:w-32"><Input type="time" aria-label={`Fin descanso ${i + 1}`} value={b.end} onChange={(e) => { const br = [...value.breaks]; br[i] = { ...b, end: e.target.value }; onChange({ ...value, breaks: br }); }} /></Field>
              <label className="flex h-11 items-center gap-2 text-sm text-fg-2">
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={b.paid} onChange={(e) => { const br = [...value.breaks]; br[i] = { ...b, paid: e.target.checked }; onChange({ ...value, breaks: br }); }} />
                Remunerado
              </label>
              <IconButton label="Quitar descanso" className="ml-auto" onClick={() => onChange({ ...value, breaks: value.breaks.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></IconButton>
            </div>
          ))}
        </div>
      </div>
      {block && <DurationSummary block={block} />}
    </div>
  );
}

function DurationSummary({ block }: { block: TimeBlock }) {
  const d = blockDurations(block);
  if (d.gross <= 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 rounded-xl border border-line p-3 text-center">
      <div><div className="text-[11px] text-fg-3">Bruto</div><div className="text-sm font-semibold tabular">{fmtDuration(d.gross)}</div></div>
      <div><div className="text-[11px] text-fg-3">Descansos</div><div className="text-sm font-semibold tabular">{fmtDuration(d.breaks)}</div></div>
      <div><div className="text-[11px] text-fg-3">Retribuido</div><div className="text-sm font-semibold tabular text-accent">{fmtDuration(d.paid)}</div></div>
    </div>
  );
}

const emptyDraft = (date: string): BlockDraft => ({ date, start: "09:00", end: "17:00", endDate: null, breaks: [] });

type EditorProps = { open: boolean; onClose: () => void; shift?: Shift | null; defaultDate?: string; defaultStatus?: ShiftStatus; defaultJobId?: string };

/** El formulario se monta de nuevo cada vez que se abre, con el estado inicial del turno. */
export function ShiftEditor(props: EditorProps) {
  if (!props.open) return null;
  return <ShiftEditorForm {...props} />;
}

function ShiftEditorForm({ open, onClose, shift, defaultDate, defaultStatus = "planned", defaultJobId }: EditorProps) {
  const { toast, confirm } = useFeedback();
  const { jobs, jobMap, primaryJobId } = useCalcData();
  const [jobId, setJobId] = useState<string>(shift?.jobId ?? defaultJobId ?? primaryJobId);
  const initDate = defaultDate ?? todayKey();
  const [planned, setPlanned] = useState<BlockDraft>(() => (shift ? blockToDraft(shift.planned) : emptyDraft(initDate)));
  const [hasActual, setHasActual] = useState(!!shift?.actual);
  const [actual, setActual] = useState<BlockDraft>(() => (shift ? blockToDraft(shift.actual ?? shift.planned) : emptyDraft(initDate)));
  const [kind, setKind] = useState<ShiftKind>(shift?.kind ?? "normal");
  const [status, setStatus] = useState<ShiftStatus>(shift?.status ?? defaultStatus);
  const [notes, setNotes] = useState(shift?.notes ?? "");
  const [tags, setTags] = useState(shift?.tags.join(", ") ?? "");
  const [overlapOk, setOverlapOk] = useState(!!shift?.overlapConfirmed);
  const [longOk, setLongOk] = useState(false);
  const [others, setOthers] = useState<Shift[]>([]);
  const [saving, setSaving] = useState(false);

  const plannedBlock = useMemo(() => draftToBlock(planned), [planned]);
  const actualBlock = useMemo(() => (hasActual ? draftToBlock({ ...actual, date: actual.date || planned.date }) : null), [hasActual, actual, planned.date]);

  useEffect(() => {
    if (!open || !planned.date) return;
    let alive = true;
    getDb().shifts.where("date").between(addDays(planned.date, -2), addDays(planned.date, 2), true, true).toArray().then((l) => alive && setOthers(l));
    return () => { alive = false; };
  }, [open, planned.date]);

  const issues = useMemo(() => [...(plannedBlock ? validateBlock(plannedBlock) : []), ...(actualBlock ? validateBlock(actualBlock).map((i) => ({ ...i, message: `Horario real: ${i.message}` })) : [])], [plannedBlock, actualBlock]);
  const errors = issues.filter((i) => i.level === "error");
  const needsLongOk = issues.some((i) => i.code === "over-24h");
  const effectiveJob = jobId || primaryJobId;
  const sameJob = others.filter((o) => o.jobId === effectiveJob);
  const overlaps = plannedBlock && status !== "cancelled" ? findOverlaps(plannedBlock, sameJob, shift?.id) : [];
  // coincidencias con turnos de otros trabajos: solo informativo
  const otherJobOverlaps = plannedBlock && status !== "cancelled" ? findOverlaps(plannedBlock, others.filter((o) => o.jobId !== effectiveJob), shift?.id) : [];
  const duplicate = plannedBlock ? isDuplicate(plannedBlock, sameJob, shift?.id) : false;
  const canSave = !!plannedBlock && errors.length === 0 && (!needsLongOk || longOk) && (overlaps.length === 0 || overlapOk) && !duplicate;

  const save = async () => {
    if (!plannedBlock || !canSave) return;
    setSaving(true);
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const base = shift ?? newShift(effectiveJob, planned.date, plannedBlock);
    const next: Shift = { ...base, jobId: effectiveJob, planned: plannedBlock, actual: status === "done" && hasActual ? actualBlock : null, kind, status, notes, tags: tagList, overlapConfirmed: overlaps.length > 0 };
    await saveShift(next);
    setSaving(false);
    toast(shift ? "Turno actualizado" : "Turno creado");
    onClose();
  };

  const remove = async () => {
    if (!shift) return;
    if (!(await confirm({ title: "Eliminar turno", message: `¿Eliminar el turno del ${fmtDate(shift.date)}?`, confirmLabel: "Eliminar", danger: true }))) return;
    const copy = shift;
    await deleteShift(shift.id);
    onClose();
    toast("Turno eliminado", "ok", { label: "Deshacer", run: () => void getDb().shifts.put(copy) });
  };

  const duplicateTo = async () => {
    if (!shift) return;
    const target = addDays(shift.date, 1);
    const c = await duplicateShift(shift.id, target);
    if (c) toast(`Duplicado al ${fmtDate(target)}`);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={shift ? "Editar turno" : "Nuevo turno"}
      size="lg"
      footer={
        <>
          {shift && <Button variant="ghost" className="mr-auto text-danger" icon={<Trash2 className="size-4" />} onClick={remove}>Eliminar</Button>}
          {shift && <Button variant="ghost" icon={<Copy className="size-4" />} onClick={duplicateTo}>Duplicar al día siguiente</Button>}
          <Button variant="primary" onClick={save} disabled={!canSave} loading={saving}>Guardar</Button>
        </>
      }
    >
      <div className="space-y-5">
        <JobSelect value={effectiveJob} onChange={(v) => v && setJobId(v)} jobs={jobs} />
        <Field label="Estado">
          <Segmented ariaLabel="Estado del turno" value={status} onChange={setStatus} options={[{ value: "planned", label: "Previsto" }, { value: "done", label: "Realizado" }, { value: "cancelled", label: "Cancelado" }]} />
        </Field>
        <BlockFields value={planned} onChange={setPlanned} idPrefix="planned" />
        {status === "done" && (
          <div className="rounded-2xl border border-line p-3">
            <Toggle label="El horario real fue distinto al previsto" description="Registra la entrada, salida y descansos reales. Las horas realizadas usarán este horario." checked={hasActual} onChange={(v) => { setHasActual(v); if (v && !shift?.actual) setActual({ ...planned }); }} />
            {hasActual && (
              <div className="mt-3">
                <BlockFields value={{ ...actual, date: actual.date || planned.date }} onChange={setActual} idPrefix="actual" />
                {plannedBlock && actualBlock && (
                  <p className="mt-2 text-sm text-fg-2">
                    Diferencia respecto a lo previsto: <strong className="tabular">{fmtDuration(blockDurations(actualBlock).paid - blockDurations(plannedBlock).paid)}</strong>
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledSelect label="Tipo de jornada" value={kind} onChange={(e) => setKind(e.target.value as ShiftKind)}>
            {Object.entries(SHIFT_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </LabeledSelect>
          <LabeledInput label="Etiquetas (separadas por comas)" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Ej.: tienda centro, cobertura" />
        </div>
        <Field label="Observaciones"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>

        {errors.map((e) => <Callout key={e.code + e.message} tone="danger">{e.message}</Callout>)}
        {needsLongOk && (
          <Callout tone="warn" title="Turno de más de 24 horas">
            <label className="mt-1 flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={longOk} onChange={(e) => setLongOk(e.target.checked)} />Confirmo que la duración es correcta</label>
          </Callout>
        )}
        {issues.filter((i) => i.code === "long").map((i) => <Callout key="long" tone="warn">{i.message}</Callout>)}
        {duplicate && <Callout tone="danger">Ya existe un turno con exactamente el mismo horario.</Callout>}
        {otherJobOverlaps.length > 0 && (
          <Callout tone="info" title="Coincide con un turno de otro trabajo">
            {otherJobOverlaps.map((o) => <div key={o.id}>{jobLabel(jobMap.get(o.jobId))}: {timeOf(o.planned.start)}–{timeOf(o.planned.end)}</div>)}
          </Callout>
        )}
        {overlaps.length > 0 && !duplicate && (
          <Callout tone="warn" title="Se solapa con otro turno">
            {overlaps.map((o) => <div key={o.id}>{fmtDate(o.date)} {timeOf(o.planned.start)}–{timeOf(o.planned.end)}</div>)}
            <label className="mt-2 flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={overlapOk} onChange={(e) => setOverlapOk(e.target.checked)} />Es correcto, guardar igualmente (los minutos comunes solo se cuentan una vez)</label>
          </Callout>
        )}
      </div>
    </Modal>
  );
}

