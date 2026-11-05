import { defaultContract } from "@/lib/defaults";
import type { Contract, Shift } from "@/lib/types";
import { buildBlock } from "@/lib/shifts";
import { newShift } from "@/db/repo";
import { MAIN_JOB_ID } from "@/lib/jobs";

export function contract(over: Partial<Contract> = {}): Contract {
  return { ...defaultContract("2020-01-01"), ...over };
}

export function shift(date: string, start: string, end: string, opts: { jobId?: string; breaks?: { start: string; end: string; paid?: boolean }[]; status?: Shift["status"]; kind?: Shift["kind"]; actual?: [string, string]; endDate?: string } = {}): Shift {
  const planned = buildBlock({ date, start, end, endDate: opts.endDate, breaks: (opts.breaks ?? []).map((b) => ({ ...b, paid: !!b.paid })) });
  const actual = opts.actual ? buildBlock({ date, start: opts.actual[0], end: opts.actual[1], breaks: [] }) : null;
  return newShift(opts.jobId ?? MAIN_JOB_ID, date, planned, { status: opts.status ?? "done", kind: opts.kind ?? "normal", actual });
}
