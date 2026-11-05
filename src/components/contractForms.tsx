"use client";

import { Plus, Trash2 } from "lucide-react";
import type { Contract, ContractType, Deduction, OtherComplement, PremiumRule, Profile, Weekday } from "@/lib/types";
import { Button, Callout, Field, IconButton, LabeledInput, LabeledSelect, Segmented, Select, Toggle, WeekdayPicker } from "./ui";
import { HoursField, MoneyField, NumberField, currencySymbol } from "./inputs";
import { CURRENCIES, fmtMoney } from "@/lib/money";
import { hourlyRate, monthlyReferenceMinutes } from "@/lib/engine";
import { fmtHours, WEEKDAY_NAMES } from "@/lib/time";
import { uid } from "@/lib/id";
import { roundCents } from "@/lib/money";

export const CONTRACT_TYPES: Record<ContractType, string> = {
  indefinido: "Indefinido",
  temporal: "Temporal",
  "fijo-discontinuo": "Fijo discontinuo",
  practicas: "En prácticas",
  formacion: "Formación",
  obra: "Por obra o servicio",
  autonomo: "Autónomo / por cuenta propia",
  otro: "Otro",
};

const COUNTRIES = ["España", "México", "Argentina", "Colombia", "Chile", "Perú", "Uruguay", "Ecuador", "Venezuela", "Bolivia", "Paraguay", "Guatemala", "Costa Rica", "Panamá", "República Dominicana", "Estados Unidos", "Reino Unido", "Francia", "Alemania", "Portugal", "Suiza", "Otro"];

type Upd<T> = (patch: Partial<T>) => void;

export function ProfileSection({ p, onChange }: { p: Profile; onChange: Upd<Profile> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <LabeledInput label="Nombre (opcional)" value={p.name} onChange={(e) => onChange({ name: e.target.value })} autoComplete="given-name" placeholder="¿Cómo quieres que te saludemos?" />
      <LabeledInput label="Fecha de incorporación (opcional)" type="date" value={p.startDate} onChange={(e) => onChange({ startDate: e.target.value })} />
      <LabeledSelect label="País" value={COUNTRIES.includes(p.country) ? p.country : "Otro"} onChange={(e) => onChange({ country: e.target.value })}>
        {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </LabeledSelect>
      <LabeledInput label="Comunidad / región (opcional)" value={p.region} onChange={(e) => onChange({ region: e.target.value })} hint="Solo informativo, para tus festivos." />
      <LabeledSelect label="Moneda" value={p.currency} onChange={(e) => onChange({ currency: e.target.value })}>
        {CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </LabeledSelect>
    </div>
  );
}

export function ContractHoursSection({ c, onChange }: { c: Contract; onChange: Upd<Contract> }) {
  const distTotal = (c.distribution ?? []).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledSelect label="Tipo de contrato" value={c.contractType} onChange={(e) => onChange({ contractType: e.target.value as ContractType })}>
          {Object.entries(CONTRACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </LabeledSelect>
        <LabeledInput label="Vigente desde" type="date" value={c.validFrom} onChange={(e) => e.target.value && onChange({ validFrom: e.target.value })} hint="Fecha desde la que se aplican estas condiciones." />
        <Field label="Jornada">
          <Segmented ariaLabel="Jornada" value={c.fullTime ? "full" : "part"} onChange={(v) => onChange({ fullTime: v === "full", ...(v === "full" && c.weeklyMinutes ? { fullTimeWeeklyMinutes: c.weeklyMinutes } : {}) })} options={[{ value: "full", label: "Completa" }, { value: "part", label: "Parcial" }]} />
        </Field>
        <Field label="Horario">
          <Segmented ariaLabel="Horario" value={c.scheduleType} onChange={(v) => onChange({ scheduleType: v })} options={[{ value: "fixed", label: "Fijo" }, { value: "variable", label: "Variable" }]} />
        </Field>
        <HoursField label="Horas semanales contratadas" value={c.weeklyMinutes} onChange={(m) => onChange({ weeklyMinutes: m, ...(c.fullTime ? { fullTimeWeeklyMinutes: m } : {}) })} />
        <HoursField label="Horas mensuales de referencia" value={c.monthlyMinutes} onChange={(m) => onChange({ monthlyMinutes: m })} hint={c.monthlyMinutes ? "Valor introducido por ti" : `Vacío = semanales × 52 ÷ 12 (${fmtHours(monthlyReferenceMinutes(c))})`} />
        <HoursField label="Jornada completa de referencia (semanal)" value={c.fullTimeWeeklyMinutes} onChange={(m) => onChange({ fullTimeWeeklyMinutes: m })} hint="Según tu convenio. Se usa como umbral de horas extraordinarias." />
      </div>
      <Field label="Días habituales de trabajo">
        <WeekdayPicker value={c.workDays} onChange={(v) => onChange({ workDays: v as Weekday[] })} />
      </Field>
      <Field label="Descanso semanal">
        <WeekdayPicker value={c.weeklyRestDays} onChange={(v) => onChange({ weeklyRestDays: v as Weekday[] })} />
      </Field>
      <Toggle
        label="Distribución fija de horas por día"
        description="Si no la activas, las horas semanales se reparten por igual entre los días habituales."
        checked={!!c.distribution}
        onChange={(v) => onChange({ distribution: v ? [0, 1, 2, 3, 4, 5, 6].map((d) => (c.workDays.includes(d as Weekday) && c.workDays.length ? Math.round(c.weeklyMinutes / c.workDays.length) : 0)) : null })}
      />
      {c.distribution && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {WEEKDAY_NAMES.map((n, i) => (
              <HoursField key={n} label={n} hint=" " value={c.distribution![i]} onChange={(m) => { const d = [...c.distribution!]; d[i] = m; onChange({ distribution: d }); }} />
            ))}
          </div>
          {distTotal !== c.weeklyMinutes && (
            <Callout tone="warn">La distribución suma {fmtHours(distTotal)} y el contrato indica {fmtHours(c.weeklyMinutes)} semanales. Se usará la distribución para calcular las horas esperadas.</Callout>
          )}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledInput label="Convenio (informativo)" value={c.agreement} onChange={(e) => onChange({ agreement: e.target.value })} />
        <LabeledInput label="Categoría / grupo profesional (informativo)" value={c.category} onChange={(e) => onChange({ category: e.target.value })} />
      </div>
    </div>
  );
}

export function SalarySection({ c, onChange, currency }: { c: Contract; onChange: Upd<Contract>; currency: string }) {
  const sym = currencySymbol(currency);
  const rate = hourlyRate(c);
  const extras = Math.max(0, c.numPayments - 12);
  return (
    <div className="space-y-4">
      <Field label="¿Cómo se calcula tu salario base?">
        <Segmented ariaLabel="Tipo de salario" value={c.payType} onChange={(v) => onChange({ payType: v })} options={[{ value: "hourly", label: "Por horas trabajadas" }, { value: "monthly", label: "Mensual fijo" }]} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <MoneyField label="Salario bruto por hora" suffix={sym} value={c.hourlyRateCents} onChange={(v) => onChange({ hourlyRateCents: v })} hint={c.hourlyRateCents ? "Dato introducido" : rate.cents ? `Derivado: ${fmtMoney(rate.cents, currency)}/h` : "Opcional si indicas el mensual"} />
        <MoneyField label="Salario bruto mensual" suffix={sym} value={c.monthlyGrossCents} onChange={(v) => onChange({ monthlyGrossCents: v })} />
        <MoneyField label="Salario bruto anual" suffix={sym} value={c.annualGrossCents} onChange={(v) => onChange({ annualGrossCents: v })} hint="Informativo / para derivar el precio por hora." />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="soft" disabled={!c.annualGrossCents || !c.numPayments} onClick={() => onChange({ monthlyGrossCents: roundCents(c.annualGrossCents / c.numPayments) })}>Mensual = anual ÷ pagas</Button>
        <Button size="sm" variant="soft" disabled={!c.monthlyGrossCents} onClick={() => onChange({ annualGrossCents: c.monthlyGrossCents * c.numPayments })}>Anual = mensual × pagas</Button>
        <Button size="sm" variant="soft" disabled={!rate.derived || !rate.cents} onClick={() => onChange({ hourlyRateCents: rate.cents })}>Fijar precio/hora derivado</Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <LabeledSelect label="Número de pagas al año" value={String(c.numPayments)} onChange={(e) => onChange({ numPayments: Number(e.target.value) })}>
          {[12, 13, 14, 15, 16].map((n) => <option key={n} value={n}>{n} pagas</option>)}
        </LabeledSelect>
        {extras > 0 && (
          <>
            <Field label="Pagas extra">
              <Segmented ariaLabel="Pagas extra" value={c.extraPaysProrated ? "yes" : "no"} onChange={(v) => onChange({ extraPaysProrated: v === "yes" })} options={[{ value: "yes", label: "Prorrateadas" }, { value: "no", label: "No prorrateadas" }]} />
            </Field>
            <MoneyField label="Importe de cada paga extra" suffix={sym} value={c.extraPayAmountCents} onChange={(v) => onChange({ extraPayAmountCents: v })} hint={c.payType === "monthly" ? "Vacío = igual al salario mensual" : "Necesario si cobras por horas"} />
          </>
        )}
      </div>
      {extras > 0 && !c.extraPaysProrated && (
        <Field label="Meses en que se cobran las pagas extra">
          <div className="flex flex-wrap gap-1.5">
            {["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"].map((m, i) => {
              const on = c.extraPayMonths.includes(i + 1);
              return (
                <button key={m} type="button" aria-pressed={on} onClick={() => onChange({ extraPayMonths: on ? c.extraPayMonths.filter((x) => x !== i + 1) : [...c.extraPayMonths, i + 1].sort((a, b) => a - b) })} className={`h-9 rounded-lg px-3 text-sm font-medium ${on ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg-3"}`}>
                  {m}
                </button>
              );
            })}
          </div>
        </Field>
      )}
    </div>
  );
}

function PremiumEditor({ title, rule, onChange, currency, children }: { title: string; rule: PremiumRule; onChange: (r: Partial<PremiumRule>) => void; currency: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <Toggle label={title} checked={rule.enabled} onChange={(v) => onChange({ enabled: v })} />
      {rule.enabled && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Tipo">
            <Segmented ariaLabel={`Tipo de ${title}`} value={rule.mode} onChange={(v) => onChange({ mode: v, value: 0 })} options={[{ value: "percent", label: "% sobre hora" }, { value: "fixed", label: "Importe/hora" }]} />
          </Field>
          {rule.mode === "percent" ? (
            <NumberField label="Porcentaje adicional" suffix="%" value={rule.value} onChange={(v) => onChange({ value: v })} min={0} max={1000} hint="Ej.: 25 = +25 % del precio/hora" />
          ) : (
            <MoneyField label="Importe por hora" suffix={currencySymbol(currency)} value={rule.value} onChange={(v) => onChange({ value: v })} />
          )}
          {children}
        </div>
      )}
    </div>
  );
}

export function PremiumsSection({ c, onChange, currency }: { c: Contract; onChange: Upd<Contract>; currency: string }) {
  return (
    <div className="space-y-3">
      <PremiumEditor title="Plus de nocturnidad" rule={c.night} currency={currency} onChange={(r) => onChange({ night: { ...c.night, ...r } })}>
        <LabeledInput label="Inicio franja nocturna" type="time" value={c.night.start} onChange={(e) => e.target.value && onChange({ night: { ...c.night, start: e.target.value } })} />
        <LabeledInput label="Fin franja nocturna" type="time" value={c.night.end} onChange={(e) => e.target.value && onChange({ night: { ...c.night, end: e.target.value } })} />
      </PremiumEditor>
      <PremiumEditor title="Plus de fin de semana" rule={c.weekend} currency={currency} onChange={(r) => onChange({ weekend: { ...c.weekend, ...r } })}>
        <Field label="Días que se consideran fin de semana" className="sm:col-span-2">
          <WeekdayPicker value={c.weekend.days} onChange={(v) => onChange({ weekend: { ...c.weekend, days: v as Weekday[] } })} />
        </Field>
      </PremiumEditor>
      <PremiumEditor title="Plus de festivos" rule={c.holiday} currency={currency} onChange={(r) => onChange({ holiday: { ...c.holiday, ...r } })} />
      <Toggle label="Acumular pluses coincidentes" description="Si una hora es nocturna y festiva a la vez: acumular ambos pluses o aplicar solo el mayor." checked={c.stackPremiums} onChange={(v) => onChange({ stackPremiums: v })} />
    </div>
  );
}

export function ExcessSection({ c, onChange, currency }: { c: Contract; onChange: Upd<Contract>; currency: string }) {
  const sym = currencySymbol(currency);
  const payEditor = (rule: Contract["overtime"], set: (r: Partial<Contract["overtime"]>) => void) => (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <LabeledSelect label="Cómo se retribuyen" value={rule.payMode} onChange={(e) => set({ payMode: e.target.value as Contract["overtime"]["payMode"], value: e.target.value === "multiplier" ? 100 : 0 })}>
        <option value="multiplier">% del precio/hora ordinario</option>
        <option value="fixed">Importe fijo por hora</option>
        <option value="unpaid">No se pagan (se compensan con descanso)</option>
      </LabeledSelect>
      {rule.payMode === "multiplier" && <NumberField label="Porcentaje del precio/hora" suffix="%" min={0} max={1000} value={rule.value} onChange={(v) => set({ value: v })} hint="100 = igual que la hora ordinaria; 175 = +75 %" />}
      {rule.payMode === "fixed" && <MoneyField label="Importe por hora" suffix={sym} value={rule.value} onChange={(v) => set({ value: v })} />}
    </div>
  );
  return (
    <div className="space-y-4">
      <Callout>
        Las horas que superan tu contrato se muestran siempre como <strong>diferencia</strong>. Solo se clasifican como complementarias o extraordinarias si activas aquí las reglas de tu contrato o convenio.
      </Callout>
      <div className="grid gap-4 sm:grid-cols-2">
        <LabeledSelect label="Periodo de referencia" value={c.referencePeriod} onChange={(e) => onChange({ referencePeriod: e.target.value as Contract["referencePeriod"] })}>
          <option value="weekly">Semanal (lunes a domingo)</option>
          <option value="monthly">Mensual</option>
          <option value="custom">Personalizado</option>
        </LabeledSelect>
        {c.referencePeriod === "custom" && (
          <>
            <NumberField label="Duración del periodo" suffix="días" integer min={1} max={366} value={c.customPeriodDays} onChange={(v) => onChange({ customPeriodDays: v })} />
            <LabeledInput label="Fecha de inicio de un periodo" type="date" value={c.customPeriodAnchor} onChange={(e) => e.target.value && onChange({ customPeriodAnchor: e.target.value })} />
          </>
        )}
      </div>
      <div className="rounded-xl border border-line p-3">
        <Toggle label="Horas complementarias" description="Las que superan tu contrato parcial hasta la jornada completa de referencia." checked={c.complementary.enabled} onChange={(v) => onChange({ complementary: { ...c.complementary, enabled: v } })} />
        {c.complementary.enabled && (
          <>
            {payEditor(c.complementary, (r) => onChange({ complementary: { ...c.complementary, ...r } }))}
            <div className="mt-3 sm:w-1/2"><HoursField label="Máximo por periodo (0 = sin límite)" value={c.complementary.maxMinutesPerPeriod} onChange={(m) => onChange({ complementary: { ...c.complementary, maxMinutesPerPeriod: m } })} hint="Lo que lo supere quedará sin clasificar." /></div>
          </>
        )}
      </div>
      <div className="rounded-xl border border-line p-3">
        <Toggle label="Horas extraordinarias" description={`Las que superan la jornada completa de referencia (${fmtHours(c.fullTimeWeeklyMinutes)}/semana).`} checked={c.overtime.enabled} onChange={(v) => onChange({ overtime: { ...c.overtime, enabled: v } })} />
        {c.overtime.enabled && payEditor(c.overtime, (r) => onChange({ overtime: { ...c.overtime, ...r } }))}
      </div>
      <LabeledSelect label="Diferencia sin clasificar" value={c.unclassifiedPay} onChange={(e) => onChange({ unclassifiedPay: e.target.value as Contract["unclassifiedPay"] })} hint="Cómo estimar las horas de más que no encajan en ninguna regla activa.">
        <option value="ordinary">Estimarla a precio de hora ordinaria</option>
        <option value="unpaid">No incluirla en el salario estimado</option>
      </LabeledSelect>
    </div>
  );
}

export function ComplementsSection({ c, onChange, currency }: { c: Contract; onChange: Upd<Contract>; currency: string }) {
  const sym = currencySymbol(currency);
  const setOc = (id: string, patch: Partial<OtherComplement>) => onChange({ otherComplements: c.otherComplements.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const setDe = (id: string, patch: Partial<Deduction>) => onChange({ deductions: c.deductions.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 text-sm font-semibold text-fg">Complementos salariales</h3>
        <div className="space-y-3">
          {c.otherComplements.map((oc) => (
            <div key={oc.id} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <LabeledInput label="Nombre" value={oc.name} onChange={(e) => setOc(oc.id, { name: e.target.value })} placeholder="Ej.: antigüedad, transporte…" />
              <LabeledSelect label="Tipo" value={oc.type} onChange={(e) => setOc(oc.id, { type: e.target.value as OtherComplement["type"], amount: 0 })}>
                <option value="monthly_fixed">Importe fijo mensual</option>
                <option value="per_hour">Por hora retribuida</option>
                <option value="per_day">Por día trabajado</option>
                <option value="percent_base">% del salario base</option>
              </LabeledSelect>
              {oc.type === "percent_base" ? (
                <NumberField label="Porcentaje" suffix="%" value={oc.amount} onChange={(v) => setOc(oc.id, { amount: v })} min={0} max={1000} />
              ) : (
                <MoneyField label="Importe" suffix={sym} value={oc.amount} onChange={(v) => setOc(oc.id, { amount: v })} />
              )}
              <div className="flex items-center gap-1 pb-0.5">
                <input aria-label="Activo" type="checkbox" className="size-5 accent-[var(--accent)]" checked={oc.enabled} onChange={(e) => setOc(oc.id, { enabled: e.target.checked })} />
                <IconButton label="Eliminar complemento" onClick={() => onChange({ otherComplements: c.otherComplements.filter((x) => x.id !== oc.id) })}><Trash2 className="size-4" /></IconButton>
              </div>
            </div>
          ))}
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => onChange({ otherComplements: [...c.otherComplements, { id: uid(), name: "", type: "monthly_fixed", amount: 0, enabled: true }] })}>Añadir complemento</Button>
        </div>
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold text-fg">Hipótesis de deducciones (para el neto estimado)</h3>
        <p className="mb-3 text-xs text-fg-3">La aplicación no conoce tus retenciones fiscales ni cotizaciones. Si quieres un neto estimado, introduce los porcentajes o importes que figuran en tus nóminas. Sin deducciones configuradas no se muestra ningún neto.</p>
        <div className="space-y-3">
          {c.deductions.map((d) => (
            <div key={d.id} className="grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
              <LabeledInput label="Concepto" value={d.name} onChange={(e) => setDe(d.id, { name: e.target.value })} placeholder="Ej.: retención IRPF de mi nómina" />
              <LabeledSelect label="Tipo" value={d.type} onChange={(e) => setDe(d.id, { type: e.target.value as Deduction["type"], value: 0 })}>
                <option value="percent">% sobre el bruto</option>
                <option value="fixed">Importe fijo</option>
              </LabeledSelect>
              {d.type === "percent" ? <NumberField label="Porcentaje" suffix="%" value={d.value} onChange={(v) => setDe(d.id, { value: v })} min={0} max={100} /> : <MoneyField label="Importe" suffix={sym} value={d.value} onChange={(v) => setDe(d.id, { value: v })} />}
              <div className="flex items-center gap-1 pb-0.5">
                <input aria-label="Activa" type="checkbox" className="size-5 accent-[var(--accent)]" checked={d.enabled} onChange={(e) => setDe(d.id, { enabled: e.target.checked })} />
                <IconButton label="Eliminar deducción" onClick={() => onChange({ deductions: c.deductions.filter((x) => x.id !== d.id) })}><Trash2 className="size-4" /></IconButton>
              </div>
            </div>
          ))}
          <Button size="sm" icon={<Plus className="size-4" />} onClick={() => onChange({ deductions: [...c.deductions, { id: uid(), name: "", type: "percent", value: 0, enabled: true }] })}>Añadir deducción</Button>
        </div>
      </div>
    </div>
  );
}

export function PayrollSection({ c, onChange }: { c: Contract; onChange: Upd<Contract> }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Inicio del periodo de nómina" hint="1 = mes natural. Ej.: 21 → del 21 del mes anterior al 20 del mes.">
          <Select value={String(c.payPeriodStartDay)} onChange={(e) => onChange({ payPeriodStartDay: Number(e.target.value) })}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 1 ? "Día 1 (mes natural)" : `Día ${d}`}</option>)}
          </Select>
        </Field>
      </div>
      <Toggle
        label="Turnos que pasan de medianoche: contar todo el turno en el día en que empieza"
        description="Actívalo si tu nómina imputa así los cierres (p. ej. un turno del 31 de 20:00 a 01:00 cuenta entero en ese mes). Si está desactivado, cada hora cuenta en el día real en que se trabaja. Los pluses de nocturnidad, fin de semana y festivo siempre se calculan según la hora real."
        checked={!!c.crossMidnightToStartDay}
        onChange={(v) => onChange({ crossMidnightToStartDay: v })}
      />
      <Toggle label="Festivos y ausencias justificadas reducen las horas esperadas" description="Vacaciones aprobadas, bajas, permisos y festivos no cuentan como horas pendientes." checked={c.absencesReduceExpected} onChange={(v) => onChange({ absencesReduceExpected: v })} />
      <p className="text-xs text-fg-3">Descansos remunerados: cada descanso de un turno puede marcarse como remunerado o no. Los remunerados cuentan como tiempo retribuido.</p>
    </div>
  );
}

