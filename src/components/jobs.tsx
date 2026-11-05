"use client";

import { useId } from "react";
import { Briefcase } from "lucide-react";
import type { Job } from "@/lib/types";
import { jobLabel } from "@/lib/jobs";
import { useJobs, useSettings } from "@/lib/hooks";
import { getDb } from "@/db/repo";
import { Field, Select, cx } from "./ui";

export function JobDot({ job, className }: { job?: Job | null; className?: string }) {
  return <span aria-hidden className={cx("inline-block size-2.5 shrink-0 rounded-full", className)} style={{ background: job?.color ?? "var(--fg-3)" }} />;
}

/** Nombre del trabajo con su color (el texto nunca toma el color, solo el punto). */
export function JobTag({ job }: { job?: Job | null }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 truncate text-xs font-medium text-fg-2">
      <JobDot job={job} />
      <span className="truncate">{jobLabel(job)}</span>
    </span>
  );
}

export async function setActiveJob(id: string) {
  const db = getDb();
  const s = await db.settings.get("app");
  if (s) await db.settings.put({ ...s, activeJobId: id, updatedAt: Date.now() });
}

/** Selector global de trabajo. Solo aparece si hay más de un trabajo. */
export function JobSwitcher() {
  const jobs = useJobs();
  const settings = useSettings();
  if (!jobs || jobs.length < 2 || !settings) return null;
  const active = jobs.some((j) => j.id === settings.activeJobId) ? settings.activeJobId : "all";
  const visible = jobs.filter((j) => !j.archived || j.id === active);
  return (
    <div role="radiogroup" aria-label="Trabajo" className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {[{ id: "all", label: "Todos", job: null as Job | null }, ...visible.map((j) => ({ id: j.id, label: jobLabel(j), job: j }))].map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={active === o.id}
          onClick={() => setActiveJob(o.id)}
          className={cx("inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors", active === o.id ? "border-accent bg-accent-soft text-fg" : "border-line bg-surface text-fg-2 hover:text-fg")}
        >
          {o.job ? <JobDot job={o.job} /> : <Briefcase className="size-3.5" />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Campo para elegir el trabajo de un registro. Oculto si solo hay un trabajo (salvo con «Todos»). */
export function JobSelect({ value, onChange, jobs, label = "Trabajo", allowAll, allLabel = "Todos los trabajos", className, alwaysShow }: { value: string | null; onChange: (v: string | null) => void; jobs: Job[]; label?: string; allowAll?: boolean; allLabel?: string; className?: string; alwaysShow?: boolean }) {
  const id = useId();
  if (jobs.length < 2 && !alwaysShow) return null;
  const list = jobs.filter((j) => !j.archived || j.id === value);
  return (
    <Field label={label} htmlFor={id} className={className}>
      <Select id={id} value={value ?? "*"} onChange={(e) => onChange(e.target.value === "*" ? null : e.target.value)}>
        {allowAll && <option value="*">{allLabel}</option>}
        {list.map((j) => <option key={j.id} value={j.id}>{jobLabel(j)}</option>)}
      </Select>
    </Field>
  );
}
