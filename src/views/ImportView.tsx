"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, CheckCircle2, ImagePlus, Loader2, Plus, ScanLine, Trash2, AlertTriangle, Moon } from "lucide-react";
import { Badge, Button, Callout, Card, CardTitle, Field, IconButton, Input, LabeledInput, PageHeader, Select, useFeedback, cx } from "@/components/ui";
import { JobSelect, JobTag } from "@/components/jobs";
import { useCalcData, useToday } from "@/lib/hooks";
import { recognizeImage, type OcrProgress } from "@/lib/ocr";
import { parseRoster, durationMinutes, type RosterParse } from "@/lib/roster";
import { planImport, rowBlock, rowsToEditable, type EditableRow, type ImportAction, type ImportItem } from "@/lib/rosterImport";
import { applyRosterImport } from "@/db/repo";
import { fmtDate, fmtDayShort, fmtDuration, timeOf } from "@/lib/time";
import { uid } from "@/lib/id";

const STATUS_TEXT: Record<string, string> = {
  "loading tesseract core": "Cargando el motor de reconocimiento",
  "initializing tesseract": "Preparando el reconocimiento",
  "loading language traineddata": "Cargando el idioma español",
  "initializing api": "Preparando el reconocimiento",
  "recognizing text": "Leyendo el cuadrante",
};

const STATUS_BADGE: Record<ImportItem["status"], { tone: "ok" | "neutral" | "warn" | "danger" | "accent"; text: string }> = {
  new: { tone: "ok", text: "Nuevo" },
  exists: { tone: "neutral", text: "Ya está en tu calendario" },
  changed: { tone: "warn", text: "Cambia respecto a tu calendario" },
  done: { tone: "accent", text: "Ya tienes un turno realizado ese día" },
  invalid: { tone: "danger", text: "Incompleto" },
};

export function ImportView() {
  const d = useCalcData();
  const today = useToday();
  const { toast, confirm } = useFeedback();
  const [jobSel, setJobSel] = useState<string | null>(null);
  const jobId = jobSel && d.jobMap.has(jobSel) ? jobSel : d.primaryJobId;
  const [reference, setReference] = useState(today);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [parsed, setParsed] = useState<RosterParse | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [dayOff, setDayOff] = useState<string[]>([]);
  const [actions, setActions] = useState<Record<string, ImportAction>>({});
  const [freedSel, setFreedSel] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ created: number; removed: number; duplicates: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const previewRef = useRef<string | null>(null);
  useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast("El archivo no es una imagen", "error"); return; }
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = URL.createObjectURL(f);
    setPreview(previewRef.current);
    setFile(f); setParsed(null); setRows([]); setDone(null); setError(null); setActions({}); setFreedSel({});
  };

  const analyze = async () => {
    if (!file) return;
    setBusy(true); setError(null); setParsed(null); setDone(null);
    try {
      const ocr = await recognizeImage(file, setProgress);
      const res = parseRoster(ocr, { reference });
      setParsed(res);
      setRows(rowsToEditable(res.rows));
      setDayOff(res.rows.filter((r) => r.dayOff && r.date).map((r) => r.date!));
      setActions({});
      setFreedSel({});
      if (!res.rows.length) setError("No se han reconocido días en la imagen. Prueba con una captura más nítida, sin recortar el encabezado de los días, o añade los turnos manualmente abajo.");
    } catch (e) {
      setError(`No se ha podido analizar la imagen: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const plan = useMemo(() => planImport(rows, dayOff, d.shifts, jobId), [rows, dayOff, d.shifts, jobId]);
  const actionOf = (it: ImportItem): ImportAction => {
    const a = actions[it.key] ?? it.action;
    if (it.status === "invalid" || it.status === "exists") return "skip";
    if (a === "replace" && it.status !== "changed") return it.status === "new" ? "add" : "skip";
    return a;
  };
  const counts = useMemo(() => {
    const c = { add: 0, replace: 0, skip: 0, doubtful: 0, changed: 0, exists: 0, invalid: 0 };
    for (const it of plan.items) {
      c[actionOf(it)]++;
      if (it.doubtful) c.doubtful++;
      if (it.status === "changed") c.changed++;
      if (it.status === "exists") c.exists++;
      if (it.status === "invalid") c.invalid++;
    }
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, actions]);

  const setRow = (key: string, patch: Partial<EditableRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch, issues: patch.date || patch.start || patch.end ? r.issues.filter((i) => !/fecha|horario|hora sin pareja/i.test(i)) : r.issues } : r)));

  const doImport = async () => {
    const chosen = plan.items.filter((it) => actionOf(it) !== "skip");
    const create = chosen.map((it) => ({ date: it.date, block: rowBlock(it)! })).filter((x) => x.block);
    const removeIds = [
      ...chosen.filter((it) => actionOf(it) === "replace").flatMap((it) => it.existing.filter((e) => e.status === "planned").map((e) => e.id)),
      ...plan.freedDays.filter((f) => freedSel[f.date]).flatMap((f) => f.shifts.map((s) => s.id)),
    ];
    if (!create.length && !removeIds.length) { toast("No hay nada seleccionado para importar", "info"); return; }
    const doubtful = chosen.filter((it) => it.doubtful).length;
    if (!(await confirm({
      title: "Confirmar importación",
      message: (
        <div className="space-y-1">
          <p>Se añadirán <b>{create.length}</b> turnos al trabajo <b>{d.jobMap.get(jobId)?.name}</b>{removeIds.length ? <> y se eliminarán <b>{removeIds.length}</b> turnos previstos que has elegido sustituir o quitar</> : null}.</p>
          {doubtful > 0 && <p className="text-warn">{doubtful} de ellos venían de lecturas dudosas: comprueba que los has revisado.</p>}
        </div>
      ),
      confirmLabel: "Importar",
    }))) return;
    setBusy(true);
    try {
      let res = await applyRosterImport({ jobId, create, removeIds, allowOverlaps: false });
      let created = res.created.length;
      if (res.overlaps.length) {
        const ok = await confirm({ title: "Turnos que se solapan", message: `${res.overlaps.length} turno(s) se solapan con otros de este trabajo (${[...new Set(res.overlaps)].map(fmtDate).join(", ")}). ¿Añadirlos igualmente?`, confirmLabel: "Añadir también", cancelLabel: "No, omitirlos" });
        if (ok) {
          res = { ...(await applyRosterImport({ jobId, create, removeIds: [], allowOverlaps: true })), removed: res.removed };
          created += res.created.length;
        }
      }
      setDone({ created, removed: res.removed, duplicates: res.skippedDuplicates.length });
      toast(`${created} turno(s) importados`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Importar cuadrante" subtitle="Sube una captura de tu horario (optimizado para Orquest). Se analiza en tu dispositivo: la imagen no se envía a ningún sitio." />

      <Card>
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-4">
            <JobSelect value={jobId} onChange={(v) => v && setJobSel(v)} jobs={d.jobs} label="¿De qué trabajo es este cuadrante?" alwaysShow={d.multi} />
            <LabeledInput label="Semana o mes del cuadrante (cualquier día)" type="date" value={reference} onChange={(e) => e.target.value && setReference(e.target.value)} hint="Se usa para completar el mes y el año si la captura solo muestra el día." />
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
              className={cx("rounded-2xl border-2 border-dashed p-5 text-center transition-colors", dragOver ? "border-accent bg-accent-soft" : "border-line")}
            >
              <ScanLine className="mx-auto mb-2 size-8 text-fg-3" />
              <p className="text-sm text-fg-2">Arrastra aquí la captura o elige una opción</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button variant="primary" icon={<ImagePlus className="size-4" />} onClick={() => galleryRef.current?.click()}>Elegir imagen</Button>
                <Button icon={<Camera className="size-4" />} onClick={() => cameraRef.current?.click()}>Hacer foto</Button>
              </div>
              <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
            {file && (
              <Button variant="primary" size="lg" className="w-full" loading={busy && !parsed} icon={<ScanLine className="size-5" />} onClick={analyze} disabled={busy}>
                {parsed ? "Volver a analizar" : "Analizar cuadrante"}
              </Button>
            )}
            {busy && progress && (
              <div role="status" className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm text-fg-2"><Loader2 className="size-4 animate-spin" />{STATUS_TEXT[progress.status] ?? "Analizando"}…</div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${Math.round((progress.progress || 0) * 100)}%` }} /></div>
                <p className="text-xs text-fg-3">La primera vez se cargan unos 6 MB del motor de lectura; después funciona sin conexión.</p>
              </div>
            )}
            {error && <Callout tone="warn">{error}</Callout>}
          </div>
          <div>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Captura del cuadrante" className="max-h-[520px] w-full rounded-xl border border-line object-contain" />
            ) : (
              <div className="flex h-full min-h-40 items-center justify-center rounded-xl bg-surface-2/60 p-6 text-center text-sm text-fg-3">
                Consejo: haz la captura con los días y las horas bien visibles, sin recortar el encabezado. Funciona con modo claro y oscuro.
              </div>
            )}
          </div>
        </div>
      </Card>

      {done && (
        <Callout tone="ok" title="Importación completada">
          {done.created} turno(s) añadidos{done.removed ? `, ${done.removed} sustituidos o eliminados` : ""}{done.duplicates ? `, ${done.duplicates} ya existían y se han omitido` : ""}. <Link href="/calendario/" className="font-medium text-accent underline">Ver en el calendario</Link>
        </Callout>
      )}

      {parsed && !done && (
        <Card>
          <CardTitle action={<Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setRows((rs) => [...rs, { key: uid(), date: reference, start: "", end: "", issues: [], doubtful: false }])}>Añadir fila</Button>}>
            Revisa los turnos reconocidos
          </CardTitle>
          <div className="mb-4 flex flex-wrap gap-2 text-sm">
            {d.multi && <JobTag job={d.jobMap.get(jobId)} />}
            {parsed.detectedRange && <Badge>Cuadrante del {fmtDate(parsed.detectedRange.from)} al {fmtDate(parsed.detectedRange.to)}</Badge>}
            <Badge tone="ok">{counts.add} para añadir</Badge>
            {counts.replace > 0 && <Badge tone="warn">{counts.replace} sustituyen a otros</Badge>}
            {counts.exists > 0 && <Badge>{counts.exists} ya existen</Badge>}
            {counts.changed > 0 && <Badge tone="warn">{counts.changed} con cambios</Badge>}
            {counts.doubtful > 0 && <Badge tone="danger">{counts.doubtful} dudosos</Badge>}
            {dayOff.length > 0 && <Badge>{dayOff.length} días libres</Badge>}
          </div>
          {counts.changed > 0 && (
            <div className="mb-4">
              <Callout tone="warn" title="El cuadrante cambia algunos turnos que ya tenías">
                Por seguridad no se sustituye nada automáticamente. Elige «Sustituir» en cada uno o
                <button type="button" className="ml-1 font-medium text-accent underline" onClick={() => setActions((a) => ({ ...a, ...Object.fromEntries(plan.items.filter((i) => i.status === "changed").map((i) => [i.key, "replace" as const])) }))}>sustituir todos los cambios</button>.
              </Callout>
            </div>
          )}
          {plan.items.length === 0 && <p className="text-sm text-fg-3">No hay turnos para importar.</p>}
          <ul className="space-y-2">
            {plan.items.map((it) => {
              const action = actionOf(it);
              const mins = it.start && it.end ? durationMinutes(it.start, it.end) : 0;
              const crosses = it.start && it.end && it.end <= it.start;
              return (
                <li key={it.key} className={cx("rounded-2xl border p-3", it.doubtful || it.status === "invalid" ? "border-warn/50 bg-warn-soft/40" : "border-line")}>
                  <div className="grid grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
                    <Field label="Fecha" className="col-span-2 sm:w-44"><Input type="date" aria-label="Fecha" value={it.date} onChange={(e) => setRow(it.key, { date: e.target.value })} /></Field>
                    <Field label="Entrada" className="sm:w-32"><Input type="time" aria-label="Entrada" value={it.start} onChange={(e) => setRow(it.key, { start: e.target.value })} /></Field>
                    <Field label="Salida" className="sm:w-32"><Input type="time" aria-label="Salida" value={it.end} onChange={(e) => setRow(it.key, { end: e.target.value })} /></Field>
                    <Field label="Acción" className="col-span-2 min-w-0 flex-1 sm:w-auto sm:min-w-48">
                      <Select aria-label="Acción" value={action} disabled={it.status === "invalid" || it.status === "exists"} onChange={(e) => setActions((a) => ({ ...a, [it.key]: e.target.value as ImportAction }))}>
                        {it.status === "changed" && <option value="replace">Sustituir el existente</option>}
                        {it.status !== "exists" && it.status !== "invalid" && <option value="add">{it.status === "new" ? "Añadir" : "Añadir además"}</option>}
                        <option value="skip">No importar</option>
                      </Select>
                    </Field>
                    <IconButton label="Quitar fila" className="col-span-2 mb-0.5 justify-self-end" onClick={() => setRows((rs) => rs.filter((r) => r.key !== it.key))}><Trash2 className="size-4" /></IconButton>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={STATUS_BADGE[it.status].tone}>{STATUS_BADGE[it.status].text}</Badge>
                    {it.date && <span className="capitalize text-fg-3">{fmtDayShort(it.date)}</span>}
                    {mins > 0 && <span className="text-fg-3">{fmtDuration(mins)}</span>}
                    {crosses && <span className="inline-flex items-center gap-1 text-fg-3"><Moon className="size-3" />termina al día siguiente</span>}
                    {it.existing.length > 0 && it.status !== "exists" && <span className="text-fg-2">Ahora tienes: {it.existing.map((e) => `${e.start}–${e.end}`).join(", ")}</span>}
                  </div>
                  {it.issues.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5 text-xs text-warn">
                      {it.issues.map((iss) => <li key={iss} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{iss}</li>)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {plan.freedDays.length > 0 && (
            <div className="mt-5 space-y-2">
              <h3 className="text-sm font-semibold">Días que el cuadrante marca como libres y en tu calendario tienen turno</h3>
              <p className="text-xs text-fg-3">No se borran salvo que lo marques.</p>
              {plan.freedDays.map((f) => (
                <label key={f.date} className="flex items-center gap-3 rounded-xl border border-line p-3 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={!!freedSel[f.date]} onChange={(e) => setFreedSel((s) => ({ ...s, [f.date]: e.target.checked }))} />
                  <span className="capitalize">{fmtDayShort(f.date)}</span>
                  <span className="text-fg-2">{f.shifts.map((s) => `${s.start}–${s.end}`).join(", ")}</span>
                  <span className="ml-auto text-xs text-fg-3">Eliminar</span>
                </label>
              ))}
            </div>
          )}

          {parsed.unassigned.length > 0 && (
            <div className="mt-4"><Callout tone="warn" title="Textos con horas que no se han podido asociar a ningún día">{parsed.unassigned.join(" · ")} — si son turnos, añádelos con «Añadir fila».</Callout></div>
          )}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-line pt-4">
            <p className="mr-auto text-xs text-fg-3">Nada se guarda hasta que pulses «Importar». Los turnos se crean como previstos con la etiqueta «cuadrante».</p>
            <Button variant="primary" size="lg" loading={busy} icon={<CheckCircle2 className="size-5" />} disabled={counts.add + counts.replace === 0 && !Object.values(freedSel).some(Boolean)} onClick={doImport}>
              Importar {counts.add + counts.replace} turno(s)
            </Button>
          </div>
        </Card>
      )}
      <p className="text-xs text-fg-3">Los horarios de entrada y salida se muestran en formato 24 h ({timeOf("2026-01-01T20:30")}). Los turnos que terminan después de medianoche se guardan terminando al día siguiente.</p>
    </div>
  );
}
