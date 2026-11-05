"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Calculator, ChevronLeft, ChevronRight, FileText, Plus, Receipt, Trash2, Pencil, Moon } from "lucide-react";
import { Badge, Button, Callout, Card, CardTitle, EmptyState, Field, IconButton, LabeledInput, Modal, PageHeader, Segmented, Spinner, Stat, Tabs, Textarea, Toggle, useFeedback, cx } from "@/components/ui";
import { MoneyField, currencySymbol } from "@/components/inputs";
import { BarChart } from "@/components/charts";
import { useCalcData, usePayslips, useToday } from "@/lib/hooks";
import { computeSalary, hourlyRate, quickCalc, type SalaryResult } from "@/lib/engine";
import { forJob, jobLabel, netJobs, netOf, payslipsNetTotal, payslipsTotal, salaryJobs, sumAnalyses } from "@/lib/jobs";
import { JobDot, JobSelect, JobTag } from "@/components/jobs";
import { addMonths, fmtDate, fmtDuration, fmtHours, fmtMonth, dateOf, timeOf } from "@/lib/time";
import { fmtMoney, fmtPercent, percentOf } from "@/lib/money";
import { getDb } from "@/db/repo";
import { uid } from "@/lib/id";
import { initialFromHash } from "@/lib/hash";
import type { Contract, Payslip } from "@/lib/types";

type Tab = "estimate" | "payslips" | "quick";

export function SalaryView() {
  const [tab, setTab] = useState<Tab>(() => initialFromHash<Tab>({ rapida: "quick", nominas: "payslips" }, "estimate"));
  return (
    <div>
      <PageHeader title="Salario" subtitle="Estimaciones orientativas con tus datos. No sustituyen a una nómina oficial." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "estimate", label: "Estimación", icon: <Receipt className="size-4" /> }, { value: "payslips", label: "Nóminas reales", icon: <FileText className="size-4" /> }, { value: "quick", label: "Calculadora rápida", icon: <Calculator className="size-4" /> }]} />
      {tab === "estimate" && <Estimate />}
      {tab === "payslips" && <Payslips />}
      {tab === "quick" && <Quick />}
    </div>
  );
}

function Breakdown({ s, currency }: { s: SalaryResult; currency: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-3">
            <th className="py-2 font-medium">Concepto</th>
            <th className="font-medium">Cálculo</th>
            <th className="font-medium">Origen</th>
            <th className="text-right font-medium">Importe</th>
          </tr>
        </thead>
        <tbody>
          {s.lines.map((l) => (
            <tr key={l.key} className="border-b border-line/60 align-top">
              <td className="py-2.5 pr-3 font-medium">{l.label}</td>
              <td className="py-2.5 pr-3 text-fg-2">{l.detail}{l.rateCents ? <span className="text-fg-3"> · {fmtMoney(l.rateCents, currency)}/h</span> : null}</td>
              <td className="py-2.5 pr-3"><Badge tone={l.source === "user" ? "neutral" : "accent"}>{l.source === "user" ? "Dato introducido" : "Calculado"}</Badge></td>
              <td className={cx("py-2.5 text-right font-medium tabular", l.amountCents < 0 && "text-danger")}>{fmtMoney(l.amountCents, currency)}</td>
            </tr>
          ))}
          <tr className="border-b border-line">
            <td className="py-2.5 font-medium text-fg-2" colSpan={3}>Total bruto estimado</td>
            <td className="py-2.5 text-right font-medium tabular text-fg-2">{fmtMoney(s.grossCents, currency)}</td>
          </tr>
          {s.netCents !== null ? (
            <tr className="bg-accent-soft/40">
              <td className="px-2 py-3 text-base font-bold" colSpan={3}>Neto estimado <span className="text-xs font-normal text-fg-3">(lo que cobrarías, según tus deducciones)</span></td>
              <td className="px-2 py-3 text-right text-lg font-bold tabular text-accent">{fmtMoney(s.netCents, currency)}</td>
            </tr>
          ) : (
            <tr><td className="py-3 text-sm text-fg-3" colSpan={4}>Neto no estimado: añade tus deducciones (porcentajes de tu nómina) en Configuración → Salario y reglas.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Estimate() {
  const d = useCalcData();
  const today = useToday();
  const payslips = usePayslips();
  const [ym, setYm] = useState(today.slice(0, 7));
  const [mode, setMode] = useState<"worked" | "planned">("worked");
  const [slipOpen, setSlipOpen] = useState<Payslip | null>(null);
  const all = useMemo(() => (d.ready ? salaryJobs(d, d.jobIds, ym, mode) : null), [d, ym, mode]);
  if (!d.ready || !all) return <Spinner />;
  if (all.perJob.length === 0) return <EmptyState title="Sin contrato configurado" text="Configura tu contrato y salario para obtener estimaciones." action={<Link href="/configuracion/" className="text-accent underline">Ir a Configuración</Link>} />;
  const combined = all.perJob.length > 1;
  const slipFor = (jobId: string) => payslips?.find((p) => p.period === ym && p.jobId === jobId);
  const realTotal = payslipsTotal(payslips ?? [], d.jobIds, ym);
  const realNet = payslipsNetTotal(payslips ?? [], d.jobIds, ym);
  const net = netJobs(all);
  const a = combined ? sumAnalyses(all.perJob.map((x) => x.result.analysis), `${ym}-01`, `${ym}-28`, mode) : all.perJob[0].result.analysis;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center">
          <IconButton label="Mes anterior" onClick={() => setYm(addMonths(ym, -1))}><ChevronLeft className="size-5" /></IconButton>
          <h2 className="min-w-36 text-center text-sm font-semibold">{fmtMonth(ym)}</h2>
          <IconButton label="Mes siguiente" onClick={() => setYm(addMonths(ym, 1))}><ChevronRight className="size-5" /></IconButton>
        </div>
        <Segmented ariaLabel="Base del cálculo" value={mode} onChange={setMode} options={[{ value: "worked", label: "Horas realizadas" }, { value: "planned", label: "Previsión" }]} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="col-span-2 border-accent/40 bg-accent-soft/40 lg:col-span-1">
          <Stat
            label={`${net.anyNet ? (mode === "worked" ? "Neto estimado" : "Neto previsto") : "Neto no estimado"}${combined ? " (total)" : ""}`}
            value={net.anyNet ? fmtMoney(net.cents, d.currency) : "—"}
            tone="accent"
            hint={!net.anyNet ? "Configura tus deducciones en Configuración → Salario y reglas" : net.complete ? "Lo que cobrarías, según tus deducciones" : "Incluye el bruto de trabajos sin deducciones configuradas"}
          />
        </Card>
        <Card><Stat label="Neto real (nóminas)" value={realNet !== null ? fmtMoney(realNet, d.currency) : "—"} hint={realNet !== null && net.anyNet ? `Diferencia ${fmtMoney(realNet - net.cents, d.currency)}` : "Sin nómina con neto registrada"} tone={realNet !== null && net.anyNet ? (realNet === net.cents ? "ok" : "warn") : undefined} /></Card>
        <Card><Stat label={`${mode === "worked" ? "Bruto estimado" : "Bruto previsto"}${combined ? " (total)" : ""}`} value={<span className="text-base">{fmtMoney(all.grossCents, d.currency)}</span>} hint={realTotal !== null ? `Bruto real ${fmtMoney(realTotal, d.currency)}` : "Antes de deducciones"} /></Card>
        <Card><Stat label="Horas retribuidas" value={<span className="text-base">{fmtHours(a.paid)}</span>} hint={`${a.daysWorked} días`} /></Card>
      </div>
      {combined && (
        <Card>
          <CardTitle>Por trabajo</CardTitle>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-line text-left text-xs text-fg-3"><th className="py-1.5 font-medium">Trabajo</th><th className="text-right font-medium">Horas</th><th className="text-right font-medium">Bruto</th><th className="text-right font-medium">Neto</th></tr>
              {all.perJob.map(({ jobId, result }) => {
                const n = netOf(result);
                return (
                  <tr key={jobId} className="border-b border-line/60">
                    <td className="py-2"><JobTag job={d.jobMap.get(jobId)} /></td>
                    <td className="text-right tabular text-fg-3">{fmtHours(result.analysis.paid)}</td>
                    <td className="text-right tabular text-fg-3">{fmtMoney(result.grossCents, d.currency)}</td>
                    <td className="text-right font-semibold tabular">{n.isNet ? fmtMoney(n.cents, d.currency) : <span className="text-xs font-normal text-fg-3">sin deducciones</span>}</td>
                  </tr>
                );
              })}
              <tr><td className="py-2 font-semibold">Total</td><td className="text-right tabular text-fg-3">{fmtHours(a.paid)}</td><td className="text-right tabular text-fg-3">{fmtMoney(all.grossCents, d.currency)}</td><td className="text-right text-base font-bold tabular text-accent">{net.anyNet ? fmtMoney(net.cents, d.currency) : "—"}</td></tr>
            </tbody>
          </table>
        </Card>
      )}
      {all.perJob.map(({ jobId, result: s }) => {
        const slip = slipFor(jobId);
        const an = s.analysis;
        return (
          <Card key={jobId}>
            <CardTitle action={<Button size="sm" variant="soft" icon={slip ? <Pencil className="size-4" /> : <Plus className="size-4" />} onClick={() => setSlipOpen(slip ?? emptySlip(ym, jobId))}>{slip ? "Editar nómina real" : "Registrar nómina real"}</Button>}>
              {combined ? <span className="inline-flex items-center gap-2"><JobDot job={d.jobMap.get(jobId)} />Desglose · {jobLabel(d.jobMap.get(jobId))}</span> : "Desglose"}
            </CardTitle>
            <p className="mb-3 text-xs text-fg-3">Periodo de nómina: {fmtDate(s.period.from)} – {fmtDate(s.period.to)} · Precio/hora {fmtMoney(s.hourlyCents, d.currency)} {s.hourlyDerived ? "(derivado del salario)" : "(introducido)"}{slip ? ` · Nómina real ${fmtMoney(slip.grossCents, d.currency)}` : ""}</p>
            {s.warnings.map((w) => <div key={w} className="mb-3"><Callout tone="warn">{w}</Callout></div>)}
            <Breakdown s={s} currency={d.currency} />
            <ExcessExplain s={s} contract={d.contractFor(jobId)} />
            <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-fg-2 sm:grid-cols-3 lg:grid-cols-6">
              <span>Nocturnas: <b className="tabular">{fmtHours(an.night)}</b></span>
              <span>Fin de semana: <b className="tabular">{fmtHours(an.weekend)}</b></span>
              <span>Festivas: <b className="tabular">{fmtHours(an.holiday)}</b></span>
              <span>Complementarias: <b className="tabular">{fmtHours(an.excess.complementary)}</b></span>
              <span>Extraordinarias: <b className="tabular">{fmtHours(an.excess.overtime)}</b></span>
              <span>Sin clasificar: <b className="tabular">{fmtHours(an.excess.unclassified)}</b></span>
            </div>
          </Card>
        );
      })}
      <Callout title="Importante">
        Es una estimación con los datos y reglas que has introducido. No es una nómina oficial ni incluye retenciones ni cotizaciones que no hayas configurado. Cada trabajo se calcula con su propio contrato. Revisa las reglas en <Link href="/configuracion/#salario" className="font-medium text-accent underline">Configuración → Salario</Link>.
      </Callout>
      <PayslipEditor slip={slipOpen} onClose={() => setSlipOpen(null)} currency={d.currency} />
    </div>
  );
}

/** Explica de dónde salen las horas de contrato y las horas de más del periodo de nómina. */
function ExcessExplain({ s, contract }: { s: SalaryResult; contract: Contract | null }) {
  if (!contract) return null;
  const a = s.analysis;
  const reduced = a.nominal - a.expected;
  const periodLabel = { weekly: "semanal (semana a semana, de lunes a domingo)", monthly: "mensual", custom: `personalizado (${contract.customPeriodDays} días)` }[contract.referencePeriod];
  return (
    <details className="mt-4 rounded-xl border border-line bg-surface-2/40 p-3 text-sm" open={a.excess.total > 0}>
      <summary className="cursor-pointer font-medium text-fg">Cómo se calculan las horas de más</summary>
      <dl className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        <div className="flex justify-between gap-3"><dt className="text-fg-2">Horas retribuidas del periodo</dt><dd className="font-medium tabular">{fmtHours(a.paid)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-fg-2">Horas de contrato (nominal)</dt><dd className="font-medium tabular">{fmtHours(a.nominal)}</dd></div>
        {reduced > 0 && <div className="flex justify-between gap-3"><dt className="text-fg-2">Descontadas por festivos y ausencias</dt><dd className="font-medium tabular">−{fmtHours(reduced)}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-fg-2">Horas de contrato aplicadas</dt><dd className="font-medium tabular">{fmtHours(a.expected)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-fg-2">Horas de más</dt><dd className="font-semibold tabular">{fmtHours(a.excess.total)}</dd></div>
      </dl>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-fg-3">
        <li>Periodo de referencia: {periodLabel}.{contract.referencePeriod !== "monthly" && " Con un periodo distinto del mensual, las horas de más se calculan por semanas y pueden no coincidir con «horas del mes − horas de contrato»."}</li>
        <li>Horas mensuales de referencia: {contract.monthlyMinutes ? `${fmtHours(contract.monthlyMinutes)} (introducidas por ti)` : "no indicadas (se calculan con las horas semanales × 52 ÷ 12)"}.</li>
        <li>Festivos y ausencias justificadas {contract.absencesReduceExpected ? "reducen" : "no reducen"} las horas de contrato.</li>
        <li>Turnos que pasan de medianoche: {contract.crossMidnightToStartDay ? "cuentan enteros en el día en que empiezan" : "cada hora cuenta en su día real"}.</li>
      </ul>
      <p className="mt-2 text-xs text-fg-3">Todo se cambia en Configuración → Contrato y → Salario y reglas.</p>
    </details>
  );
}

const emptySlip = (period: string, jobId: string): Payslip => ({ id: uid(), jobId, period, grossCents: 0, netCents: null, concepts: [], notes: "", createdAt: Date.now(), updatedAt: Date.now() });

function PayslipEditor({ slip, onClose, currency }: { slip: Payslip | null; onClose: () => void; currency: string }) {
  if (!slip) return null;
  return <PayslipForm key={slip.id} slip={slip} onClose={onClose} currency={currency} />;
}

function PayslipForm({ slip, onClose, currency }: { slip: Payslip; onClose: () => void; currency: string }) {
  const { toast } = useFeedback();
  const [p, setP] = useState<Payslip>(slip);
  const [hasNet, setHasNet] = useState(slip.netCents != null);
  const [err, setErr] = useState<string | null>(null);
  const sym = currencySymbol(currency);
  const { jobs } = useCalcData();
  const conceptsTotal = p.concepts.reduce((a, c) => a + c.amountCents, 0);
  return (
    <Modal open={!!slip} onClose={onClose} title="Nómina real" size="lg" footer={<Button variant="primary" onClick={async () => {
      const db = getDb();
      const clash = (await db.payslips.where("period").equals(p.period).toArray()).find((x) => x.jobId === p.jobId && x.id !== p.id);
      if (clash) { setErr("Ya hay una nómina de ese trabajo para ese mes. Edítala en lugar de crear otra."); return; }
      await db.payslips.put({ ...p, netCents: hasNet ? p.netCents ?? 0 : null, concepts: p.concepts.filter((c) => c.name.trim()), updatedAt: Date.now() });
      toast("Nómina guardada");
      onClose();
    }}>Guardar</Button>}>
      <div className="space-y-4">
        <JobSelect value={p.jobId} onChange={(v) => v && setP({ ...p, jobId: v })} jobs={jobs} />
        <div className="grid gap-3 sm:grid-cols-3">
          <LabeledInput label="Mes" type="month" value={p.period} onChange={(e) => e.target.value && setP({ ...p, period: e.target.value })} />
          <MoneyField label="Total bruto (devengado)" suffix={sym} value={p.grossCents} onChange={(v) => setP({ ...p, grossCents: v })} />
          <div className="space-y-2">
            <Toggle label="Indicar neto" checked={hasNet} onChange={setHasNet} />
            {hasNet && <MoneyField label="Líquido a percibir" suffix={sym} value={p.netCents ?? 0} onChange={(v) => setP({ ...p, netCents: v })} />}
          </div>
        </div>
        <div>
          <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium text-fg-2">Conceptos (opcional, para comparar)</span><Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setP({ ...p, concepts: [...p.concepts, { name: "", amountCents: 0 }] })}>Concepto</Button></div>
          {p.concepts.map((c, i) => (
            <div key={i} className="mb-2 flex items-end gap-2">
              <LabeledInput className="flex-1" label="Concepto" value={c.name} placeholder="Ej.: Salario base, Plus nocturnidad" onChange={(e) => setP({ ...p, concepts: p.concepts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <MoneyField className="w-36" label="Importe" suffix={sym} allowNegative value={c.amountCents} onChange={(v) => setP({ ...p, concepts: p.concepts.map((x, j) => (j === i ? { ...x, amountCents: v } : x)) })} />
              <IconButton label="Quitar" onClick={() => setP({ ...p, concepts: p.concepts.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></IconButton>
            </div>
          ))}
          {p.concepts.length > 0 && <p className="text-xs text-fg-3">Suma de conceptos: {fmtMoney(conceptsTotal, currency)}</p>}
        </div>
        <Field label="Notas"><Textarea rows={2} value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} /></Field>
        {err && <Callout tone="danger">{err}</Callout>}
      </div>
    </Modal>
  );
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^plus de |^plus /, "").trim();

function Payslips() {
  const d = useCalcData();
  const payslips = usePayslips();
  const { confirm, toast } = useFeedback();
  const [edit, setEdit] = useState<Payslip | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const today = useToday();
  const rows = useMemo(() => {
    if (!d.ready || !payslips) return [];
    return payslips.filter((p) => d.jobIds.includes(p.jobId)).map((p) => ({ p, est: computeSalary({ ...forJob(d, p.jobId), ym: p.period }) })).reverse();
  }, [d, payslips]);
  if (!payslips || !d.ready) return <Spinner />;
  const cur = d.currency;
  const sel = rows.find((r) => r.p.id === detail);

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit(emptySlip(today.slice(0, 7), d.primaryJobId))}>Añadir nómina</Button></div>
      {rows.length === 0 ? (
        <EmptyState icon={<FileText className="size-8" />} title="Sin nóminas registradas" text="Introduce el importe de tus nóminas reales para compararlas con las estimaciones y detectar diferencias." />
      ) : (
        <>
          {rows.length > 1 && (
            <Card>
              <BarChart title="Neto estimado frente a neto real" labels={[...rows].reverse().map((r) => fmtMonth(r.p.period).slice(0, 3) + " " + r.p.period.slice(2, 4))} series={[{ name: "Neto estimado", color: "var(--series-1)" }, { name: "Neto real", color: "var(--series-2)" }]} values={[...rows].reverse().map((r) => [netOf(r.est).cents / 100, (r.p.netCents ?? 0) / 100])} format={(v) => fmtMoney(Math.round(v * 100), cur).replace(/,00/, "")} />
            </Card>
          )}
          <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
            <table className="w-full min-w-[620px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-fg-3"><th className="px-4 py-2.5 font-medium">Mes</th><th className="text-right font-medium">Neto estimado</th><th className="text-right font-medium">Neto real</th><th className="text-right font-medium">Diferencia neto</th><th className="text-right font-medium">Bruto est. / real</th><th className="px-2" /></tr></thead>
              <tbody>
                {rows.map(({ p, est }) => {
                  const diff = est ? p.grossCents - est.grossCents : null;
                  const estNet = est?.netCents ?? null;
                  const netDiff = estNet !== null && p.netCents != null ? p.netCents - estNet : null;
                  return (
                    <tr key={p.id} className="border-b border-line/60 tabular">
                      <td className="px-4 py-2.5"><button type="button" className="font-medium text-accent hover:underline" onClick={() => setDetail(p.id)}>{fmtMonth(p.period)}</button>{d.multi && <div><JobTag job={d.jobMap.get(p.jobId)} /></div>}</td>
                      <td className="text-right font-medium">{estNet !== null ? fmtMoney(estNet, cur) : "—"}</td>
                      <td className="text-right font-semibold">{p.netCents != null ? fmtMoney(p.netCents, cur) : "—"}</td>
                      <td className={cx("text-right", netDiff && Math.abs(netDiff) > 100 ? "text-warn font-medium" : "text-fg-2")}>{netDiff === null ? "—" : fmtMoney(netDiff, cur)}</td>
                      <td className="text-right text-xs text-fg-3">{est ? fmtMoney(est.grossCents, cur) : "—"} / {fmtMoney(p.grossCents, cur)}{diff ? ` (${fmtMoney(diff, cur)})` : ""}</td>
                      <td className="whitespace-nowrap px-2 text-right">
                        <IconButton label="Editar" onClick={() => setEdit(p)}><Pencil className="size-4" /></IconButton>
                        <IconButton label="Eliminar" onClick={async () => { if (await confirm({ title: "Eliminar nómina", message: `¿Eliminar la nómina de ${fmtMonth(p.period)}?`, danger: true, confirmLabel: "Eliminar" })) { await getDb().payslips.delete(p.id); toast("Nómina eliminada"); } }}><Trash2 className="size-4" /></IconButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <PayslipEditor slip={edit} onClose={() => setEdit(null)} currency={cur} />
      <Modal open={!!sel} onClose={() => setDetail(null)} title={sel ? `Comparación · ${fmtMonth(sel.p.period)}` : ""} size="lg">
        {sel && <ConceptComparison p={sel.p} est={sel.est} currency={cur} />}
      </Modal>
    </div>
  );
}

function ConceptComparison({ p, est, currency }: { p: Payslip; est: SalaryResult | null; currency: string }) {
  if (!est) return <p className="text-sm text-fg-3">No hay contrato para estimar este mes.</p>;
  const lines = est.lines.filter((l) => l.kind === "earning");
  const used = new Set<string>();
  const rows: { name: string; real: number | null; est: number | null }[] = [];
  for (const c of p.concepts) {
    const n = norm(c.name);
    const match = lines.find((l) => !used.has(l.key) && (norm(l.label).includes(n) || n.includes(norm(l.label)) || (n.includes("base") && l.key === "base") || (n.includes("noct") && l.key === "night") || (n.includes("festiv") && l.key === "holiday") || (n.includes("extra") && n.includes("hora") && l.key === "overtime") || (n.includes("complementari") && l.key === "complementary")));
    if (match) used.add(match.key);
    rows.push({ name: c.name, real: c.amountCents, est: match?.amountCents ?? null });
  }
  for (const l of lines) if (!used.has(l.key)) rows.push({ name: l.label, real: null, est: l.amountCents });
  const differing = rows.filter((r) => (r.real ?? 0) !== (r.est ?? 0));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Card className="!p-3"><Stat label="Neto estimado" value={est.netCents !== null ? fmtMoney(est.netCents, currency) : "—"} tone="accent" hint={`Bruto ${fmtMoney(est.grossCents, currency)}`} /></Card>
        <Card className="!p-3"><Stat label="Neto real" value={p.netCents != null ? fmtMoney(p.netCents, currency) : "—"} hint={`Bruto ${fmtMoney(p.grossCents, currency)}`} /></Card>
        <Card className="!p-3"><Stat label="Diferencia neto" value={p.netCents != null && est.netCents !== null ? fmtMoney(p.netCents - est.netCents, currency) : "—"} tone={p.netCents != null && est.netCents !== null && p.netCents === est.netCents ? "ok" : "warn"} hint={`Bruto ${fmtMoney(p.grossCents - est.grossCents, currency)}`} /></Card>
      </div>
      {p.concepts.length === 0 && <Callout>Añade los conceptos de la nómina para ver las diferencias por concepto.</Callout>}
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-fg-3"><th className="py-2 font-medium">Concepto</th><th className="text-right font-medium">Estimado</th><th className="text-right font-medium">Real</th><th className="text-right font-medium">Diferencia</th></tr></thead>
        <tbody>
          {rows.map((r, i) => {
            const diff = (r.real ?? 0) - (r.est ?? 0);
            return (
              <tr key={i} className="border-b border-line/60 tabular">
                <td className="py-2">{r.name}</td>
                <td className="text-right">{r.est === null ? "—" : fmtMoney(r.est, currency)}</td>
                <td className="text-right">{r.real === null ? "—" : fmtMoney(r.real, currency)}</td>
                <td className={cx("text-right", diff !== 0 && "font-medium text-warn")}>{diff === 0 ? "=" : fmtMoney(diff, currency)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {differing.length > 0 && <p className="text-sm text-fg-2">{differing.length} concepto(s) con diferencias. Revisa tus reglas salariales o las horas registradas de ese mes.</p>}
      <p className="text-xs text-fg-3">La correspondencia entre conceptos se hace por nombre y es aproximada.</p>
    </div>
  );
}

function Quick() {
  const d = useCalcData();
  const today = useToday();
  const [date, setDate] = useState(today);
  const [start, setStart] = useState("20:30");
  const [end, setEnd] = useState("01:00");
  const [breaks, setBreaks] = useState<{ start: string; end: string; paid: boolean }[]>([]);
  const [rate, setRate] = useState<number | null>(null);
  const [usePremiums, setUsePremiums] = useState(true);
  const [qJob, setQJob] = useState<string | null>(null);
  const qJobId = qJob ?? d.primaryJobId;
  const qContract = d.contractFor(qJobId);
  const contractRate = qContract ? hourlyRate(qContract).cents : 0;
  const hourly = rate ?? contractRate;
  const r = useMemo(() => {
    if (!start || !end || !date) return null;
    try {
      return quickCalc({ date, start, end, breaks: breaks.filter((b) => b.start && b.end), hourlyCents: hourly, contract: usePremiums ? qContract : null, holidays: d.holidays });
    } catch {
      return null;
    }
  }, [date, start, end, breaks, hourly, usePremiums, qContract, d.holidays]);
  const sym = currencySymbol(d.currency);
  // neto aproximado: solo las deducciones en porcentaje (las fijas son mensuales y no se reparten por turno)
  const pct = (qContract?.deductions ?? []).filter((x) => x.enabled && x.type === "percent").reduce((acc, x) => acc + x.value, 0);
  const quickNet = r && pct > 0 ? r.totalCents - percentOf(r.totalCents, pct) : null;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardTitle icon={<Calculator className="size-4" />}>Datos</CardTitle>
        <div className="space-y-4">
          <JobSelect value={qJobId} onChange={(v) => { if (v) { setQJob(v); setRate(null); } }} jobs={d.jobs} label="Tarifas del trabajo" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <LabeledInput className="col-span-2 sm:col-span-1" label="Fecha" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
            <LabeledInput label="Entrada" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            <LabeledInput label="Salida" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><span className="text-sm font-medium text-fg-2">Descansos</span><Button size="sm" variant="ghost" icon={<Plus className="size-4" />} onClick={() => setBreaks([...breaks, { start: "", end: "", paid: false }])}>Añadir</Button></div>
            {breaks.map((b, i) => (
              <div key={i} className="mb-2 flex items-end gap-2">
                <LabeledInput className="flex-1" label="Inicio" type="time" value={b.start} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
                <LabeledInput className="flex-1" label="Fin" type="time" value={b.end} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
                <label className="flex h-11 items-center gap-1.5 text-xs text-fg-2"><input type="checkbox" className="size-4 accent-[var(--accent)]" checked={b.paid} onChange={(e) => setBreaks(breaks.map((x, j) => (j === i ? { ...x, paid: e.target.checked } : x)))} />Remun.</label>
                <IconButton label="Quitar" onClick={() => setBreaks(breaks.filter((_, j) => j !== i))}><Trash2 className="size-4" /></IconButton>
              </div>
            ))}
          </div>
          <MoneyField label="Precio por hora" suffix={sym} value={hourly} onChange={(v) => setRate(v)} hint={rate === null && contractRate ? "Tomado de tu contrato" : undefined} />
          <Toggle label="Aplicar pluses de mi contrato" description="Nocturnidad, fin de semana y festivos según tu configuración." checked={usePremiums} onChange={setUsePremiums} />
        </div>
      </Card>
      <Card>
        <CardTitle>Resultado</CardTitle>
        {!r || r.durations.gross <= 0 ? <p className="text-sm text-fg-3">Introduce un horario válido.</p> : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Duración bruta" value={fmtDuration(r.durations.gross)} />
              <Stat label="Descansos" value={fmtDuration(r.durations.breaks)} />
              <Stat label="Retribuida" value={fmtDuration(r.durations.paid)} tone="accent" />
            </div>
            {r.crossesMidnight && <Badge tone="accent"><Moon className="size-3" />Termina el {fmtDate(dateOf(r.block.end))} a las {timeOf(r.block.end)}</Badge>}
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b border-line/60"><td className="py-2">Horas × precio</td><td className="text-right tabular">{fmtMoney(r.baseCents, d.currency)}</td></tr>
                {r.premiums.map((p) => <tr key={p.key} className="border-b border-line/60"><td className="py-2">{p.label} <span className="text-fg-3">({fmtHours(p.minutes)})</span></td><td className="text-right tabular">{fmtMoney(p.amountCents, d.currency)}</td></tr>)}
                <tr><td className="py-2.5 font-medium text-fg-2">Importe bruto estimado</td><td className="py-2.5 text-right font-medium tabular text-fg-2">{fmtMoney(r.totalCents, d.currency)}</td></tr>
                {quickNet !== null && <tr><td className="py-3 font-bold">Neto aproximado <span className="block text-xs font-normal text-fg-3">Aplicando tus deducciones porcentuales ({fmtPercent(pct)})</span></td><td className="py-3 text-right text-xl font-bold tabular text-accent">{fmtMoney(quickNet, d.currency)}</td></tr>}
              </tbody>
            </table>
            <p className="text-xs text-fg-3">No incluye horas extra ni complementarias (dependen del total del periodo).</p>
          </div>
        )}
      </Card>
    </div>
  );
}
