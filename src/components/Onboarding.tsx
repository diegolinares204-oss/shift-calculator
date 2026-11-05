"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Clock3, ShieldCheck } from "lucide-react";
import { Button, Callout, LabeledInput, cx } from "./ui";
import { ContractHoursSection, PremiumsSection, ProfileSection, SalarySection } from "./contractForms";
import { defaultContract, defaultProfile } from "@/lib/defaults";
import { getDb, loadJobs, saveContract } from "@/db/repo";
import type { Contract, Profile } from "@/lib/types";
import { todayKey } from "@/lib/time";

const STEPS = ["Bienvenida", "Datos laborales", "Contrato", "Salario", "Pluses"];

export function Onboarding({ initialProfile, initialContract }: { initialProfile?: Profile; initialContract?: Contract | null }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<Profile>(initialProfile ?? defaultProfile());
  const [contract, setContract] = useState<Contract>(initialContract ?? defaultContract(`${todayKey().slice(0, 7)}-01`));
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState({ name: "", company: initialProfile?.company ?? "", position: initialProfile?.position ?? "" });

  const finish = async () => {
    setSaving(true);
    const db = getDb();
    const now = Date.now();
    const main = (await loadJobs())[0];
    if (main) await db.jobs.update(main.id, { name: job.name.trim() || job.company.trim() || main.name, company: job.company.trim(), position: job.position.trim(), updatedAt: now });
    await db.profile.put({ ...profile, bankStartDate: profile.bankStartDate || contract.validFrom, updatedAt: now });
    // también al omitir se guarda el contrato (vacío y editable) para que los cálculos funcionen
    await saveContract({ ...contract, jobId: main?.id ?? contract.jobId });
    const s = await db.settings.get("app");
    if (s) await db.settings.put({ ...s, onboardingDone: true, updatedAt: now });
    setSaving(false);
  };

  return (
    <div className="min-h-dvh bg-bg px-4 py-6 safe-top">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-accent text-accent-fg"><Clock3 className="size-5" /></div>
          <div>
            <p className="text-sm font-bold tracking-wide text-fg">SHIFT CALCULATOR</p>
            <p className="text-xs text-fg-3">Configuración inicial · Paso {step + 1} de {STEPS.length}</p>
          </div>
        </div>
        <ol className="mb-6 flex gap-1.5" aria-label="Progreso">
          {STEPS.map((s, i) => (
            <li key={s} className={cx("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-line")} aria-current={i === step ? "step" : undefined}><span className="sr-only">{s}</span></li>
          ))}
        </ol>

        <div key={step} className="anim-up rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-7">
          {step === 0 && (
            <div className="space-y-4">
              <h1 className="text-2xl font-bold tracking-tight">Te damos la bienvenida</h1>
              <p className="text-fg-2">Registra tus turnos y fichajes, controla las horas de tu contrato y estima tu salario. En unos pasos dejamos configurado tu contrato; podrás cambiarlo todo después en Configuración.</p>
              <Callout tone="ok" title="Tus datos no salen de este dispositivo">
                Todo se guarda localmente en tu navegador. Sin cuentas, sin servidores, sin publicidad y gratis. Haz copias de seguridad de vez en cuando desde Configuración.
              </Callout>
              <ul className="space-y-2 text-sm text-fg-2">
                {["Turnos nocturnos, partidos y con descansos", "Fichaje con contador y recuperación si cierras la app", "Bolsa de horas, vacaciones, festivos y nóminas", "Informes en PDF, CSV y Excel"].map((t) => (
                  <li key={t} className="flex items-center gap-2"><ShieldCheck className="size-4 text-accent" />{t}</li>
                ))}
              </ul>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Datos laborales</h2>
              <ProfileSection p={profile} onChange={(p) => setProfile((x) => ({ ...x, ...p }))} />
              <h3 className="pt-2 text-base font-semibold">Tu trabajo</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                <LabeledInput label="Nombre del trabajo" value={job.name} onChange={(e) => setJob({ ...job, name: e.target.value })} placeholder="Ej.: Bar, Tienda" />
                <LabeledInput label="Empresa (opcional)" value={job.company} onChange={(e) => setJob({ ...job, company: e.target.value })} autoComplete="organization" />
                <LabeledInput label="Puesto (opcional)" value={job.position} onChange={(e) => setJob({ ...job, position: e.target.value })} autoComplete="organization-title" />
              </div>
              <Callout>¿Tienes más de un trabajo? Configura ahora el principal; después podrás añadir los demás en Configuración → Trabajos, cada uno con su propio contrato y salario.</Callout>
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Tu contrato</h2>
              <p className="text-sm text-fg-3">«Vigente desde» marca desde cuándo se cuentan tus horas contratadas y la bolsa de horas.</p>
              <ContractHoursSection c={contract} onChange={(p) => setContract((x) => ({ ...x, ...p }))} />
            </div>
          )}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Salario</h2>
              <p className="text-sm text-fg-3">Introduce los importes brutos que figuran en tu contrato o nómina. Si no los conoces, déjalos vacíos.</p>
              <SalarySection c={contract} onChange={(p) => setContract((x) => ({ ...x, ...p }))} currency={profile.currency} />
            </div>
          )}
          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold">Pluses</h2>
              <p className="text-sm text-fg-3">Activa solo los que te correspondan según tu contrato o convenio. Las reglas de horas complementarias, extraordinarias, otros complementos y deducciones se configuran en Configuración → Salario.</p>
              <PremiumsSection c={contract} onChange={(p) => setContract((x) => ({ ...x, ...p }))} currency={profile.currency} />
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2 pb-8">
          {step > 0 ? (
            <Button variant="ghost" icon={<ArrowLeft className="size-4" />} onClick={() => setStep(step - 1)}>Atrás</Button>
          ) : (
            <Button variant="ghost" onClick={() => finish()} loading={saving}>Configurar más tarde</Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => { if (step === 1 && profile.startDate && !initialContract && contract.validFrom === `${todayKey().slice(0, 7)}-01`) setContract((x) => ({ ...x, validFrom: profile.startDate, customPeriodAnchor: profile.startDate })); setStep(step + 1); }}>
              Continuar <ArrowRight className="size-4" />
            </Button>
          ) : (
            <Button variant="primary" icon={<Check className="size-4" />} loading={saving} onClick={() => finish()}>Empezar</Button>
          )}
        </div>
      </div>
    </div>
  );
}
