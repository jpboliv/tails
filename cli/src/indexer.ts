// Turn spec documents into the ID index. Pure: input is
// document text, output is a SpecIndex. Reading files or git lives in repo.ts.
import { posix } from "node:path";
import type { Config } from "./config.js";
import { checkDefinition, citationTokens, familySpec, isShortRecord, prdColumn } from "./families.js";
import { completeContracts } from "./contracts.js";
import { blockLines, readDocument, type Heading, type PlacedBlock } from "./markdown.js";
import {
  TailsInputError,
  type Citation,
  type Definition,
  type DocInfo,
  type DocKind,
  type DocPath,
  type Family,
  type IdKey,
  type LinkKind,
  type MatrixTable,
  type ScopeRow,
  type RefSource,
  type SpecIndex,
} from "./model.js";
import { compareBy, normalizeText, textHash } from "./util.js";

export interface SourceDoc {
  readonly path: DocPath;
  readonly kind: DocKind;
  readonly text: string;
  readonly source?: RefSource;
}

export interface IndexOptions {
  readonly commit?: string | null;
  readonly refs?: readonly RefSource[];
  /** Puts every document in this one group, as `tails feature` does for the documents of one feature. */
  readonly group?: string;
}

interface RawCitation {
  readonly doc: DocPath;
  readonly line: number;
  readonly kind: LinkKind;
  readonly id: string;
  readonly family: Family;
  readonly from: IdKey | null;
}

interface ParsedDoc {
  readonly info: Omit<DocInfo, "group">;
  readonly links: readonly DocPath[];
  readonly entries: Definition[];
  readonly citations: RawCitation[];
  readonly scopeRows: ScopeRow[];
  readonly matrixTables: MatrixTable[];
}

function keyFor(doc: DocPath, id: string, family: Family): IdKey {
  return (familySpec(family).scope === "global" && !isShortRecord(family, id) ? id : `${doc}#${id}`) as IdKey;
}

/** The bold labels after a bullet's first one, joined by a comma or "and": `**A**, **B** and **C**` gives B and C. */
function coLabels(line: string): string[] {
  const m = /^\s*(?:[-*+]|\d+[.)])\s+\*\*[^*]+\*\*((?:\s*(?:,|and)\s*\*\*[^*]+\*\*)*)/.exec(line);
  return m ? [...(m[1] ?? "").matchAll(/\*\*([^*]+)\*\*/g)].map((x) => x[1]!) : [];
}

function firstWord(text: string): string {
  return text.trim().replace(/^\*\*([^*]+)\*\*/, "$1").split(/\s+/)[0] ?? "";
}

/** "7. Risks" gives "§7"; a heading without a number gives its text. */
function sectionLabel(heading: Heading | undefined): string {
  if (!heading) return "";
  const n = /^(\d+(?:\.\d+)*)\.?\s/.exec(heading.text);
  return n ? `§${n[1]}` : heading.text;
}

const EPIC_HEADER = /Epic:\s*\[?([A-Z][A-Z0-9]*-\d+)/;
const LINEAR_LINK = /\[([A-Z][A-Z0-9]*-\d+)\]\(https:\/\/linear\.app\//;
const MD_LINK = /\]\(([^)#\s]+\.md)(?:#[^)]*)?\)/g;

function findEpic(text: string, blocks: readonly PlacedBlock[]): string | null {
  // The header is everything before the first level-2 heading.
  const firstH2 = blocks.find((b) => b.block.kind === "heading" && b.block.level === 2)?.block.line ?? Infinity;
  const header = text.split(/\r?\n/).slice(0, Math.min(firstH2 - 1, 15)).join(" ");
  const fromHeader = EPIC_HEADER.exec(header);
  if (fromHeader) return fromHeader[1]!;
  // Otherwise the first Linear link in section 2.
  for (const { block, trail } of blocks) {
    const h2 = trail.find((h) => h.level === 2);
    if (!h2 || !/^2[.\s]/.test(h2.text)) continue;
    for (const l of blockLines(block)) {
      const m = LINEAR_LINK.exec(l.text);
      if (m) return m[1]!;
    }
  }
  return null;
}

function parseDoc(src: SourceDoc, config: Config): ParsedDoc {
  const { lines, blocks } = readDocument(src.text);
  const doc = src.path;
  const entries: Definition[] = [];
  const citations: RawCitation[] = [];
  const scopeRows: ScopeRow[] = [];
  const matrixTables: MatrixTable[] = [];
  const headingDefs = new Map<number, IdKey>();
  /** Coverage table rows, linked once every test case in the document is known. */
  const coverage: { line: number; reqs: string[]; tcs: string[] }[] = [];

  const malformed = (line: number, text: string, family: Family): never => {
    throw new TailsInputError(`${doc}:${line}: malformed ${familySpec(family).name} ID "${text}" in a definition position`);
  };

  const define = (d: Omit<Definition, "key" | "text_hash" | "doc">): IdKey => {
    const key = keyFor(doc, d.id, d.family);
    // The hash leaves the ID out, so the same words under a new number are recognisably the same requirement (the review renumber check).
    entries.push({ key, doc, ...d, text: normalizeText(d.text), text_hash: textHash(d.text.replace(d.id, "")) });
    return key;
  };

  const cite = (line: number, text: string, from: IdKey | null, kind: LinkKind = "cites", skipOffset = -1) => {
    for (const t of citationTokens(text)) {
      if (t.offset === skipOffset) continue;
      citations.push({ doc, line, kind, id: t.id, family: t.family, from });
    }
  };

  /** The deepest heading in the trail that defined an ID owns the text under it. */
  const owner = (trail: readonly Heading[]): IdKey | null => {
    for (let i = trail.length - 1; i >= 0; i--) {
      const k = headingDefs.get(trail[i]!.line);
      if (k) return k;
    }
    return null;
  };

  for (const { block, trail } of blocks) {
    const sections = trail.map((h) => h.text);
    const section = trail[trail.length - 1]?.text ?? "";
    switch (block.kind) {
      case "heading": {
        const check = checkDefinition(firstWord(block.text), "heading", { sections, kind: src.kind });
        if (check.kind === "malformed") malformed(block.line, check.text, check.family);
        if (check.kind === "defines") {
          const key = define({ id: check.id, family: check.family, section, line: block.line, text: block.text });
          headingDefs.set(block.line, key);
          cite(block.line, block.text, key, "cites", block.text.indexOf(check.id));
        } else {
          cite(block.line, block.text, owner(trail));
        }
        break;
      }
      case "bullet": {
        let from = owner(trail);
        const definedLabels: string[] = [];
        if (block.label !== null) {
          const check = checkDefinition(block.label, "bullet", { sections, kind: src.kind });
          if (check.kind === "malformed") malformed(block.line, check.text, check.family);
          if (check.kind === "defines") {
            from = define({ id: check.id, family: check.family, section, line: block.line, text: block.text });
            definedLabels.push(block.label);
            // A record item can define several records together: `**FF-WEB-13**, **FF-MOB-16** …`.
            if (check.family === "REC") {
              for (const label of coLabels(block.lines[0]!.text)) {
                const more = checkDefinition(label, "bullet", { sections, kind: src.kind });
                if (more.kind === "malformed") malformed(block.line, more.text, more.family);
                if (more.kind !== "defines" || more.family !== "REC") break;
                define({ id: more.id, family: more.family, section, line: block.line, text: block.text });
                definedLabels.push(label);
              }
            }
          }
        }
        for (const l of block.lines) {
          // The bold labels are the definitions themselves, not citations.
          const text = l.line === block.line ? definedLabels.reduce((t, label) => t.replace(`**${label}**`, ""), l.text) : l.text;
          const covers = /\*\*Covers:?\*\*:?([^*]*)/i.exec(text);
          if (covers) {
            cite(l.line, text.slice(0, covers.index), from);
            cite(l.line, covers[1]!, from, "covers");
            cite(l.line, text.slice(covers.index + covers[0].length), from);
          } else {
            cite(l.line, text, from);
          }
        }
        break;
      }
      case "table": {
        const firstHeader = block.header[0] ?? "";
        const prdCol = prdColumn(block.header);
        const sourceCol = block.header.findIndex((h) => /^sources?$/i.test(h.trim()));
        const isNotDoing = src.kind === "prd" && (/^not doing/i.test(block.caption ?? "") || /not doing|out of scope|non-goals/i.test(section));
        const isRisk = src.kind === "tdd" && sections.some((s) => /risk/i.test(s));
        // A test case specification can map coverage in one table: | FR | Test cases | Note |.
        const reqCol = block.header.findIndex((h) => /^(frs?|requirements?|prd)$/i.test(h.trim()));
        const tcCol = block.header.findIndex((h) => /^test[ -]?cases?$/i.test(h.trim()));
        if (src.kind === "tcs" && reqCol >= 0 && tcCol >= 0) {
          for (const row of block.rows) {
            const reqs = citationTokens(row.cells[reqCol] ?? "").filter((t) => t.family === "FR");
            const tcs = citationTokens(row.cells[tcCol] ?? "").filter((t) => t.family === "TC");
            if (reqs.length && tcs.length) coverage.push({ line: row.line, reqs: reqs.map((t) => t.id), tcs: tcs.map((t) => t.id) });
          }
        }
        const matrixRows: IdKey[] = [];
        cite(block.line, block.header.join(" | "), owner(trail));
        for (const row of block.rows) {
          const first = row.cells[0] ?? "";
          const check = checkDefinition(firstWord(first), "cell", { sections, firstHeader, kind: src.kind });
          if (check.kind === "malformed") malformed(row.line, check.text, check.family);
          let from = owner(trail);
          let skip = -1;
          if (check.kind === "defines") {
            const cells: Record<string, string> = {};
            block.header.forEach((h, i) => (cells[h] = row.cells[i] ?? ""));
            from = define({ id: check.id, family: check.family, section, line: row.line, text: row.cells.join(" | "), cells });
            if (check.family === "MATRIX") matrixRows.push(from);
            skip = 0;
          } else if (isNotDoing || isRisk) {
            scopeRows.push({
              kind: isNotDoing ? "not_doing" : "risk",
              doc,
              line: row.line,
              section: isRisk ? sectionLabel(trail.find((h) => /risk/i.test(h.text))) : section,
              text: normalizeText(first),
              text_hash: textHash(first),
            });
          }
          row.cells.forEach((cell, i) => {
            if (i === skip && check.kind === "defines") {
              cite(row.line, cell.slice(cell.indexOf(check.id) + check.id.length), from);
              return;
            }
            const kind: LinkKind = check.kind === "defines" && check.family === "TC" && /^(covers|requirements?|frs?|prd)$/i.test(block.header[i] ?? "") ? "covers"
              : check.kind === "defines" && check.family === "MATRIX" && (i === prdCol || i === sourceCol) ? "sources" : "cites";
            cite(row.line, cell, from, kind);
          });
        }
        if (matrixRows.length > 0) {
          matrixTables.push({ doc, line: block.line, section, has_prd_column: prdCol !== null, rows: matrixRows });
        }
        break;
      }
      case "text":
        cite(block.line, block.text, owner(trail));
        break;
    }
  }

  // Each test case a coverage row lists covers each requirement the row names, as a Covers: line
  // would. A test case this document does not define stays an ordinary citation (DR-4).
  for (const row of coverage) {
    for (const tc of row.tcs) {
      const from = keyFor(doc, tc, "TC");
      if (!entries.some((e) => e.key === from)) continue;
      for (const id of row.reqs) citations.push({ doc, line: row.line, kind: "covers", id, family: "FR", from });
    }
  }

  const links: DocPath[] = [];
  for (const m of src.text.matchAll(MD_LINK)) {
    links.push(posix.normalize(posix.join(posix.dirname(doc), m[1]!)) as DocPath);
  }
  const title = (blocks.find((b) => b.block.kind === "heading" && b.block.level === 1)?.block as Heading | undefined)?.text ?? doc;
  const epic = config.epics[doc] ?? findEpic(src.text, blocks);
  const complete = completeContracts(lines, blocks, entries);
  // Continuations of a bullet record own their prose/table citations as well as the opening line.
  for (let i = 0; i < citations.length; i++) {
    const c = citations[i]!;
    if (c.from) continue;
    const record = complete.find((e) => e.family === "REC" && e.line < c.line && (e.end_line ?? e.line) >= c.line);
    if (record) citations[i] = { ...c, from: record.key };
  }
  return { info: { path: doc, kind: src.kind, title, epic, ...(src.source ? { source: src.source } : {}) }, links, entries: complete, citations, scopeRows, matrixTables };
}

/** Docs are grouped when they share an epic or one links to another. */
function groupDocs(parsed: readonly ParsedDoc[]): Map<DocPath, string> {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let p = parent.get(x) ?? x;
    if (p !== x) {
      p = find(p);
      parent.set(x, p);
    }
    return p;
  };
  const union = (a: string, b: string) => {
    const [ra, rb] = [find(a), find(b)].sort();
    if (ra !== rb) parent.set(rb!, ra!);
  };
  const paths = new Set(parsed.map((p) => p.info.path as string));
  for (const p of parsed) {
    if (p.info.epic) union(p.info.path, `epic:${p.info.epic}`);
    for (const l of p.links) if (paths.has(l) && l !== p.info.path) union(p.info.path, l);
  }
  // Name each group by its epic when it has one, else by its first doc.
  const names = new Map<string, string>();
  for (const p of [...parsed].sort(compareBy((x) => x.info.path))) {
    const root = find(p.info.path);
    const current = names.get(root);
    const candidate = p.info.epic ?? p.info.path;
    if (!current || (p.info.epic && (current.includes("/") || candidate < current))) names.set(root, candidate);
  }
  return new Map(parsed.map((p) => [p.info.path, names.get(find(p.info.path))!]));
}

export function buildIndex(sources: readonly SourceDoc[], config: Config, options: IndexOptions = {}): SpecIndex {
  const parsed = [...sources].sort(compareBy((s) => s.path)).map((s) => parseDoc(s, config));
  const groups = options.group ? new Map(parsed.map((p) => [p.info.path, options.group!])) : groupDocs(parsed);
  const docs: DocInfo[] = parsed.map((p) => ({ ...p.info, group: groups.get(p.info.path)! }));

  const entries = parsed.flatMap((p) => p.entries);
  const byKey = new Map<IdKey, Definition>();
  for (const e of entries) {
    const prior = byKey.get(e.key);
    if (prior) throw new TailsInputError(`${e.doc}:${e.line}: ${e.id} is already defined at ${prior.doc}:${prior.line}`);
    byKey.set(e.key, e);
  }

  const familiesInGroup = new Map<string, Set<Family>>();
  for (const e of entries) {
    const g = groups.get(e.doc)!;
    if (!familiesInGroup.has(g)) familiesInGroup.set(g, new Set());
    familiesInGroup.get(g)!.add(e.family);
  }

  const resolve = (c: RawCitation): IdKey | null => {
    const spec = familySpec(c.family);
    if (spec.scope === "global" && !isShortRecord(c.family, c.id)) return byKey.has(c.id as IdKey) ? (c.id as IdKey) : null;
    const same = keyFor(c.doc, c.id, c.family);
    if (byKey.has(same)) return same;
    if (spec.home === "same") return null;
    const group = groups.get(c.doc);
    const home = docs.filter((d) => d.group === group && d.kind === spec.home).map((d) => keyFor(d.path, c.id, c.family));
    const matches = home.filter((k) => byKey.has(k));
    return isShortRecord(c.family, c.id) && matches.length !== 1 ? null : matches[0] ?? null;
  };

  const citations: Citation[] = [];
  for (const c of parsed.flatMap((p) => p.citations)) {
    if (isShortRecord(c.family, c.id)) {
      const prefix = c.id.replace(/\d+$/, "");
      if (!entries.some((e) => isShortRecord(e.family, e.id) && e.id.startsWith(prefix) && groups.get(e.doc) === groups.get(c.doc))) continue;
    }
    const to = resolve(c);
    if (to === null && familySpec(c.family).ambiguous && !familiesInGroup.get(groups.get(c.doc)!)?.has(c.family)) continue;
    citations.push({ ...c, to });
  }

  return {
    schema: "tails.index/1",
    commit: options.commit ?? null,
    ...(options.refs ? { refs: options.refs } : {}),
    docs,
    entries: entries.sort(compareBy((e) => e.doc, (e) => e.line, (e) => e.id)),
    citations: citations.sort(compareBy((c) => c.doc, (c) => c.line, (c) => c.id, (c) => c.kind)),
    scope_rows: parsed.flatMap((p) => p.scopeRows).sort(compareBy((r) => r.doc, (r) => r.line)),
    matrix_tables: parsed.flatMap((p) => p.matrixTables).sort(compareBy((t) => t.doc, (t) => t.line)),
  };
}
