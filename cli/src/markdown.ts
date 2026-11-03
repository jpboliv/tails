// Line-based reader for the subset of Markdown that spec documents use to define IDs:
// headings, bullets that open with a bold label, and tables. Line numbers are 1-based
// and exact, which is what findings cite (INV-5).
import { stripComments } from "./reader.js";

export interface Heading {
  readonly kind: "heading";
  readonly line: number;
  readonly level: number;
  readonly text: string;
}

export interface Bullet {
  readonly kind: "bullet";
  readonly line: number;
  /** Text of the bold label that opens the bullet, if any: `- **FR-1.1** Given...` gives "FR-1.1". */
  readonly label: string | null;
  /** The bullet's own text plus its continuation lines, without the marker. */
  readonly text: string;
  readonly lines: readonly Line[];
}

export interface TableRow {
  readonly line: number;
  readonly cells: readonly string[];
}

export interface Table {
  readonly kind: "table";
  readonly line: number;
  readonly header: readonly string[];
  readonly rows: readonly TableRow[];
  /** A bold-only line just above the table, such as `**Not doing:**`. */
  readonly caption: string | null;
}

export interface Paragraph {
  readonly kind: "text";
  readonly line: number;
  readonly text: string;
}

export interface Line {
  readonly line: number;
  readonly text: string;
}

export type Block = Heading | Bullet | Table | Paragraph;

export interface PlacedBlock {
  readonly block: Block;
  readonly trail: readonly Heading[];
}

const FENCE = /^\s*(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const BOLD_LEAD = /^\*\*(.+?)\*\*/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;
const BOLD_ONLY = /^\*\*(.+?)\*\*\s*$/;

function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let inCode = false;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === "\\" && inner[i + 1] === "|") {
      current += "|";
      i++;
    } else if (ch === "`") {
      inCode = !inCode;
      current += ch;
    } else if (ch === "|" && !inCode) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function readBlocks(source: string): PlacedBlock[] {
  const lines = stripComments(source.split(/\r?\n/).map((text, i) => ({ n: i + 1, text }))).map((l) => l.text);
  const out: PlacedBlock[] = [];
  const trail: Heading[] = [];
  let fence: string | null = null;
  let lastCaption: { text: string; line: number } | null = null;
  let i = 0;

  const push = (block: Block) => out.push({ block, trail: [...trail] });

  while (i < lines.length) {
    const raw = lines[i]!;
    const lineNo = i + 1;
    const marker = FENCE.exec(raw)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && raw.trim() === marker) fence = null;
      i++;
      continue;
    }
    if (fence !== null || raw.trim() === "") {
      i++;
      continue;
    }

    const heading = HEADING.exec(raw);
    if (heading) {
      const h: Heading = { kind: "heading", line: lineNo, level: heading[1]!.length, text: heading[2]! };
      while (trail.length > 0 && trail[trail.length - 1]!.level >= h.level) trail.pop();
      push(h);
      trail.push(h);
      lastCaption = null;
      i++;
      continue;
    }

    if (TABLE_ROW.test(raw)) {
      const header = splitRow(raw);
      const rows: TableRow[] = [];
      const start = lineNo;
      i++;
      while (i < lines.length && TABLE_ROW.test(lines[i]!)) {
        if (!TABLE_SEPARATOR.test(lines[i]!)) rows.push({ line: i + 1, cells: splitRow(lines[i]!) });
        i++;
      }
      const caption = lastCaption && lastCaption.line >= start - 2 ? lastCaption.text : null;
      push({ kind: "table", line: start, header, rows, caption });
      lastCaption = null;
      continue;
    }

    const bullet = BULLET.exec(raw);
    if (bullet) {
      const indent = bullet[1]!.length;
      const own: Line[] = [{ line: lineNo, text: raw }];
      let text = bullet[3]!;
      i++;
      // Continuation: indented, non-empty lines that do not start a new bullet at the same or lower indent.
      while (i < lines.length) {
        const next = lines[i]!;
        if (next.trim() === "" || FENCE.test(next) || HEADING.test(next) || TABLE_ROW.test(next)) break;
        const nb = BULLET.exec(next);
        if (nb && nb[1]!.length <= indent) break;
        if (!nb && !/^\s+/.test(next)) break;
        own.push({ line: i + 1, text: next });
        text += " " + next.trim();
        i++;
      }
      const lead = BOLD_LEAD.exec(bullet[3]!);
      push({ kind: "bullet", line: lineNo, label: lead ? lead[1]! : null, text, lines: own });
      lastCaption = null;
      continue;
    }

    const bold = BOLD_ONLY.exec(raw.trim());
    lastCaption = bold ? { text: bold[1]!.replace(/:$/, "").trim(), line: lineNo } : null;
    push({ kind: "text", line: lineNo, text: raw });
    i++;
  }
  return out;
}

/** Text of a block's lines, for citation scanning. */
export function blockLines(block: Block): Line[] {
  switch (block.kind) {
    case "heading":
      return [{ line: block.line, text: block.text }];
    case "bullet":
      return [...block.lines];
    case "text":
      return [{ line: block.line, text: block.text }];
    case "table":
      return [{ line: block.line, text: block.header.join(" | ") }, ...block.rows.map((r) => ({ line: r.line, text: r.cells.join(" | ") }))];
  }
}
