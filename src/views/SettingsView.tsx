"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Building2, Bell, Briefcase, Check, Database, Download, FileUp, Info, Loader2, Palette, PiggyBank, Plus, ShieldCheck, Trash2, User, Wallet, Smartphone } from "lucide-react";
import { Badge, Button, Callout, Card, CardTitle, LabeledInput, LabeledSelect, Modal, PageHeader, Segmented, Spinner, Toggle, useFeedback, cx } from "@/components/ui";
import { ComplementsSection, ContractHoursSection, ExcessSection, PayrollSection, PremiumsSection, ProfileSection, SalarySection } from "@/components/contractForms";
import { HoursField, NumberField } from "@/components/inputs";
import { notificationsSupported } from "@/components/Reminders";
import { PersistentStorageCard } from "@/components/PersistentStorage";
import { useCalcData, useContracts, useProfile, useSettings, useToday } from "@/lib/hooks";
import { JOB_COLORS, jobLabel } from "@/lib/jobs";
import { JobDot, JobSelect } from "@/components/jobs";
import { contractAt } from "@/lib/engine";
import { createJob, deleteContract, deleteJob, getDb, saveContract, wipeAllData } from "@/db/repo";
import { createBackup, importBackup, validateBackup, type Backup } from "@/lib/backup";
import { downloadBlob } from "@/lib/exporters";
import { fmtDate, fmtDateTimeEpoch } from "@/lib/time";
import { nowMs, uid } from "@/lib/id";
import { initialFromHash } from "@/lib/hash";
import { defaultContract } from "@/lib/defaults";
import type { Contract, Job, Profile, Settings } from "@/lib/types";

type Section = "profile" | "jobs" | "contract" | "salary" | "bank" | "appearance" | "reminders" | "backup" | "privacy";
const SECTIONS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: "profile", label: "Datos personales", icon: <User className="size-4" /> },
  { id: "jobs", label: "Trabajos", icon: <Building2 className="size-4" /> },
  { id: "contract", label: "Contrato", icon: <Briefcase className="size-4" /> },
  { id: "salary", label: "Salario y reglas", icon: <Wallet className="size-4" /> },
  { id: "bank", label: "Bolsa de horas", icon: <PiggyBank className="size-4" /> },
  { id: "appearance", label: "Apariencia", icon: <Palette className="size-4" /> },
  { id: "reminders", label: "Recordatorios", icon: <Bell className="size-4" /> },
  { id: "backup", label: "Copias de seguridad", icon: <Database className="size-4" /> },
  { id: "privacy", label: "Privacidad y datos", icon: <ShieldCheck className="size-4" /> },
];

/**
 * Guarda automáticamente con un pequeño retardo cuando el borrador cambia.
 * Si se sale de la pantalla o se cierra la página antes de que venza el retardo,
 * el cambio pendiente se guarda inmediatamente para no perderlo.
 */
function useAutosave<T>(draft: T, save: (v: T) => Promise<void>) {
  const [initial] = useState(draft);
  const [saved, setSaved] = useState(draft);
  const saveRef = useRef(save);
  const pending = useRef<{ value: T } | null>(null);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    if (draft === saved) { pending.current = null; return; }
    pending.current = { value: draft };
    const t = setTimeout(async () => {
      pending.current = null;
      await saveRef.current(draft);
      setSaved(draft);
    }, 500);
    return () => clearTimeout(t);
  }, [draft, saved]);
  useEffect(() => {
    const flush = () => {
      const p = pending.current;
      pending.current = null;
      if (p) void saveRef.current(p.value);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);
  const state: "idle" | "saving" | "saved" = draft !== saved ? "saving" : saved === initial ? "idle" : "saved";
  return state;
}

function SaveIndicator({ state }: { state: "idle" | "saving" | "saved" }) {
  if (state === "idle") return <span className="text-xs text-fg-3">Los cambios se guardan automáticamente</span>;
  return (
    <span className={cx("inline-flex items-center gap-1 text-xs", state === "saved" ? "text-ok" : "text-fg-3")} aria-live="polite">
      {state === "saving" ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
      {state === "saving" ? "Guardando…" : "Guardado"}
    </span>
  );
}

export function SettingsView() {
  const [section, setSection] = useState<Section>(() => initialFromHash<Section>({ ...Object.fromEntries(SECTIONS.map((s) => [s.id, s.id])), salario: "salary" }, "profile"));
  return (
    <div>
      <PageHeader title="Configuración" />
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Secciones de configuración" className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" onClick={() => setSection(s.id)} aria-current={section === s.id ? "page" : undefined} className={cx("flex shrink-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors", section === s.id ? "bg-accent-soft text-accent" : "text-fg-2 hover:bg-surface-2")}>
              {s.icon}{s.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          {section === "profile" && <ProfilePanel />}
          {section === "jobs" && <JobsPanel />}
          {(section === "contract" || section === "salary") && <ContractPanel mode={section} />}
          {section === "bank" && <BankPanel />}
          {section === "appearance" && <AppearancePanel />}
          {section === "reminders" && <RemindersPanel />}
          {section === "backup" && <BackupPanel />}
          {section === "privacy" && <PrivacyPanel />}
        </div>
      </div>
    </div>
  );
}

function ProfilePanel() {
  const profile = useProfile();
  if (!profile) return <Spinner />;
  return <ProfileEditor initial={profile} />;
}

function ProfileEditor({ initial }: { initial: Profile }) {
  const [draft, setDraft] = useState<Profile>(initial);
  const state = useAutosave(draft, async (p) => { await getDb().profile.put({ ...p, updatedAt: nowMs() }); });
  return (
    <Card>
      <CardTitle action={<SaveIndicator state={state} />}>Datos personales</CardTitle>
      <ProfileSection p={draft} onChange={(p) => setDraft({ ...draft, ...p })} />
      <p className="mt-4 text-xs text-fg-3">La empresa, el puesto, las vacaciones y la bolsa de horas se configuran en cada trabajo (sección Trabajos).</p>
    </Card>
  );
}

/** Selector del trabajo que se está configurando (solo visible con varios trabajos). */
function useJobPick() {
  const d = useCalcData();
  const [sel, setSel] = useState<string | null>(null);
  const jobId = sel && d.jobMap.has(sel) ? sel : d.primaryJobId;
  const picker = d.multi ? (
    <Card className="!py-3">
      <div className="sm:w-80"><JobSelect value={jobId} onChange={(v) => v && setSel(v)} jobs={d.jobs} label="Trabajo que estás configurando" /></div>
    </Card>
  ) : null;
  return { d, jobId, picker };
}

function ContractPanel({ mode }: { mode: "contract" | "salary" }) {
  const allContracts = useContracts();
  const profile = useProfile();
  const today = useToday();
  const { d, jobId, picker } = useJobPick();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (!allContracts || !profile || !d.ready) return <Spinner />;
  const contracts = allContracts.filter((c) => c.jobId === jobId);
  const selected = contracts.find((c) => c.id === selectedId) ?? contractAt(contracts, today);
  if (!selected) {
    return (
      <>
        {picker}
        <Card>
          <p className="mb-3 text-sm text-fg-2">Este trabajo no tiene contrato configurado.</p>
          <Button variant="primary" onClick={async () => { const c = defaultContract(`${today.slice(0, 7)}-01`, jobId); await saveContract(c); setSelectedId(c.id); }}>Crear contrato</Button>
        </Card>
      </>
    );
  }
  return (
    <>
      {picker}
      <ContractEditor key={selected.id} initial={selected} contracts={contracts} currency={profile.currency} mode={mode} onSelect={setSelectedId} />
    </>
  );
}

function ContractEditor({ initial, contracts, currency: cur, mode, onSelect }: { initial: Contract; contracts: Contract[]; currency: string; mode: "contract" | "salary"; onSelect: (id: string | null) => void }) {
  const today = useToday();
  const { toast, confirm } = useFeedback();
  const [draft, setDraft] = useState<Contract>(initial);
  const [newOpen, setNewOpen] = useState(false);
  const [newFrom, setNewFrom] = useState(today);
  const state = useAutosave(draft, async (c) => { await saveContract(c); });
  const upd = (p: Partial<Contract>) => setDraft({ ...draft, ...p });

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <LabeledSelect label="Condiciones" value={draft.id} onChange={(e) => onSelect(e.target.value)} className="min-w-60">
            {contracts.map((c) => <option key={c.id} value={c.id}>Desde el {fmtDate(c.id === draft.id ? draft.validFrom : c.validFrom)}{contractAt(contracts, today)?.id === c.id ? " (vigente)" : ""}</option>)}
          </LabeledSelect>
          <div className="flex gap-2">
            <Button size="sm" icon={<Plus className="size-4" />} onClick={() => { setNewFrom(today); setNewOpen(true); }}>Nuevas condiciones</Button>
            {contracts.length > 1 && (
              <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={async () => {
                if (await confirm({ title: "Eliminar condiciones", message: `¿Eliminar las condiciones vigentes desde el ${fmtDate(draft.validFrom)}? Los cálculos de ese periodo usarán las condiciones anteriores.`, danger: true, confirmLabel: "Eliminar" })) {
                  await deleteContract(draft.id); onSelect(null); toast("Condiciones eliminadas");
                }
              }}>Eliminar</Button>
            )}
          </div>
        </div>
        <p className="mt-2 text-xs text-fg-3">Si cambian tus condiciones (horas, salario…), crea unas nuevas desde una fecha: los cálculos anteriores conservarán las condiciones antiguas.</p>
      </Card>
      {mode === "contract" ? (
        <Card>
          <CardTitle action={<SaveIndicator state={state} />}>Contrato y jornada</CardTitle>
          <ContractHoursSection c={draft} onChange={upd} />
        </Card>
      ) : (
        <>
          <Card><CardTitle action={<SaveIndicator state={state} />}>Salario</CardTitle><SalarySection c={draft} onChange={upd} currency={cur} /></Card>
          <Card><CardTitle>Pluses</CardTitle><PremiumsSection c={draft} onChange={upd} currency={cur} /></Card>
          <Card><CardTitle>Excesos de jornada</CardTitle><ExcessSection c={draft} onChange={upd} currency={cur} /></Card>
          <Card><CardTitle>Complementos y deducciones</CardTitle><ComplementsSection c={draft} onChange={upd} currency={cur} /></Card>
          <Card><CardTitle>Periodo de nómina y descansos</CardTitle><PayrollSection c={draft} onChange={upd} /></Card>
        </>
      )}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nuevas condiciones" size="sm" footer={<Button variant="primary" disabled={contracts.some((c) => c.validFrom === newFrom)} onClick={async () => {
        const c: Contract = { ...structuredClone(draft), id: uid(), validFrom: newFrom, otherComplements: draft.otherComplements.map((x) => ({ ...x, id: uid() })), deductions: draft.deductions.map((x) => ({ ...x, id: uid() })), createdAt: nowMs(), updatedAt: nowMs() };
        await saveContract(c);
        setNewOpen(false); onSelect(c.id); toast("Condiciones creadas a partir de las actuales");
      }}>Crear</Button>}>
        <div className="space-y-3">
          <LabeledInput label="Vigentes desde" type="date" value={newFrom} onChange={(e) => e.target.value && setNewFrom(e.target.value)} />
          {contracts.some((c) => c.validFrom === newFrom) && <Callout tone="warn">Ya hay condiciones con esa fecha.</Callout>}
          <p className="text-sm text-fg-3">Se copiarán las condiciones seleccionadas para que solo tengas que cambiar lo necesario.</p>
        </div>
      </Modal>
    </>
  );
}

function BankPanel() {
  const { d, jobId, picker } = useJobPick();
  const job = d.jobMap.get(jobId);
  if (!d.ready || !job) return <Spinner />;
  return (
    <>
      {picker}
      <BankEditor key={job.id} initial={job} />
    </>
  );
}

function BankEditor({ initial }: { initial: Job }) {
  const [draft, setDraft] = useState<Job>(initial);
  const [neg, setNeg] = useState(initial.bankInitialMinutes < 0);
  const state = useAutosave(draft, async (p) => { await getDb().jobs.update(p.id, { bankStartDate: p.bankStartDate, bankInitialMinutes: p.bankInitialMinutes, updatedAt: nowMs() }); });
  return (
    <Card>
      <CardTitle action={<SaveIndicator state={state} />}>Bolsa de horas</CardTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledInput label="Fecha de inicio de la bolsa" type="date" value={draft.bankStartDate} onChange={(e) => setDraft({ ...draft, bankStartDate: e.target.value })} hint="Vacío = fecha de inicio del contrato." />
        <div className="space-y-2">
          <HoursField label="Saldo inicial" value={Math.abs(draft.bankInitialMinutes)} onChange={(m) => setDraft({ ...draft, bankInitialMinutes: neg ? -m : m })} />
          <Segmented ariaLabel="Signo del saldo" value={neg ? "neg" : "pos"} onChange={(v) => { setNeg(v === "neg"); setDraft({ ...draft, bankInitialMinutes: (v === "neg" ? -1 : 1) * Math.abs(draft.bankInitialMinutes) }); }} options={[{ value: "pos", label: "A mi favor" }, { value: "neg", label: "Debo horas" }]} />
        </div>
      </div>
      <p className="mt-4 text-sm text-fg-3">El periodo de referencia (semanal, mensual o personalizado) se configura en Salario y reglas → Excesos de jornada.</p>
    </Card>
  );
}

function JobsPanel() {
  const d = useCalcData();
  const today = useToday();
  const { toast, confirm } = useFeedback();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [copyFrom, setCopyFrom] = useState<string | null>(null);
  if (!d.ready) return <Spinner />;
  return (
    <>
      <Card>
        <CardTitle action={<Button size="sm" variant="primary" icon={<Plus className="size-4" />} onClick={() => { setName(""); setCompany(""); setPosition(""); setCopyFrom(null); setAdding(true); }}>Añadir trabajo</Button>}>Trabajos</CardTitle>
        <p className="mb-4 text-sm text-fg-3">Si tienes varios empleos, cada uno tiene su propio contrato, salario, pluses, turnos, fichajes, nóminas, vacaciones y bolsa de horas. En Inicio, Calendario o Estadísticas puedes ver cada trabajo por separado o todos juntos.</p>
        <div className="space-y-3">
          {d.jobs.map((j) => <JobRow key={j.id} job={j} canDelete={d.jobs.length > 1} onDelete={async () => {
            if (await confirm({ title: `Eliminar «${jobLabel(j)}»`, message: "Se borrarán este trabajo y TODOS sus datos: contratos, turnos, fichajes, nóminas, ajustes de bolsa y ausencias propias. Si solo ha terminado, mejor archívalo. Esta acción no se puede deshacer.", confirmLabel: "Eliminar", danger: true, requireText: "ELIMINAR" })) {
              await deleteJob(j.id);
              toast("Trabajo eliminado");
            }
          }} />)}
        </div>
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title="Nuevo trabajo" footer={<Button variant="primary" disabled={!name.trim() && !company.trim()} onClick={async () => {
        const job = await createJob({ name: name.trim() || company.trim(), company: company.trim(), position: position.trim() }, { validFrom: from, copyContractFrom: copyFrom ? d.contractFor(copyFrom) : null });
        setAdding(false);
        toast(`Trabajo «${jobLabel(job)}» creado. Configura su contrato y salario.`);
      }}>Crear</Button>}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <LabeledInput label="Nombre del trabajo" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej.: Bar, Tienda, Clases" />
            <LabeledInput label="Empresa (opcional)" value={company} onChange={(e) => setCompany(e.target.value)} />
            <LabeledInput label="Puesto (opcional)" value={position} onChange={(e) => setPosition(e.target.value)} />
            <LabeledInput label="Contrato vigente desde" type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </div>
          <JobSelect value={copyFrom} onChange={setCopyFrom} jobs={d.jobs} alwaysShow allowAll allLabel="Empezar con un contrato vacío" label="Condiciones iniciales" />
          <p className="text-xs text-fg-3">Puedes copiar las condiciones (horas, salario, pluses, reglas) de otro trabajo y después cambiar lo que sea distinto.</p>
        </div>
      </Modal>
    </>
  );
}

function JobRow({ job, canDelete, onDelete }: { job: Job; canDelete: boolean; onDelete: () => void }) {
  const [draft, setDraft] = useState<Job>(job);
  const state = useAutosave(draft, async (j) => { await getDb().jobs.update(j.id, { name: j.name, company: j.company, position: j.position, color: j.color, archived: j.archived, updatedAt: nowMs() }); });
  return (
    <div className={cx("rounded-2xl border border-line p-3", draft.archived && "opacity-70")}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-2 font-semibold"><JobDot job={draft} className="size-3" />{jobLabel(draft)}{draft.archived && <Badge>Archivado</Badge>}</span>
        <SaveIndicator state={state} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <LabeledInput label="Nombre" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        <LabeledInput label="Empresa" value={draft.company} onChange={(e) => setDraft({ ...draft, company: e.target.value })} />
        <LabeledInput label="Puesto" value={draft.position} onChange={(e) => setDraft({ ...draft, position: e.target.value })} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Color">
        {JOB_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={draft.color === c} aria-label={`Color ${c}`} onClick={() => setDraft({ ...draft, color: c })} className={cx("size-7 rounded-full ring-offset-2 ring-offset-surface", draft.color === c && "ring-2 ring-fg")} style={{ background: c }} />
        ))}
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" icon={draft.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />} onClick={() => setDraft({ ...draft, archived: !draft.archived })}>{draft.archived ? "Reactivar" : "Archivar"}</Button>
          {canDelete && <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-4" />} onClick={onDelete}>Eliminar</Button>}
        </div>
      </div>
    </div>
  );
}

function useSettingsUpdate() {
  return async (patch: Partial<Settings>) => {
    const db = getDb();
    const s = await db.settings.get("app");
    if (s) await db.settings.put({ ...s, ...patch, updatedAt: Date.now() });
  };
}

function AppearancePanel() {
  const settings = useSettings();
  const update = useSettingsUpdate();
  if (!settings) return <Spinner />;
  return (
    <Card>
      <CardTitle>Apariencia</CardTitle>
      <Segmented ariaLabel="Tema" value={settings.theme} onChange={(v) => update({ theme: v })} options={[{ value: "system", label: "Automático" }, { value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }]} />
      <p className="mt-3 text-xs text-fg-3">Automático sigue la configuración de tu dispositivo.</p>
    </Card>
  );
}

function RemindersPanel() {
  const settings = useSettings();
  const update = useSettingsUpdate();
  const { toast } = useFeedback();
  const [perm, setPerm] = useState<string>(() => (notificationsSupported() ? Notification.permission : "unsupported"));
  if (!settings) return <Spinner />;
  const r = settings.reminders;
  const set = (p: Partial<Settings["reminders"]>) => update({ reminders: { ...r, ...p } });
  return (
    <Card>
      <CardTitle>Recordatorios locales</CardTitle>
      <div className="space-y-4">
        {perm === "unsupported" ? (
          <Callout tone="warn">Este navegador no admite notificaciones. Los avisos se mostrarán dentro de la aplicación (por ejemplo, el aviso de fichaje abierto). En iPhone, las notificaciones web solo funcionan con la app instalada en la pantalla de inicio (iOS 16.4 o posterior).</Callout>
        ) : perm === "denied" ? (
          <Callout tone="warn">Has bloqueado las notificaciones para esta app. Puedes permitirlas en los ajustes del navegador.</Callout>
        ) : perm !== "granted" ? (
          <Button variant="soft" icon={<Bell className="size-4" />} onClick={async () => { const p = await Notification.requestPermission(); setPerm(p); if (p === "granted") toast("Notificaciones permitidas"); }}>Permitir notificaciones</Button>
        ) : <Badge tone="ok">Notificaciones permitidas</Badge>}
        <Toggle label="Activar recordatorios" checked={r.enabled} onChange={(v) => set({ enabled: v })} />
        <div className={cx("grid gap-4 sm:grid-cols-2", !r.enabled && "pointer-events-none opacity-50")}>
          <NumberField label="Aviso antes de cada turno" suffix="min" integer min={0} max={1440} value={r.shiftMinutesBefore} onChange={(v) => set({ shiftMinutesBefore: v })} hint="0 = desactivado" />
          <NumberField label="Aviso de fichaje abierto tras" suffix="h" integer min={1} max={72} value={r.openClockHours} onChange={(v) => set({ openClockHours: v || 12 })} />
          <NumberField label="Aviso de vacaciones con antelación" suffix="días" integer min={0} max={60} value={r.vacationDaysBefore} onChange={(v) => set({ vacationDaysBefore: v })} />
          <HoursField label="Objetivo de horas semanales" value={r.weeklyHoursGoal} onChange={(v) => set({ weeklyHoursGoal: v })} hint="Se muestra en Inicio. 0 = sin objetivo" />
        </div>
        <Callout title="Limitación">Sin servidores no es posible enviar notificaciones con la app cerrada. Los recordatorios funcionan mientras SHIFT CALCULATOR está abierta o en segundo plano reciente; el aviso de fichaje abierto aparece siempre al abrir la app.</Callout>
      </div>
    </Card>
  );
}

function BackupPanel() {
  const settings = useSettings();
  const update = useSettingsUpdate();
  const { toast, confirm } = useFeedback();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ backup: Backup; counts: Record<string, number> } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    const b = await createBackup(getDb());
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    downloadBlob(new Blob([JSON.stringify(b, null, 1)], { type: "application/json" }), `shift-calculator-copia-${stamp}.json`);
    await update({ lastBackupAt: Date.now() });
    toast("Copia de seguridad descargada");
  };

  const restore = async (mode: "merge" | "replace") => {
    if (!pending) return;
    if (mode === "replace" && !(await confirm({ title: "Reemplazar todos los datos", message: "Se borrarán TODOS los datos actuales de este dispositivo y se sustituirán por los de la copia. Esta acción no se puede deshacer.", confirmLabel: "Reemplazar", danger: true, requireText: "REEMPLAZAR" }))) return;
    setBusy(true);
    try {
      const s = await importBackup(getDb(), pending.backup, mode);
      toast(`Importación completada: ${s.added} registros añadidos${s.skipped ? `, ${s.skipped} duplicados omitidos` : ""}`);
      setPending(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Error al importar", "error");
    } finally {
      setBusy(false);
    }
  };

  const LABELS: Record<string, string> = { jobs: "Trabajos", shifts: "Turnos", clockSessions: "Fichajes", clockBreaks: "Descansos de fichaje", payslips: "Nóminas", absences: "Vacaciones y ausencias", holidays: "Festivos", templates: "Plantillas", contracts: "Contratos", complements: "Complementos", hourAdjustments: "Ajustes de bolsa", auditLog: "Registro de cambios", profile: "Perfil", settings: "Ajustes" };

  return (
    <Card>
      <CardTitle>Copias de seguridad</CardTitle>
      <div className="space-y-4">
        <p className="text-sm text-fg-2">Exporta toda tu información (turnos, fichajes, configuración, vacaciones, festivos, plantillas y nóminas) en un archivo JSON que puedes guardar donde quieras y restaurar en este u otro dispositivo.</p>
        <p className="text-sm">Última copia: <strong>{settings?.lastBackupAt ? fmtDateTimeEpoch(settings.lastBackupAt) : "nunca"}</strong></p>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<Download className="size-4" />} onClick={doExport}>Exportar copia</Button>
          <Button icon={<FileUp className="size-4" />} onClick={() => fileRef.current?.click()}>Importar copia</Button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setErrors([]);
            let raw: unknown;
            try { raw = JSON.parse(await f.text()); } catch { setErrors(["El archivo no es un JSON válido."]); return; }
            const v = validateBackup(raw);
            if (!v.ok) { setErrors(v.errors); return; }
            setPending({ backup: raw as Backup, counts: v.counts as Record<string, number> });
          }} />
        </div>
        {errors.length > 0 && <Callout tone="danger" title="La copia no es válida">{errors.slice(0, 8).map((e) => <div key={e}>{e}</div>)}</Callout>}
      </div>
      <Modal open={!!pending} onClose={() => setPending(null)} title="Restaurar copia" footer={<>
        <Button onClick={() => restore("merge")} loading={busy}>Fusionar</Button>
        <Button variant="danger" onClick={() => restore("replace")} loading={busy}>Reemplazar todo</Button>
      </>}>
        {pending && (
          <div className="space-y-3 text-sm">
            <p>Copia creada el <strong>{fmtDateTimeEpoch(new Date(pending.backup.exportedAt).getTime())}</strong>. Contenido:</p>
            <ul className="grid grid-cols-2 gap-1">
              {Object.entries(pending.counts).filter(([, n]) => n > 0).map(([k, n]) => <li key={k} className="text-fg-2">{LABELS[k] ?? k}: <b className="tabular">{n}</b></li>)}
            </ul>
            <Callout><strong>Fusionar</strong> añade solo los registros que no tienes (sin duplicar) y conserva tu configuración actual. <strong>Reemplazar</strong> borra todo y restaura la copia tal cual.</Callout>
          </div>
        )}
      </Modal>
    </Card>
  );
}

function PrivacyPanel() {
  const { toast, confirm } = useFeedback();
  const [usage, setUsage] = useState<string | null>(null);
  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setUsage(e.usage != null ? `${(e.usage / 1024 / 1024).toLocaleString("es-ES", { maximumFractionDigits: 2 })} MB` : null)).catch(() => undefined);
  }, []);
  return (
    <>
      <Card>
        <CardTitle>Privacidad</CardTitle>
        <ul className="space-y-2 text-sm text-fg-2">
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />Toda la información se guarda solo en este dispositivo (IndexedDB del navegador).</li>
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />No hay cuentas, servidores, analítica, publicidad ni telemetría. Nada se envía a terceros.</li>
          <li className="flex gap-2"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" />No se almacenan contraseñas ni claves.</li>
        </ul>
        <div className="mt-4"><Callout tone="warn" title="Importante">Si borras los datos de navegación o del sitio, desinstalas la app o el sistema libera espacio, tu información puede perderse. Haz copias de seguridad periódicas.</Callout></div>
        <div className="mt-4"><PersistentStorageCard /></div>
        <p className="mt-3 text-xs text-fg-3">Espacio usado: {usage ?? "no disponible"}</p>
      </Card>
      <Card>
        <CardTitle icon={<Smartphone className="size-4" />}>Instalar la aplicación</CardTitle>
        <ul className="space-y-1.5 text-sm text-fg-2">
          <li><b>iPhone / iPad (Safari):</b> botón Compartir → «Añadir a pantalla de inicio».</li>
          <li><b>Android (Chrome):</b> menú ⋮ → «Instalar aplicación» o «Añadir a pantalla de inicio».</li>
          <li><b>Windows (Edge/Chrome):</b> icono de instalar en la barra de direcciones o menú → «Instalar SHIFT CALCULATOR».</li>
        </ul>
        <p className="mt-2 text-xs text-fg-3">Una vez instalada funciona sin conexión.</p>
      </Card>
      <Card className="border-danger/40">
        <CardTitle>Borrar todos los datos</CardTitle>
        <p className="mb-3 text-sm text-fg-2">Elimina de este dispositivo todos los turnos, fichajes, contratos, nóminas, vacaciones, festivos, plantillas y ajustes. No se puede deshacer.</p>
        <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={async () => {
          if (await confirm({ title: "Borrar todos los datos", message: "Se eliminará toda tu información de este dispositivo. Te recomendamos exportar antes una copia de seguridad.", confirmLabel: "Borrar todo", danger: true, requireText: "BORRAR" })) {
            await wipeAllData();
            try { localStorage.removeItem("sc-reminders-sent"); } catch { /* sin almacenamiento */ }
            toast("Todos los datos se han borrado");
          }
        }}>Borrar todos los datos</Button>
      </Card>
      <Card>
        <CardTitle icon={<Info className="size-4" />}>Acerca de</CardTitle>
        <p className="text-sm text-fg-2">SHIFT CALCULATOR 1.0 · Gratuita y de código abierto. Las estimaciones salariales son orientativas y no constituyen una nómina oficial ni asesoramiento laboral o fiscal.</p>
      </Card>
    </>
  );
}
