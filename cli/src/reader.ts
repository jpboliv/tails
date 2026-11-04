// The reader view: what the rendered page of a spec folds away, restyles or removes, so a person
// reads the design and not the notes written for the agent that implements or checks it.
//
// Every rule keys on a fixed marker of the document format (bold IDs for TDD records,
// bold FR IDs for PRD criteria). Nothing is inferred from wording or position alone. The source view
// always shows the file as written, and every folded note opens in place.
import type { DocKind } from "./model.js";

export type RuleId = "verify" | "free" | "guide" | "comment" | "record" | "retired" | "existing" | "blocked";

const RULES: Readonly<Record<DocKind, readonly RuleId[]>> = {
  prd: ["comment", "record", "retired"],
  tdd: ["verify", "free", "guide", "comment", "record", "existing", "blocked"],
  tcs: ["comment"],
};

/** The rules that apply to one document kind. */
export interface Reader {
  readonly has: (rule: RuleId) => boolean;
}

export function readerFor(kind: DocKind): Reader {
  const on = new Set(RULES[kind]);
  return { has: (rule) => on.has(rule) };
}

export type NoteKind = "verify" | "free";
export const NOTE_LABEL: Record<NoteKind | "guide", string> = { verify: "Tests", free: "Free choice", guide: "Reading guide" };

export interface Note {
  readonly kind: NoteKind;
  /** The IDs a `_Verify (…)_` line names. */
  readonly ids: readonly string[];
  /** The paragraph's first line without its marker. */
  readonly rest: string;
}

const VERIFY = /^_Verify(?:\s*\(([^)]*)\))?:_\s*/;
const FREE = /^_Free:_\s*/;

/** A paragraph that opens with an agent marker. */
export function matchNote(firstLine: string): Note | null {
  const t = firstLine.trim();
  const v = VERIFY.exec(t);
  if (v) return { kind: "verify", ids: (v[1] ?? "").split(/\s*,\s*/).filter(Boolean), rest: t.slice(v[0].length) };
  const f = FREE.exec(t);
  if (f) return { kind: "free", ids: [], rest: t.slice(f[0].length) };
  return null;
}

/** The heading of the section that explains the record format to the agent. */
export const isGuide = (heading: string): boolean => /^how to read the contracts$/i.test(heading.replace(/[*_`]/g, "").trim());

/** A record or criterion ID: FF-API-05, WL-01, FR-1.1. */
const ID = String.raw`[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)?-\d+(?:\.\d+)?`;
/** One bold ID, or several that one item defines together: `**FF-WEB-13**, **FF-MOB-16**`. */
export const RECORD_ID = new RegExp(String.raw`^\*\*(${ID})\*\*((?:(?:,| and)\s*\*\*${ID}\*\*)*)(?:\s+|$)`);

export interface RecordHead {
  readonly id: string;
  /** Every ID the item opens with; `id` is the first. */
  readonly ids: readonly string[];
  /** The item's first line without the bold ID. */
  readonly rest: string;
  /** The revision a retired criterion names. */
  readonly retired?: string;
}

export function matchRecord(firstLine: string, reader: Reader): RecordHead | null {
  if (!reader.has("record")) return null;
  const m = RECORD_ID.exec(firstLine);
  if (!m) return null;
  const rest = firstLine.slice(m[0].length);
  const ids = recordIds(firstLine);
  const retired = reader.has("retired") ? /^_Retired in rev\.? ?(\w+)\._\s*$/i.exec(rest.trim())?.[1] : undefined;
  return { id: m[1]!, ids, rest, ...(retired ? { retired } : {}) };
}

/** Every record ID a list item line defines. */
export function recordIds(itemText: string): string[] {
  const m = RECORD_ID.exec(itemText);
  return m ? [m[1]!, ...[...(m[2] ?? "").matchAll(/\*\*([^*]+)\*\*/g)].map((x) => x[1]!)] : [];
}

/**
 * A PRD criterion kept only so its ID is never reused: `**FR-1.3** _Retired in rev 2._`. It needs no
 * design and no test. `text` is the criterion's indexed text, ID included.
 */
export const isRetired = (text: string): boolean => /^\**[A-Z][\w.-]*\**\s+_Retired in rev\.? ?\w+\._\s*$/i.test(text.trim());

export const isBlocked = (firstLine: string): boolean => /^\*\*Blocked\b[^*]*:\*\*/.test(firstLine.trim());

/** `_(existing)_` after inline rendering. */
export const EXISTING_HTML = /<em>\(existing\)<\/em>/g;

/**
 * Removes HTML comments outside code, line by line, so line numbers stay put. A line that held only
 * a comment becomes blank, which ends a paragraph as the comment block does on GitHub.
 */
export function stripComments<L extends { readonly n: number; readonly text: string }>(lines: readonly L[]): L[] {
  let fence: string | null = null;
  let open = false;
  return lines.map((l) => {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(l.text);
    if (!open && f) {
      if (fence === null) fence = f[1]!;
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
      return l;
    }
    if (fence !== null) return l;
    let out = "";
    let rest = l.text;
    let touched = open;
    while (rest.length) {
      if (open) {
        const end = rest.indexOf("-->");
        if (end < 0) {
          rest = "";
          break;
        }
        rest = rest.slice(end + 3);
        open = false;
        continue;
      }
      const start = commentStart(rest);
      if (start < 0) {
        out += rest;
        break;
      }
      out += rest.slice(0, start);
      rest = rest.slice(start + 4);
      open = true;
      touched = true;
    }
    if (!touched) return l;
    return { ...l, text: out.trim() === "" ? "" : out.replace(/\s+$/, "") };
  });
}

/** The first `<!--` that is not inside an inline code span. */
function commentStart(s: string): number {
  let i = 0;
  while (i < s.length) {
    if (s[i] === "`") {
      const run = /^`+/.exec(s.slice(i))![0];
      const close = s.indexOf(run, i + run.length);
      if (close < 0) return s.indexOf("<!--", i + run.length);
      i = close + run.length;
      continue;
    }
    if (s.startsWith("<!--", i)) return i;
    i++;
  }
  return -1;
}
