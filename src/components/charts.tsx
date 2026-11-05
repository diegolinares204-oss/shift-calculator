"use client";

import { useId, useMemo, useState } from "react";
import { Table2, BarChart3 } from "lucide-react";
import { IconButton } from "./ui";

export interface Series { name: string; color: string }

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

function Legend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-2">
      {series.map((s) => (
        <span key={s.name} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

function DataTable({ labels, series, values, format }: { labels: string[]; series: Series[]; values: number[][]; format: (v: number) => string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-3">
            <th className="py-2 pr-3 font-medium">Periodo</th>
            {series.map((s) => <th key={s.name} className="py-2 pr-3 text-right font-medium">{s.name}</th>)}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l + i} className="border-b border-line/60">
              <td className="py-1.5 pr-3 text-fg-2">{l}</td>
              {series.map((s, j) => <td key={s.name} className="py-1.5 pr-3 text-right tabular">{format(values[i][j])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Barras agrupadas. values[i][j] = valor de la serie j en la categoría i. */
export function BarChart({ title, labels, series, values, format, height = 220 }: { title: string; labels: string[]; series: Series[]; values: number[][]; format: (v: number) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const W = 640;
  const H = height;
  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const max = useMemo(() => niceMax(Math.max(0, ...values.flat())), [values]);
  const min = useMemo(() => Math.min(0, ...values.flat()), [values]);
  const lo = min < 0 ? -niceMax(-min) : 0;
  const y = (v: number) => pad.t + ((max - v) / (max - lo)) * (H - pad.t - pad.b);
  const band = (W - pad.l - pad.r) / Math.max(1, labels.length);
  const gap = 2;
  const barW = Math.max(3, Math.min(28, (band * 0.72 - gap * (series.length - 1)) / series.length));
  const groupW = barW * series.length + gap * (series.length - 1);
  const ticks = [lo, (lo + max) / 2, max].filter((v, i, a) => a.indexOf(v) === i);
  const step = Math.ceil(labels.length / 12);

  return (
    <figure className="space-y-2" aria-labelledby={`${id}-t`}>
      <div className="flex items-center justify-between gap-2">
        <figcaption id={`${id}-t`} className="text-sm font-semibold text-fg">{title}</figcaption>
        <IconButton label={table ? "Ver gráfico" : "Ver tabla"} onClick={() => setTable(!table)} className="size-8">{table ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}</IconButton>
      </div>
      <Legend series={series} />
      {table ? (
        <DataTable labels={labels} series={series} values={values} format={format} />
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--fg-3)">{format(t)}</text>
              </g>
            ))}
            {labels.map((l, i) => {
              const x0 = pad.l + band * i + (band - groupW) / 2;
              return (
                <g key={l + i}>
                  <rect x={pad.l + band * i} y={pad.t} width={band} height={H - pad.t - pad.b} fill={hover === i ? "var(--surface-2)" : "transparent"} onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />
                  {series.map((s, j) => {
                    const v = values[i][j] ?? 0;
                    const top = y(Math.max(0, v));
                    const h = Math.abs(y(v) - y(0));
                    const r = Math.min(4, barW / 2, h);
                    const x = x0 + j * (barW + gap);
                    if (h <= 0) return null;
                    // extremo redondeado en el lado opuesto a la línea base
                    const d = v >= 0
                      ? `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`
                      : `M${x},${top} V${top + h - r} Q${x},${top + h} ${x + r},${top + h} H${x + barW - r} Q${x + barW},${top + h} ${x + barW},${top + h - r} V${top} Z`;
                    return <path key={s.name} d={d} fill={s.color} pointerEvents="none" />;
                  })}
                  {i % step === 0 && <text x={pad.l + band * i + band / 2} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--fg-3)">{l}</text>}
                </g>
              );
            })}
            {lo < 0 && <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--fg-3)" strokeWidth={1} />}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-0 z-10 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg" style={{ left: `${Math.min(70, Math.max(0, ((pad.l + band * hover) / W) * 100))}%` }}>
              <div className="mb-1 font-semibold text-fg">{labels[hover]}</div>
              {series.map((s, j) => (
                <div key={s.name} className="flex items-center gap-2 text-fg-2">
                  <span className="size-2 rounded-sm" style={{ background: s.color }} />
                  {s.name}: <span className="font-medium tabular text-fg">{format(values[hover][j])}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Línea con línea base en cero (p. ej. evolución de la bolsa de horas). */
export function LineChart({ title, labels, values, format, color = "var(--series-1)", height = 200 }: { title: string; labels: string[]; values: number[]; format: (v: number) => string; color?: string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const W = 640;
  const H = height;
  const pad = { l: 48, r: 12, t: 12, b: 26 };
  const hi = niceMax(Math.max(0, ...values));
  const loRaw = Math.min(0, ...values);
  const lo = loRaw < 0 ? -niceMax(-loRaw) : 0;
  const x = (i: number) => pad.l + (values.length <= 1 ? (W - pad.l - pad.r) / 2 : (i / (values.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  const path = values.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const step = Math.ceil(labels.length / 8);
  return (
    <figure className="space-y-2" aria-labelledby={`${id}-t`}>
      <div className="flex items-center justify-between gap-2">
        <figcaption id={`${id}-t`} className="text-sm font-semibold text-fg">{title}</figcaption>
        <IconButton label={table ? "Ver gráfico" : "Ver tabla"} onClick={() => setTable(!table)} className="size-8">{table ? <BarChart3 className="size-4" /> : <Table2 className="size-4" />}</IconButton>
      </div>
      {table ? (
        <DataTable labels={labels} series={[{ name: title, color }]} values={values.map((v) => [v])} format={format} />
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title} onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
              const px = ((e.clientX - r.left) / r.width) * W;
              const i = Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (values.length - 1));
              setHover(Math.max(0, Math.min(values.length - 1, i)));
            }}>
            {[lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i).map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--fg-3)" : "var(--grid)"} strokeWidth={1} />
                <text x={pad.l - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--fg-3)">{format(t)}</text>
              </g>
            ))}
            <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {values.length === 1 && <circle cx={x(0)} cy={y(values[0])} r={4} fill={color} />}
            {labels.map((l, i) => i % step === 0 && <text key={l + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--fg-3)">{l}</text>)}
            {hover !== null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={H - pad.b} stroke="var(--fg-3)" strokeDasharray="3 3" />
                <circle cx={x(hover)} cy={y(values[hover])} r={5} fill={color} stroke="var(--surface)" strokeWidth={2} />
              </g>
            )}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-0 z-10 rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg" style={{ left: `${Math.min(72, Math.max(0, (x(hover) / W) * 100 - 8))}%` }}>
              <div className="font-semibold text-fg">{labels[hover]}</div>
              <div className="tabular text-fg-2">{format(values[hover])}</div>
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

/** Barra de progreso horizontal (p. ej. horas realizadas frente a contrato). */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const over = max > 0 && value > max;
  return (
    <div role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: over ? "var(--series-2)" : "var(--series-1)" }} />
    </div>
  );
}
