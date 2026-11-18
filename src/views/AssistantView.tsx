"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, Info, MessageCircleQuestion, Send, Trash2 } from "lucide-react";
import { Badge, Button, IconButton, PageHeader, Spinner, useFeedback, cx } from "@/components/ui";
import { useAdjustments, useCalcData, usePayslips, useToday } from "@/lib/hooks";
import { answerQuestion, SUGGESTED_QUESTIONS, type Answer, type Block, type DataTag } from "@/lib/assistant";
import { getDb } from "@/db/repo";
import { nowMs, uid } from "@/lib/id";
import { fmtDateTimeEpoch } from "@/lib/time";
import type { AssistantMessage } from "@/lib/types";

const TAG_TONE: Record<DataTag, "ok" | "accent" | "warn"> = { registrado: "ok", "estimación": "accent", "previsión": "warn" };
const TAG_TEXT: Record<DataTag, string> = { registrado: "Dato registrado", "estimación": "Estimación", "previsión": "Previsión" };

function BlockView({ b }: { b: Block }) {
  switch (b.type) {
    case "text":
      return <p className="text-sm text-fg">{b.text}</p>;
    case "note":
      return <p className="flex items-start gap-1.5 text-xs text-fg-3"><Info className="mt-0.5 size-3.5 shrink-0" />{b.text}</p>;
    case "list":
      return <ul className="list-disc space-y-1 pl-5 text-sm text-fg">{b.items.map((i) => <li key={i}>{i}</li>)}</ul>;
    case "stat":
      return (
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-medium text-fg-3">{b.label}</span>
            <Badge tone={TAG_TONE[b.tag]}>{TAG_TEXT[b.tag]}</Badge>
          </div>
          <div className="mt-0.5 text-2xl font-semibold tabular text-fg">{b.value}</div>
          {b.hint && <div className="text-xs text-fg-3">{b.hint}</div>}
        </div>
      );
    case "table":
      return (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          {b.tag && <div className="flex justify-end px-3 pt-2"><Badge tone={TAG_TONE[b.tag]}>{TAG_TEXT[b.tag]}</Badge></div>}
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-left text-xs text-fg-3">{b.columns.map((c) => <th key={c} className="px-3 py-2 font-medium">{c}</th>)}</tr></thead>
            <tbody>{b.rows.map((r, i) => <tr key={i} className="border-b border-line/60 last:border-0">{r.map((c, j) => <td key={j} className={cx("px-3 py-1.5 tabular", j === 0 ? "text-fg" : "text-fg-2")}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
  }
}

function AnswerView({ a, onAsk }: { a: Answer; onAsk: (q: string) => void }) {
  return (
    <div className="space-y-2.5">
      {a.understood && <p className="text-xs font-medium text-fg-3">{a.understood}</p>}
      {a.blocks.map((b, i) => <BlockView key={i} b={b} />)}
      {a.links.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {a.links.map((l) => <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">{l.label}<ArrowRight className="size-3" /></Link>)}
        </div>
      )}
      {a.suggestions && a.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {a.suggestions.map((s) => <button key={s} type="button" onClick={() => onAsk(s)} className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-fg-2 hover:border-accent hover:text-accent">{s}</button>)}
        </div>
      )}
    </div>
  );
}

export function AssistantView() {
  const d = useCalcData();
  const payslips = usePayslips();
  const adjustments = useAdjustments();
  const today = useToday();
  const { confirm, toast } = useFeedback();
  const history = useLiveQuery(() => getDb().assistantMessages.orderBy("at").toArray(), []);
  const [input, setInput] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const ready = d.ready && !!payslips && !!adjustments && !!history;

  const ctx = useMemo(() => (ready ? {
    today, shifts: d.shifts, contracts: d.contracts, holidays: d.holidays, absences: d.absences, jobs: d.jobs,
    payslips: payslips!, snapshots: d.snapshots, adjustments: adjustments!, currency: d.currency,
  } : null), [ready, today, d, payslips, adjustments]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [history?.length]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || !ctx) return;
    setInput("");
    const answer = answerQuestion(q, ctx);
    const now = nowMs();
    const user: AssistantMessage = { id: uid(), at: now, role: "user", text: q };
    const bot: AssistantMessage = { id: uid(), at: now + 1, role: "assistant", text: answer.understood, answer };
    await getDb().assistantMessages.bulkPut([user, bot]);
  };

  if (!ready) return <Spinner />;

  return (
    <div className="flex min-h-[calc(100dvh-10rem)] flex-col">
      <PageHeader
        title="Asistente"
        subtitle="Pregunta por tus turnos, horas, salario o vacaciones. Responde con tus datos y los cálculos de la app, en tu dispositivo."
        actions={history!.length > 0 ? <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={async () => { if (await confirm({ title: "Borrar conversación", message: "Se borrará el historial de preguntas y respuestas.", confirmLabel: "Borrar", danger: true })) { await getDb().assistantMessages.clear(); toast("Conversación borrada"); } }}>Borrar historial</Button> : undefined}
      />

      <div className="flex-1 space-y-4">
        {history!.length === 0 && (
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="mb-3 flex items-center gap-2 font-semibold"><MessageCircleQuestion className="size-5 text-accent" />¿Qué quieres saber?</div>
            <p className="mb-4 text-sm text-fg-2">No uso inteligencia artificial externa ni envío tus datos a ningún sitio: interpreto tu pregunta y consulto tus turnos, contratos, nóminas y vacaciones. Cada dato indica si es <b>registrado</b>, una <b>estimación</b> o una <b>previsión</b>.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((s) => <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-line bg-surface-2/50 px-3 py-1.5 text-left text-sm text-fg hover:border-accent hover:text-accent">{s}</button>)}
            </div>
          </div>
        )}
        {history!.map((m) => m.role === "user" ? (
          <div key={m.id} className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-accent-fg">{m.text}</div>
          </div>
        ) : (
          <div key={m.id} className="flex">
            <div className="w-full max-w-2xl rounded-2xl rounded-bl-md border border-line bg-surface-2/40 p-3 sm:p-4">
              <AnswerView a={m.answer as Answer} onAsk={ask} />
              <p className="mt-2 text-[11px] text-fg-3">Respuesta calculada el {fmtDateTimeEpoch(m.at)} con los datos de ese momento.</p>
            </div>
          </div>
        ))}
        {/* espacio para que la última respuesta no quede bajo la barra de escritura */}
        <div ref={endRef} aria-hidden className={history!.length ? "h-48 lg:h-36" : "h-24"} />
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); void ask(input); }}
        className="fixed inset-x-0 bottom-[calc(4.6rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-bg px-4 py-3 lg:bottom-0 lg:left-64"
      >
        {history!.length > 0 && (
          <div className="no-scrollbar mx-auto mb-2 flex max-w-4xl gap-1.5 overflow-x-auto">
            {SUGGESTED_QUESTIONS.slice(0, 6).map((s) => <button key={s} type="button" onClick={() => ask(s)} className="shrink-0 rounded-full border border-line bg-surface px-3 py-1 text-xs text-fg-2 hover:border-accent hover:text-accent">{s}</button>)}
          </div>
        )}
        <div className="mx-auto flex max-w-4xl items-center gap-2">
          <input
            aria-label="Escribe tu pregunta"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ej.: ¿Cuántas horas nocturnas llevo este mes?"
            className="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-fg outline-none placeholder:text-fg-3 focus:border-accent focus:ring-2 focus:ring-accent/20"
            enterKeyHint="send"
          />
          <IconButton label="Enviar pregunta" type="submit" disabled={!input.trim()} className="size-12 rounded-2xl bg-accent text-accent-fg hover:bg-accent-hover hover:text-accent-fg disabled:bg-surface-2 disabled:text-fg-3"><Send className="size-5" /></IconButton>
        </div>
      </form>
    </div>
  );
}
