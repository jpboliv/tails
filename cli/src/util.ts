import { createHash } from "node:crypto";
import type { Definition, TextHash } from "./model.js";

export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function textHash(text: string): TextHash {
  return createHash("sha256").update(normalizeText(text)).digest("hex").slice(0, 16) as TextHash;
}

export function shortHash(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 12);
}

export function compareBy<T>(...keys: ((x: T) => string | number)[]): (a: T, b: T) => number {
  return (a, b) => {
    for (const k of keys) {
      const x = k(a);
      const y = k(b);
      if (x < y) return -1;
      if (x > y) return 1;
    }
    return 0;
  };
}

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

export function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** Lowercase word tokens, with camelCase and paths split: `CatalogBookImporter` gives catalog, book, importer. */
export function words(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

export type DiffPart = { readonly op: "same" | "del" | "add"; readonly text: string };

/** A word-level diff (LCS), merged into runs. Spec rows are short, so the quadratic table is fine. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const parts: DiffPart[] = [];
  const push = (op: DiffPart["op"], word: string) => {
    const last = parts[parts.length - 1];
    if (last?.op === op) parts[parts.length - 1] = { op, text: `${last.text} ${word}` };
    else parts.push({ op, text: word });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) (push("same", a[i]!), i++, j++);
    else if (j < b.length && (i === a.length || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) (push("add", b[j]!), j++);
    else (push("del", a[i]!), i++);
  }
  return parts;
}

export function oneLine(text: string, max = 280): string {
  const t = text.replace(/\s+/g, " ").replace(/^\*\*([^*]+)\*\*\s*/, "").trim();
  return t.length > max ? `${closeSpans(t.slice(0, max - 1).trimEnd())}…` : t;
}

/** Closes a code span or bold run that a cut left open, so the excerpt still renders as markdown. */
export function closeSpans(s: string): string {
  const odd = (mark: string) => s.split(mark).length % 2 === 0;
  if (odd("`")) return `${s}\``;
  return odd("**") ? `${s}**` : s;
}

/** Opens a code span or bold run that a cut left closed at the start of an excerpt. */
export function openSpans(s: string): string {
  const odd = (mark: string) => s.split(mark).length % 2 === 0;
  if (odd("`")) return `\`${s}`;
  return odd("**") ? `**${s}` : s;
}

/** The words a reader needs from a definition: the requirement cell of a table row, else its text. */
export function gist(e: Definition): string {
  const cells = e.cells ? Object.values(e.cells) : [];
  return oneLine(cells.length > 1 ? cells.slice(1, e.family === "D" ? 3 : 2).join(" — ") : e.text);
}
