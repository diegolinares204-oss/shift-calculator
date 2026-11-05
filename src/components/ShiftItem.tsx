"use client";

import { CheckCircle2, Moon, Pencil } from "lucide-react";
import type { Shift } from "@/lib/types";
import { Badge, IconButton, cx, useFeedback } from "./ui";
import { SHIFT_KIND_LABELS, SHIFT_STATUS_LABELS, blockDurations, comparePlannedActual } from "@/lib/shifts";
import { dateOf, fmtDayShort, fmtDuration, fmtSignedHours, timeOf } from "@/lib/time";
import { saveShift } from "@/db/repo";
import { useJobs } from "@/lib/hooks";
import { JobTag } from "./jobs";

export const STATUS_TONE = { planned: "accent", done: "ok", cancelled: "neutral" } as const;

export function ShiftItem({ shift, onEdit, showDate = true }: { shift: Shift; onEdit: (s: Shift) => void; showDate?: boolean }) {
  const { toast } = useFeedback();
  const jobs = useJobs();
  const job = jobs?.find((j) => j.id === shift.jobId);
  const block = shift.status === "done" && shift.actual ? shift.actual : shift.planned;
  const d = blockDurations(block);
  const cmp = comparePlannedActual(shift);
  const crosses = dateOf(block.end) !== dateOf(block.start);
  const markDone = async () => {
    await saveShift({ ...shift, status: "done" });
    toast("Turno marcado como realizado");
  };
  return (
    <div className={cx("group flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 transition-colors hover:border-accent/40", shift.status === "cancelled" && "opacity-60")}>
      <div className={cx("h-10 w-1 shrink-0 rounded-full", shift.status === "done" ? "bg-ok" : shift.status === "planned" ? "bg-accent" : "bg-line")} aria-hidden />
      <button type="button" onClick={() => onEdit(shift)} className="min-w-0 flex-1 text-left" aria-label={`Editar turno ${fmtDayShort(shift.date)} ${timeOf(block.start)}`}>
        {(showDate || (jobs && jobs.length > 1)) && (
          <div className="flex flex-wrap items-center gap-x-2 text-xs font-medium text-fg-3">
            {showDate && <span className="capitalize">{fmtDayShort(shift.date)}</span>}
            {jobs && jobs.length > 1 && <JobTag job={job} />}
          </div>
        )}
        <div className={cx("flex flex-wrap items-center gap-x-2 text-[15px] font-semibold tabular", shift.status === "cancelled" && "line-through")}>
          {timeOf(block.start)} – {timeOf(block.end)}
          {crosses && <span className="inline-flex items-center gap-0.5 text-xs font-medium text-fg-3"><Moon className="size-3" />+1</span>}
          <span className="text-sm font-normal text-fg-3">· {fmtDuration(d.paid)}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone={STATUS_TONE[shift.status]}>{SHIFT_STATUS_LABELS[shift.status]}</Badge>
          {shift.kind !== "normal" && <Badge>{SHIFT_KIND_LABELS[shift.kind]}</Badge>}
          {cmp && cmp.diff !== 0 && <Badge tone={cmp.diff > 0 ? "warn" : "neutral"}>Real {fmtSignedHours(cmp.diff)}</Badge>}
          {d.breaks > 0 && <span className="text-xs text-fg-3">Descanso {fmtDuration(d.breaks)}</span>}
          {shift.tags.map((t) => <span key={t} className="text-xs text-fg-3">#{t}</span>)}
        </div>
      </button>
      <div className="flex shrink-0 items-center">
        {shift.status === "planned" && (
          <IconButton label="Marcar como realizado" onClick={markDone} className="text-ok hover:text-ok"><CheckCircle2 className="size-5" /></IconButton>
        )}
        <IconButton label="Editar" onClick={() => onEdit(shift)}><Pencil className="size-4" /></IconButton>
      </div>
    </div>
  );
}
