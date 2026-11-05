"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarClock, Calculator, Download, Plus, Palmtree, Target, Timer, ArrowRight } from "lucide-react";
import { Card, CardTitle, Stat, Button, Badge, Skeleton, Callout } from "@/components/ui";
import { ClockWidget } from "@/components/ClockWidget";
import { ShiftEditor } from "@/components/ShiftEditor";
import { Meter } from "@/components/charts";
import { useCalcData, useSettings, useToday, useNow } from "@/lib/hooks";
import { analyzeJobs, netJobs, netOf, salaryJobs } from "@/lib/jobs";
import { PersistentStorageBanner } from "@/components/PersistentStorage";
import { JobTag } from "@/components/jobs";
import { addDays, endOfMonth, endOfWeek, fmtDate, fmtDateLong, fmtDayShort, fmtDuration, fmtHours, fmtSignedHours, startOfWeek, timeOf, toEpoch, diffDays } from "@/lib/time";
import { fmtMoney } from "@/lib/money";
import { blockDurations, sortShifts } from "@/lib/shifts";
import type { Shift } from "@/lib/types";

function greeting(h: number) {
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buenos días";
  if (h < 21) return "Buenas tardes";
  return "Buenas noches";
}

export function HomeView() {
  const d = useCalcData();
  const settings = useSettings();
  const today = useToday();
  const now = useNow(60_000);
  const [editor, setEditor] = useState<{ open: boolean; shift?: Shift | null }>({ open: false });

  const ym = today.slice(0, 7);
  const calc = useMemo(() => {
    if (!d.ready) return null;
    const base = { shifts: d.shifts, contracts: d.contracts, holidays: d.holidays, absences: d.absences };
    const ids = d.jobIds;
    const wFrom = startOfWeek(today);
    const wTo = endOfWeek(today);
    const weekWorked = analyzeJobs(base, ids, wFrom, wTo, "worked");
    const weekPlanned = analyzeJobs(base, ids, wFrom, wTo, "planned");
    // contrato esperado solo hasta hoy, para que la diferencia no penalice los días que aún no han llegado
    const weekToDate = analyzeJobs(base, ids, wFrom, today, "worked");
    const s1 = salaryJobs(base, ids, ym);
    const s2 = salaryJobs(base, ids, ym, "planned");
    const salary = s1.perJob.length ? s1 : null;
    const salaryPlanned = s2.perJob.length ? s2 : null;
    const monthWorked = analyzeJobs(base, ids, `${ym}-01`, endOfMonth(ym), "worked");
    const perJob = d.multi && d.scope === "all"
      ? d.jobs.filter((j) => !j.archived).map((j) => ({ job: j, hours: analyzeJobs(base, [j.id], `${ym}-01`, endOfMonth(ym), "worked").paid, gross: s1.perJob.find((x) => x.jobId === j.id)?.result.grossCents ?? 0, net: netOf(s1.perJob.find((x) => x.jobId === j.id)?.result) }))
      : [];
    const inScope = d.shifts.filter((s) => ids.includes(s.jobId));
    const upcoming = sortShifts(inScope.filter((s) => s.status === "planned" && toEpoch(s.planned.end) > now))[0] ?? null;
    const todays = sortShifts(inScope.filter((s) => s.date === today && s.status !== "cancelled"));
    const nextVacation = d.absences.filter((a) => a.type === "vacation" && a.status !== "rejected" && a.startDate >= today && (!a.jobId || ids.includes(a.jobId))).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
    const net = salary ? netJobs(salary) : null;
    const netPlanned = salaryPlanned ? netJobs(salaryPlanned) : null;
    return { net, netPlanned, weekWorked, weekPlanned, weekToDate, salary, salaryPlanned, monthWorked, perJob, upcoming, todays, nextVacation };
  }, [d, today, ym, now]);

  const hour = new Date(now).getHours();
  const name = d.profile?.name?.trim();
  const goal = settings?.reminders.weeklyHoursGoal ?? 0;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-fg-3">{fmtDateLong(today)}</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{greeting(hour)}{name ? `, ${name}` : ""}</h1>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
        <ClockWidget />
        <Card>
          <CardTitle icon={<CalendarClock className="size-4" />} action={<Link href="/turnos/" className="text-sm font-medium text-accent">Ver turnos</Link>}>Próximo turno</CardTitle>
          {!calc ? <Skeleton className="h-16" /> : calc.upcoming ? (
            <button type="button" className="w-full text-left" onClick={() => setEditor({ open: true, shift: calc.upcoming })}>
              {d.multi && <JobTag job={d.jobMap.get(calc.upcoming.jobId)} />}
              <p className="text-sm capitalize text-fg-3">{calc.upcoming.date === today ? "Hoy" : calc.upcoming.date === addDays(today, 1) ? "Mañana" : fmtDayShort(calc.upcoming.date)}</p>
              <p className="text-2xl font-semibold tabular">{timeOf(calc.upcoming.planned.start)} – {timeOf(calc.upcoming.planned.end)}</p>
              <p className="mt-1 text-sm text-fg-3">{fmtDuration(blockDurations(calc.upcoming.planned).paid)} retribuidas{calc.upcoming.notes ? ` · ${calc.upcoming.notes}` : ""}</p>
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-fg-3">No tienes turnos previstos próximamente.</p>
              <Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={() => setEditor({ open: true, shift: null })}>Añadir turno</Button>
            </div>
          )}
          {calc && calc.todays.length > 1 && <p className="mt-3 text-xs text-fg-3">Hoy tienes {calc.todays.length} turnos.</p>}
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {!calc ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-28" />) : (
          <>
            <Card className="space-y-2">
              <Stat label="Horas esta semana" value={fmtHours(calc.weekWorked.paid)} hint={`Previstas ${fmtHours(calc.weekPlanned.paid)}`} />
              {calc.weekWorked.expected > 0 && <Meter value={calc.weekWorked.paid} max={calc.weekWorked.expected} label="Horas de la semana frente al contrato" />}
            </Card>
            <Card className="space-y-2">
              <Stat label="Horas este mes" value={fmtHours(calc.monthWorked.paid)} hint={calc.monthWorked.expected ? `Contrato ${fmtHours(calc.monthWorked.expected)}` : "Realizadas"} />
              {calc.monthWorked.expected > 0 && <Meter value={calc.monthWorked.paid} max={calc.monthWorked.expected} label="Horas del mes frente al contrato" />}
            </Card>
            <Card>
              <Stat
                label={calc.net && !calc.net.anyNet ? "Salario bruto (mes)" : "Neto estimado (mes)"}
                value={calc.salary && calc.net ? fmtMoney(calc.net.cents, d.currency) : "—"}
                hint={calc.salary ? (
                  <>
                    {calc.net && calc.net.anyNet && <span className="block">Bruto {fmtMoney(calc.salary.grossCents, d.currency)}</span>}
                    {calc.netPlanned && <span className="block">Previsión del mes {fmtMoney(calc.netPlanned.cents, d.currency)}</span>}
                    {calc.net && !calc.net.complete && <span className="block">{calc.net.anyNet ? "Incluye bruto de trabajos sin deducciones" : "Configura deducciones para ver el neto"}</span>}
                  </>
                ) : "Configura tu contrato"}
                tone="accent"
              />
            </Card>
            <Card>
              <Stat
                label="Diferencia vs. contrato"
                value={calc.weekToDate.expected || calc.weekToDate.paid ? fmtSignedHours(calc.weekToDate.paid - calc.weekToDate.expected) : "—"}
                hint={calc.weekToDate.expected ? `Semana hasta hoy · contrato ${fmtHours(calc.weekToDate.expected)}` : "Sin horas contratadas hasta hoy"}
                tone={calc.weekToDate.paid - calc.weekToDate.expected > 0 ? "warn" : undefined}
              />
            </Card>
          </>
        )}
      </div>

      {calc && calc.perJob.length > 0 && (
        <Card>
          <CardTitle>Este mes por trabajo</CardTitle>
          <ul className="divide-y divide-line">
            {calc.perJob.map((x) => (
              <li key={x.job.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <JobTag job={x.job} />
                <span className="text-right tabular text-fg-2">
                  <b className="text-base text-fg">{fmtMoney(x.net.cents, d.currency)}</b>{x.net.isNet ? " neto" : " bruto"}
                  <span className="block text-xs text-fg-3">{fmtHours(x.hours)}{x.net.isNet ? ` · bruto ${fmtMoney(x.gross, d.currency)}` : ""}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {calc?.nextVacation && diffDays(today, calc.nextVacation.startDate) <= 30 && (
        <Callout tone="ok" title="Vacaciones próximas">
          Del {fmtDate(calc.nextVacation.startDate)} al {fmtDate(calc.nextVacation.endDate)} <Badge tone={calc.nextVacation.status === "requested" ? "warn" : "ok"}>{calc.nextVacation.status === "requested" ? "Solicitadas" : "Aprobadas"}</Badge>
        </Callout>
      )}
      {goal > 0 && calc && (
        <Card>
          <CardTitle icon={<Target className="size-4" />}>Objetivo semanal: {fmtHours(goal)}</CardTitle>
          <Meter value={calc.weekWorked.paid} max={goal} label="Objetivo semanal de horas" />
          <p className="mt-2 text-sm text-fg-3">{calc.weekWorked.paid >= goal ? "¡Objetivo alcanzado!" : `Te faltan ${fmtHours(goal - calc.weekWorked.paid)}.`}</p>
        </Card>
      )}

      <PersistentStorageBanner />

      <section aria-label="Accesos rápidos">
        <h2 className="mb-2 text-sm font-semibold text-fg-2">Accesos rápidos</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <QuickAction onClick={() => setEditor({ open: true, shift: null })} icon={<Plus className="size-5" />} label="Nuevo turno" />
          <QuickAction href="/control-horario/" icon={<Timer className="size-5" />} label="Control horario" />
          <QuickAction href="/salario/#rapida" icon={<Calculator className="size-5" />} label="Calculadora rápida" />
          <QuickAction href="/estadisticas/#exportar" icon={<Download className="size-5" />} label="Exportar informe" />
          <QuickAction href="/ausencias/" icon={<Palmtree className="size-5" />} label="Vacaciones" />
        </div>
      </section>

      {d.ready && d.contract && d.contract.weeklyMinutes === 0 && d.contract.hourlyRateCents === 0 && d.contract.monthlyGrossCents === 0 && (
        <Callout title="Completa tu contrato">
          Para calcular horas pendientes y salario, indica tus horas contratadas y tu salario en <Link className="font-medium text-accent underline" href="/configuracion/">Configuración</Link>.
        </Callout>
      )}

      <ShiftEditor open={editor.open} shift={editor.shift} defaultDate={today} defaultJobId={d.primaryJobId} onClose={() => setEditor({ open: false })} />
    </div>
  );
}

function QuickAction({ href, onClick, icon, label }: { href?: string; onClick?: () => void; icon: React.ReactNode; label: string }) {
  const cls = "flex min-h-[72px] items-center gap-3 rounded-2xl border text-left border-line bg-surface p-3 text-sm font-medium text-fg shadow-card transition-colors hover:border-accent/40";
  const inner = (
    <>
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      <ArrowRight className="size-4 shrink-0 text-fg-3" />
    </>
  );
  return href ? <Link href={href} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cls}>{inner}</button>;
}
