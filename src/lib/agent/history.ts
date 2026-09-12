import type { UIMessage } from "ai";

/**
 * Keeps a long Nimbus conversation affordable. Every model step resends the
 * whole history, so tool results from earlier turns (hundreds of item rows,
 * report tables) would otherwise be paid for again and again. Recent tool
 * results stay complete; older ones are reduced to their counts and totals,
 * which is all the model still needs from them.
 */

const KEEP_RECENT_ASSISTANT_MESSAGES = 2;
const OLD_OUTPUT_LIMIT = 1_500;
const OLD_INPUT_LIMIT = 4_000;
const HARD_OUTPUT_LIMIT = 60_000;

type ToolPartLike = { type: string; input?: unknown; output?: unknown };

function size(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Scalars and short strings survive; arrays and objects become counts. */
export function compactValue(v: unknown, chars: number): unknown {
  if (Array.isArray(v)) return { omittedFromHistory: true, rows: v.length };
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    const omitted: string[] = [];
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === null || val === undefined) continue;
      if (typeof val === "number" || typeof val === "boolean") out[k] = val;
      else if (typeof val === "string") out[k] = val.length > 200 ? `${val.slice(0, 200)}…` : val;
      else if (Array.isArray(val)) omitted.push(`${k}[${val.length}]`);
      else omitted.push(k);
    }
    out.omittedFromHistory = omitted.length ? omitted.join(", ") : `${chars} characters`;
    return out;
  }
  if (typeof v === "string") return v.length > 400 ? `${v.slice(0, 400)}…` : v;
  return v;
}

export function compactHistory<M extends UIMessage>(messages: M[]): M[] {
  let assistantSeen = 0;
  const out: M[] = new Array(messages.length);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") {
      out[i] = m;
      continue;
    }
    assistantSeen++;
    const old = assistantSeen > KEEP_RECENT_ASSISTANT_MESSAGES;
    let changed = false;
    const parts = m.parts.map((p) => {
      if (!p.type.startsWith("tool-")) return p;
      const tp = p as unknown as ToolPartLike;
      let next: ToolPartLike = tp;
      if (tp.output !== undefined) {
        const chars = size(tp.output);
        if (old && chars > OLD_OUTPUT_LIMIT) next = { ...next, output: compactValue(tp.output, chars) };
        else if (chars > HARD_OUTPUT_LIMIT) next = { ...next, output: { truncatedFromHistory: true, characters: chars, head: JSON.stringify(tp.output).slice(0, 20_000) } };
      }
      if (old && tp.input !== undefined) {
        const chars = size(tp.input);
        if (chars > OLD_INPUT_LIMIT) next = { ...next, input: compactValue(tp.input, chars) };
      }
      if (next !== tp) changed = true;
      return next as unknown as typeof p;
    });
    out[i] = changed ? ({ ...m, parts } as M) : m;
  }
  return out;
}
