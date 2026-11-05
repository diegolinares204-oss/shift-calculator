"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, FileDown } from "lucide-react";
import { Button, Card, CardTitle, LabeledInput, LabeledSelect, PageHeader, Segmented, Spinner, Stat, useFeedback, Badge, cx } from "@/components/ui";
import { BarChart, LineChart } from "@/components/charts";
import { useAdjustments, useCalcData, useClockBreaks, usePayslips, useSessions, useToday } from "@/lib/hooks";
import { computeBank } from "@/lib/engine";
import { analyzeJobs, forJob, jobLabel, netJobs, netOf, payslipsNetTotal, payslipsTotal, salaryJobs } from "@/lib/jobs";
import { addDays, addMonths, diffDays, endOfMonth, fmtDate, fmtHours, fmtMonth, fmtSignedHours, startOfWeek } from "@/lib/time";
import { fmtMoney } from "@/lib/money";
import { buildReport, REPORT_LABELS, type ReportKind } from "@/lib/reports";
import { downloadBlob, reportToCsv, reportToPdf, reportToXlsx } from "@/lib/exporters";

const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mLabel = (ym: string) => `${MONTHS_SHORT[Number(ym.slice(5)) - 1]} ${ym.slice(2, 4)}`;

export function StatsView() {
  const d = useCalcData();
  const payslips = usePayslips();
  const adjustments = useAdjustments();
  const today = useToday();
  const exportRef = useRef<HTMLDivElement>(null);
  const curYm = today.slice(0, 7);
  const [cmpA, setCmpA] = useState(curYm);
  const [cmpB, setCmpB] = useState(addMonths(curYm, -1));

  useEffect(() => {
    if (window.location.hash === "#exportar") setTimeout(() => exportRef.current?.scrollIntoView({ behavior: "smooth" }), 300);
  }, []);

  const data = useMemo(() => {
    if (!d.ready || !payslips) return null;
    const base = { shifts: d.shifts, contracts: d.contracts, holidays: d.holidays, absences: d.absences };
    const months = Array.from({ length: 12 }, (_, i) => addMonths(curYm, i - 11));
    const ids = d.jobIds;
    const monthStats = months.map((ym) => {
      const sj = salaryJobs(base, ids, ym);
      const sal = sj.perJob.length ? sj : null;
      const from = `${ym}-01`;
      const to = endOfMonth(ym);
      const worked = analyzeJobs(base, ids, from, to, "worked");
      const planned = analyzeJobs(base, ids, from, to, "planned");
      const real = payslipsTotal(payslips, ids, ym);
      const slip = real === null ? null : { grossCents: real };
      const perJobGross = d.jobs.map((j) => (ids.includes(j.id) ? sj.perJob.find((x) => x.jobId === j.id)?.result.grossCents ?? 0 : 0));
      const perJobNet = d.jobs.map((j) => (ids.includes(j.id) ? netOf(sj.perJob.find((x) => x.jobId === j.id)?.result).cents : 0));
      const net = sal ? netJobs(sal) : null;
      const realNet = payslipsNetTotal(payslips, ids, ym);
      const lastDay = to < today ? to : today;
      const elapsed = from > today ? 0 : diffDays(from, lastDay) + 1;
      return { ym, sal, net, realNet, worked, planned, slip, perJobGross, perJobNet, daysOff: Math.max(0, elapsed - Object.keys(worked.byDay).filter((k) => k <= lastDay && worked.byDay[k].paid > 0).length) };
    });
    const weeks = Array.from({ length: 12 }, (_, i) => addDays(startOfWeek(today), (i - 11) * 7)).map((w) => ({ w, a: analyzeJobs(base, ids, w, addDays(w, 6), "worked") }));
    // la bolsa de horas es de cada trabajo: se muestra cuando hay un único trabajo en el ámbito
    let bank: ReturnType<typeof computeBank> = [];
    if (ids.length === 1) {
      const job = d.jobMap.get(ids[0]);
      const jd = forJob(base, ids[0]);
      const first = [...jd.contracts].sort((x, y) => x.validFrom.localeCompare(y.validFrom))[0];
      bank = computeBank({ ...jd, adjustments: (adjustments ?? []).filter((a) => a.jobId === ids[0]), startDate: job?.bankStartDate || first?.validFrom || today, initialMinutes: job?.bankInitialMinutes ?? 0, until: today, today });
    }
    const monthToDate = analyzeJobs(base, ids, `${curYm}-01`, today, "worked");
    return { months, monthStats, weeks, bank, monthToDate };
  }, [d, payslips, adjustments, curYm, today]);

  const byYm = (ym: string) => {
    if (!d.ready) return null;
    const base = { shifts: d.shifts, contracts: d.contracts, holidays: d.holidays, absences: d.absences };
    const sj = salaryJobs(base, d.jobIds, ym);
    const worked = analyzeJobs(base, d.jobIds, `${ym}-01`, endOfMonth(ym), "worked");
    const real = payslipsTotal(payslips ?? [], d.jobIds, ym);
    return { sal: sj.perJob.length ? sj : null, net: sj.perJob.length ? netJobs(sj) : null, realNet: payslipsNetTotal(payslips ?? [], d.jobIds, ym), worked, slip: real === null ? null : { grossCents: real } };
  };
  const A = useMemo(() => byYm(cmpA), [cmpA, d, payslips]); // eslint-disable-line react-hooks/exhaustive-deps
  const B = useMemo(() => byYm(cmpB), [cmpB, d, payslips]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <Spinner />;
  const cur = data.monthStats[11];
  const prev = data.monthStats[10];
  const c = d.currency;
  const h1 = (m: number) => Math.round((m / 60) * 10) / 10;
  const fmtH = (v: number) => `${v.toLocaleString("es-ES", { maximumFractionDigits: 1 })} h`;
  const fmtE = (v: number) => fmtMoney(Math.round(v * 100), c).replace(/,00(?=\s)/, "");
  const delta = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));

  return (
    <div className="space-y-5">
      <PageHeader title="Estadísticas" subtitle={`${fmtMonth(curYm)} comparado con ${fmtMonth(prev.ym).toLowerCase()}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Horas trabajadas (mes)" value={fmtHours(cur.worked.paid)} d={delta(cur.worked.paid, prev.worked.paid)} />
        <Kpi label={cur.net?.anyNet ? "Neto estimado (mes)" : "Salario bruto (mes)"} value={cur.net ? fmtMoney(cur.net.cents, c) : "—"} d={cur.net && prev.net ? delta(cur.net.cents, prev.net.cents) : null} hint={cur.sal && cur.net?.anyNet ? `Bruto ${fmtMoney(cur.sal.grossCents, c)}` : cur.sal ? "Configura deducciones para ver el neto" : undefined} accent />
        <Kpi label="Neto real (nómina)" value={cur.realNet !== null ? fmtMoney(cur.realNet, c) : "—"} hint={cur.realNet !== null && cur.net?.anyNet ? `Dif. ${fmtMoney(cur.realNet - cur.net.cents, c)}${cur.slip ? ` · bruto ${fmtMoney(cur.slip.grossCents, c)}` : ""}` : "Sin nómina con neto este mes"} />
        <Kpi label="Contrato vs. realizadas" value={fmtSignedHours(data.monthToDate.paid - data.monthToDate.expected)} hint={`Mes hasta hoy · contrato ${fmtHours(data.monthToDate.expected)}`} />
        <Kpi label="Días trabajados" value={String(cur.worked.daysWorked)} hint={`${cur.daysOff} días libres hasta hoy`} d={delta(cur.worked.daysWorked, prev.worked.daysWorked)} />
        <Kpi label="Horas nocturnas" value={fmtHours(cur.worked.night)} />
        <Kpi label="Horas de fin de semana" value={fmtHours(cur.worked.weekend)} />
        <Kpi label="Horas festivas" value={fmtHours(cur.worked.holiday)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><BarChart title="Horas por semana (últimas 12)" labels={data.weeks.map((w) => fmtDate(w.w).slice(0, 5))} series={[{ name: "Contrato", color: "var(--series-1)" }, { name: "Realizadas", color: "var(--series-2)" }]} values={data.weeks.map((w) => [h1(w.a.expected), h1(w.a.paid)])} format={fmtH} /></Card>
        <Card><BarChart title="Horas por mes" labels={data.months.map(mLabel)} series={[{ name: "Contrato", color: "var(--series-1)" }, { name: "Realizadas", color: "var(--series-2)" }]} values={data.monthStats.map((m) => [h1(m.worked.expected), h1(m.worked.paid)])} format={fmtH} /></Card>
        <Card><BarChart title="Neto estimado frente a neto real" labels={data.months.map(mLabel)} series={[{ name: "Neto estimado", color: "var(--series-1)" }, { name: "Neto real", color: "var(--series-2)" }]} values={data.monthStats.map((m) => [(m.net?.cents ?? 0) / 100, (m.realNet ?? 0) / 100])} format={fmtE} /></Card>
        <Card>
          {data.bank.length ? (
            <LineChart title="Evolución de la bolsa de horas" labels={data.bank.slice(-16).map((r) => fmtDate(r.period.from).slice(0, 5))} values={data.bank.slice(-16).map((r) => h1(r.balance))} format={fmtH} />
          ) : <p className="text-sm text-fg-3">{d.jobIds.length > 1 ? "La bolsa de horas es independiente en cada trabajo: elige un trabajo arriba para verla." : "La bolsa de horas aún no tiene periodos."}</p>}
        </Card>
        {d.multi && d.scope === "all" && (
          <Card className="lg:col-span-2"><BarChart title="Neto estimado por trabajo" labels={data.months.map(mLabel)} series={d.jobs.slice(0, 8).map((j) => ({ name: jobLabel(j), color: j.color }))} values={data.monthStats.map((m) => m.perJobNet.slice(0, 8).map((v) => v / 100))} format={fmtE} /></Card>
        )}
        <Card className="lg:col-span-2"><BarChart title="Horas nocturnas, de fin de semana y festivas por mes" labels={data.months.map(mLabel)} series={[{ name: "Nocturnas", color: "var(--series-1)" }, { name: "Fin de semana", color: "var(--series-2)" }, { name: "Festivas", color: "var(--series-3)" }]} values={data.monthStats.map((m) => [h1(m.worked.night), h1(m.worked.weekend), h1(m.worked.holiday)])} format={fmtH} /></Card>
      </div>

      <Card>
        <CardTitle>Comparar meses</CardTitle>
        <div className="mb-4 grid grid-cols-2 gap-3 sm:w-96">
          <LabeledInput label="Mes A" type="month" value={cmpA} onChange={(e) => e.target.value && setCmpA(e.target.value)} />
          <LabeledInput label="Mes B" type="month" value={cmpB} onChange={(e) => e.target.value && setCmpB(e.target.value)} />
        </div>
        {A && B && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-fg-3"><th className="py-2 font-medium">Indicador</th><th className="text-right font-medium">{fmtMonth(cmpA)}</th><th className="text-right font-medium">{fmtMonth(cmpB)}</th><th className="text-right font-medium">Diferencia</th></tr></thead>
              <tbody className="tabular">
                {[
                  ["Horas realizadas", A.worked.paid, B.worked.paid, "h"],
                  ["Horas contratadas", A.worked.expected, B.worked.expected, "h"],
                  ["Diferencia con contrato", A.worked.paid - A.worked.expected, B.worked.paid - B.worked.expected, "h"],
                  ["Días trabajados", A.worked.daysWorked, B.worked.daysWorked, "n"],
                  ["Horas nocturnas", A.worked.night, B.worked.night, "h"],
                  ["Horas fin de semana", A.worked.weekend, B.worked.weekend, "h"],
                  ["Horas festivas", A.worked.holiday, B.worked.holiday, "h"],
                  ["Neto estimado", A.net?.cents ?? 0, B.net?.cents ?? 0, "€"],
                  ["Neto real", A.realNet, B.realNet, "€"],
                  ["Bruto estimado", A.sal?.grossCents ?? 0, B.sal?.grossCents ?? 0, "€"],
                  ["Bruto real", A.slip?.grossCents ?? null, B.slip?.grossCents ?? null, "€"],
                ].map(([label, a, b, kind]) => {
                  const f = (v: number | null) => (v === null ? "—" : kind === "h" ? fmtHours(v as number) : kind === "€" ? fmtMoney(v as number, c) : String(v));
                  const diff = a === null || b === null ? null : (a as number) - (b as number);
                  return (
                    <tr key={label as string} className="border-b border-line/60">
                      <td className="py-2">{label as string}</td>
                      <td className="text-right">{f(a as number | null)}</td>
                      <td className="text-right">{f(b as number | null)}</td>
                      <td className={cx("text-right font-medium", diff && diff > 0 ? "text-ok" : diff && diff < 0 ? "text-danger" : "text-fg-3")}>{diff === null ? "—" : kind === "h" ? fmtSignedHours(diff) : kind === "€" ? fmtMoney(diff, c) : (diff > 0 ? "+" : "") + diff}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div ref={exportRef} id="exportar" className="scroll-mt-6"><ExportPanel /></div>
    </div>
  );
}

function Kpi({ label, value, d, hint, accent }: { label: string; value: string; d?: number | null; hint?: string; accent?: boolean }) {
  return (
    <Card className={accent ? "border-accent/40 bg-accent-soft/40" : undefined}>
      <Stat label={label} value={value} hint={
        <>
          {hint && <span className="block">{hint}</span>}
          {d === null || d === undefined ? (!hint && "Sin comparación") : <span className={cx("block", d > 0 ? "text-ok" : d < 0 ? "text-danger" : "")}>{d > 0 ? "▲" : d < 0 ? "▼" : "="} {Math.abs(d)} % vs. mes anterior</span>}
        </>
      } />
    </Card>
  );
}

function ExportPanel() {
  const d = useCalcData();
  const sessions = useSessions();
  const breaks = useClockBreaks();
  const payslips = usePayslips();
  const today = useToday();
  const { toast } = useFeedback();
  const [kind, setKind] = useState<ReportKind>("monthly");
  const [preset, setPreset] = useState<"this" | "prev" | "year" | "custom">("this");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(endOfMonth(today.slice(0, 7)));
  const [busy, setBusy] = useState<string | null>(null);

  const applyPreset = (p: typeof preset) => {
    setPreset(p);
    const ym = today.slice(0, 7);
    if (p === "this") { setFrom(`${ym}-01`); setTo(endOfMonth(ym)); }
    if (p === "prev") { const pm = addMonths(ym, -1); setFrom(`${pm}-01`); setTo(endOfMonth(pm)); }
    if (p === "year") { setFrom(`${ym.slice(0, 4)}-01-01`); setTo(`${ym.slice(0, 4)}-12-31`); }
  };

  const ready = d.ready && sessions && breaks && payslips;
  const run = async (fmt: "pdf" | "csv" | "xlsx") => {
    if (!ready || to < from) return;
    setBusy(fmt);
    try {
      const r = buildReport(kind, { profile: d.profile, jobs: d.jobs, contracts: d.contracts, shifts: d.shifts, sessions: sessions!, breaks: breaks!, holidays: d.holidays, absences: d.absences, payslips: payslips! }, from, to, d.jobIds);
      const name = `shift-calculator_${kind}_${from}_${to}`;
      if (fmt === "csv") downloadBlob(new Blob([reportToCsv(r)], { type: "text/csv;charset=utf-8" }), `${name}.csv`);
      if (fmt === "xlsx") downloadBlob(new Blob([reportToXlsx(r) as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${name}.xlsx`);
      if (fmt === "pdf") downloadBlob(await reportToPdf(r), `${name}.pdf`);
      toast("Informe generado");
    } catch (e) {
      toast(e instanceof Error ? e.message : "No se pudo generar el informe", "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardTitle icon={<Download className="size-4" />}>Exportar informes</CardTitle>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <LabeledSelect label="Informe" value={kind} onChange={(e) => { const k = e.target.value as ReportKind; setKind(k); if (k === "annual") applyPreset("year"); }}>
            {Object.entries(REPORT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </LabeledSelect>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-fg-2">Periodo</span>
            <Segmented ariaLabel="Periodo rápido" value={preset} onChange={applyPreset} options={[{ value: "this", label: "Este mes" }, { value: "prev", label: "Anterior" }, { value: "year", label: "Año" }, { value: "custom", label: "Otro" }]} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:w-96">
          <LabeledInput label="Desde" type="date" value={from} onChange={(e) => { if (e.target.value) { setFrom(e.target.value); setPreset("custom"); } }} />
          <LabeledInput label="Hasta" type="date" value={to} min={from} onChange={(e) => { if (e.target.value) { setTo(e.target.value); setPreset("custom"); } }} />
        </div>
        {to < from && <Badge tone="danger">La fecha final es anterior a la inicial</Badge>}
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<FileDown className="size-4" />} loading={busy === "pdf"} disabled={!ready || to < from} onClick={() => run("pdf")}>PDF</Button>
          <Button icon={<FileSpreadsheet className="size-4" />} loading={busy === "xlsx"} disabled={!ready || to < from} onClick={() => run("xlsx")}>Excel</Button>
          <Button icon={<FileText className="size-4" />} loading={busy === "csv"} disabled={!ready || to < from} onClick={() => run("csv")}>CSV</Button>
        </div>
        <p className="text-xs text-fg-3">Los archivos se generan en tu dispositivo. En iPhone, el archivo se abre en una vista previa desde la que puedes guardarlo o compartirlo.</p>
      </div>
    </Card>
  );
}
