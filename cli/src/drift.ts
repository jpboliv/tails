// S2: drift rules DR-1 to DR-6 (TDD §4.4.4). Each rule is a pure function over the
// index. Accepted findings and agent-written findings come in through drift-io.ts.
import type { Config } from "./config.js";
import { canCheckCitation, groupDocs, hasKind } from "./availability.js";
import type { Definition, DocInfo, DocPath, IdKey, Place, ScopeRow, SpecIndex, TextHash } from "./model.js";
import { isRetired } from "./reader.js";
import { compareBy, shortHash, words } from "./util.js";

export type RuleId = "DR-1" | "DR-2" | "DR-3" | "DR-4" | "DR-5" | "DR-6";

export const ROLE_NAME: Readonly<Record<Cite["role"], string>> = { prd: "PRD", tdd: "TDD", tcs: "Test cases", doc: "Doc" };
/** How many citations a finding quotes before listing the rest. */
export const QUOTES = 3;
/** A short heading for a quoted citation: its ID, "Not doing", or the first word of a long label. */
export const citeLabel = (c: Cite): string => (c.what.startsWith("Not doing") ? "Not doing" : c.what.length <= 24 ? c.what : c.what.split(" ")[0]!);

export interface Cite extends Place {
  readonly role: "prd" | "tdd" | "tcs" | "doc";
  /** What sits on that line: an ID, or a quoted label for rows without one. */
  readonly what: string;
}

/** A thing a finding is about, with the hash of its text so the fingerprint moves when the text does. */
export interface Subject {
  readonly key: string;
  readonly hash: TextHash | "";
}

export interface Finding {
  readonly rule: RuleId | string;
  readonly title: string;
  readonly severity: "fail" | "warn";
  readonly message: string;
  readonly ids: readonly string[];
  readonly citations: readonly Cite[];
  readonly fingerprint: string;
  readonly status: "open" | "accepted";
  readonly source: string;
  readonly accepted?: { readonly reason: string; readonly by: string; readonly date: string };
}

export type Draft = Omit<Finding, "fingerprint" | "status" | "source" | "accepted" | "title" | "severity"> & {
  readonly rule: RuleId;
  readonly subjects: readonly Subject[];
};

/** A PRD requirement whose text changed after the TDD's last commit (input to DR-3). */
export interface PrdChange {
  readonly prd: DocPath;
  readonly tdd: DocPath;
  readonly tdd_commit: string;
  readonly key: IdKey;
  readonly line: number;
  readonly change: "changed" | "added";
}

export interface DriftContext {
  readonly index: SpecIndex;
  readonly config: Config;
  /** Null when there is no git history to compare (DR-3 is then skipped). */
  readonly prdChanges: readonly PrdChange[] | null;
}

interface RuleSpec {
  readonly id: RuleId;
  readonly title: string;
  readonly severity: "fail" | "warn";
  /** What a reader should do about a finding, in one or two sentences. */
  readonly advice: string;
  readonly run: (ctx: DriftContext) => Draft[];
}

const STOP_WORDS = new Set(
  "a an and are as at be by for from in into is it its of on or that the their this to with without when then than per any all each every only not no new existing add adds added adding applying moving creating created changes change setup separate related used using user users feature features".split(
    " ",
  ),
);

function docsOf(index: SpecIndex, group: string, kind: DocInfo["kind"]): DocInfo[] {
  return index.docs.filter((d) => d.group === group && d.kind === kind);
}

function entryCite(e: Definition, role: Cite["role"]): Cite {
  return { doc: e.doc, line: e.line, role, what: e.id };
}

// DR-1 Uncovered: a PRD criterion with no design/test definition citing it.
// Only assess the downstream documents provided for this feature.
function dr1({ index }: DriftContext): Draft[] {
  const linked = new Set(index.citations.filter((c) => c.from && c.to && index.docs.some((d) => d.path === c.doc && (d.kind === "tdd" || d.kind === "tcs"))).map((c) => c.to as string));
  return index.entries
    .filter((e) => e.family === "FR" && e.id.includes(".") && index.docs.find((d) => d.path === e.doc)?.kind === "prd" && !linked.has(e.key) && !isRetired(e.text))
    .filter((e) => groupDocs(index, e.doc).some((d) => d.kind === "tdd" || d.kind === "tcs"))
    .map((e) => ({
      rule: "DR-1",
      message: `${e.id} is not cited by ${[hasKind(groupDocs(index, e.doc), "tdd") ? "a design entry" : "", hasKind(groupDocs(index, e.doc), "tcs") ? "a test case" : ""].filter(Boolean).join(" or ")} in the provided documents.`,
      ids: [e.key],
      citations: [entryCite(e, "prd")],
      subjects: [{ key: e.key, hash: e.text_hash }],
    }));
}

// DR-2 Scope conflict: a PRD "Not doing" item whose terms appear in a TDD decision, invariant, matrix row or risk.
function scopeTerms(item: ScopeRow, prdVocabulary: ReadonlySet<string>, config: Config): string[] {
  const stop = new Set([...STOP_WORDS, ...config.drift.stopWords]);
  const base = words(item.text).filter((w) => w.length >= 4 && !stop.has(w) && !prdVocabulary.has(w));
  const terms = new Set(base);
  for (const w of words(item.text)) for (const alias of config.drift.aliases[w] ?? []) terms.add(alias);
  return [...terms].sort();
}

function containsTerm(text: string, term: string): boolean {
  if (term.includes(" ")) return text.toLowerCase().includes(term);
  return words(text).includes(term);
}

/**
 * The part of a TDD entry that states what the TDD plans. A decision row plans its
 * decision and choice columns, and a matrix row its ID and requirement columns. The
 * rejected alternatives, sources and evidence paths in later columns are not plans.
 */
function planText(e: Definition): string {
  if ((e.family !== "D" && e.family !== "MATRIX") || !e.cells) return e.text;
  const [subject = "", choice = ""] = Object.values(e.cells);
  // A choice that opens with a negation ("D8 Offline mobile | Not supported.") rejects its subject.
  if (e.family === "D" && affirmed(choice.split(CLAUSE_BREAK)[0] ?? "") === "") return "";
  return `${subject} | ${choice}`;
}

const NEGATION = /\b(?:never|not|no|none|without|cannot|nor|neither|unsupported|excluded)\b|n't\b/i;
const CLAUSE_BREAK = /(?<=[.;!?])\s+|\s*\|\s*|,?\s+but\s+/i;

/**
 * What a text affirms: each clause up to its first negation cue. "It never reads
 * `X-Organization`" affirms "It"; "`/sidekiq` rejects requests without a login" keeps
 * `/sidekiq`, because the cue comes after it.
 */
function affirmed(text: string): string {
  return text
    .split(CLAUSE_BREAK)
    .map((clause) => {
      const m = NEGATION.exec(clause);
      return (m ? clause.slice(0, m.index) : clause).trim();
    })
    .filter(Boolean)
    .join(" | ");
}

// Records (REC) are not read: they are long prose, and on the feature-flags TDD every word match
// against one was a file path, a product name or an unrelated sense of the word (DECISIONS.tsv).
const HIT_ORDER: Record<string, number> = { D: 0, INV: 1, MATRIX: 2 };

function dr2({ index, config }: DriftContext): Draft[] {
  const out: Draft[] = [];
  const groups = [...new Set(index.docs.map((d) => d.group))].sort();
  for (const group of groups) {
    for (const prd of docsOf(index, group, "prd")) {
      const items = index.scope_rows.filter((r) => r.doc === prd.path && r.kind === "not_doing");
      if (items.length === 0) continue;
      // Words the PRD uses outside "Not doing" are in scope by definition, so they cannot signal a conflict.
      const vocabulary = new Set(
        index.entries.filter((e) => e.doc === prd.path).flatMap((e) => words(e.text)),
      );
      const tdds = docsOf(index, group, "tdd").map((d) => d.path);
      const tddEntries = index.entries.filter((e) => tdds.includes(e.doc) && e.family in HIT_ORDER);
      const risks = index.scope_rows.filter((r) => tdds.includes(r.doc) && r.kind === "risk");
      for (const item of items) {
        const terms = scopeTerms(item, vocabulary, config);
        if (terms.length === 0) continue;
        const hit = (text: string) => terms.filter((t) => containsTerm(text, t));
        const entryHits = tddEntries
          .filter((e) => hit(affirmed(planText(e))).length > 0)
          .sort(compareBy((e) => HIT_ORDER[e.family]!, (e) => e.doc, (e) => e.line));
        const riskHits = risks.filter((r) => hit(affirmed(r.text)).length > 0);
        if (entryHits.length === 0 && riskHits.length === 0) continue;
        const matched = [...new Set([...entryHits.map((e) => affirmed(planText(e))), ...riskHits.map((r) => affirmed(r.text))].flatMap(hit))].sort();
        out.push({
          rule: "DR-2",
          message: `PRD says not doing "${item.text}", but the TDD plans it (matched: ${matched.join(", ")}).`,
          ids: entryHits.map((e) => e.key),
          citations: [
            { doc: item.doc, line: item.line, role: "prd", what: `Not doing: "${item.text}"` },
            ...entryHits.map((e) => entryCite(e, "tdd")),
            ...riskHits.map((r) => ({ doc: r.doc, line: r.line, role: "tdd" as const, what: `${r.section} risk "${r.text.replace(/\.$/, "")}"` })),
          ],
          subjects: [
            { key: `${item.doc}#not-doing:${item.text}`, hash: item.text_hash },
            ...entryHits.map((e) => ({ key: e.key, hash: e.text_hash })),
            ...riskHits.map((r) => ({ key: `${r.doc}#risk:${r.text}`, hash: r.text_hash })),
          ],
        });
      }
    }
  }
  return out;
}

// DR-3 PRD newer: PRD requirements whose text changed after the TDD's last commit.
function dr3({ index, prdChanges }: DriftContext): Draft[] {
  if (prdChanges === null) return [];
  const byKey = new Map(index.entries.map((e) => [e.key as string, e]));
  return prdChanges.map((c) => {
    const e = byKey.get(c.key);
    const id = e?.id ?? c.key;
    return {
      rule: "DR-3",
      message: `${id} was ${c.change} in the PRD after the TDD's last commit ${c.tdd_commit.slice(0, 7)}.`,
      ids: [c.key],
      citations: [
        { doc: c.prd, line: c.line, role: "prd", what: id },
        { doc: c.tdd, line: 1, role: "tdd", what: `last commit ${c.tdd_commit.slice(0, 7)}` },
      ],
      subjects: [{ key: c.key, hash: e?.text_hash ?? "" }, { key: `${c.tdd}@${c.tdd_commit}`, hash: "" }],
    };
  });
}

// DR-4 Dangling citation: an ID cited where nothing defines it. Test case Covers lines are DR-6 instead.
function dr4({ index }: DriftContext): Draft[] {
  const dangling = index.citations.filter((c) => c.to === null && c.kind !== "covers" && canCheckCitation(index, c));
  const seen = new Map<string, Draft>();
  for (const c of dangling) {
    const k = `${c.doc}#${c.id}`;
    const prior = seen.get(k);
    const cite: Cite = { doc: c.doc, line: c.line, role: "doc", what: c.id };
    if (prior) {
      seen.set(k, { ...prior, citations: [...prior.citations, cite] });
      continue;
    }
    seen.set(k, {
      rule: "DR-4",
      message: `${c.id} is cited but no document in its group defines it.`,
      ids: [c.id],
      citations: [cite],
      subjects: [{ key: k, hash: "" }],
    });
  }
  return [...seen.values()];
}

// DR-5 Orphan matrix row: no PRD column value. A warning until D6 (the PRD column) is adopted.
function dr5({ index }: DriftContext): Draft[] {
  const out: Draft[] = [];
  const sourced = new Set(index.citations.filter((c) => c.kind === "sources" && c.family === "FR" && c.from).map((c) => c.from as string));
  for (const t of index.matrix_tables) {
    if (!hasKind(groupDocs(index, t.doc), "prd")) continue;
    if (!t.has_prd_column) {
      out.push({
        rule: "DR-5",
        message: `Matrix table "${t.section}" has no PRD column, so its ${t.rows.length} rows have no explicit PRD mapping.`,
        ids: [...t.rows],
        citations: [{ doc: t.doc, line: t.line, role: "tdd", what: `matrix "${t.section}"` }],
        subjects: [{ key: `${t.doc}#matrix:${t.section}`, hash: "" }],
      });
      continue;
    }
    for (const row of t.rows.filter((r) => !sourced.has(r))) {
      const e = index.entries.find((x) => x.key === row)!;
      out.push({
        rule: "DR-5",
        message: `${e.id} names no PRD requirement in its PRD column.`,
        ids: [row],
        citations: [entryCite(e, "tdd")],
        subjects: [{ key: row, hash: e.text_hash }],
      });
    }
  }
  return out;
}

// DR-6 A test case covers an ID the PRD does not define.
function dr6({ index }: DriftContext): Draft[] {
  return index.citations
    .filter((c) => c.kind === "covers" && c.to === null && canCheckCitation(index, c))
    .map((c) => ({
      rule: "DR-6",
      message: `${c.from ? c.from.split("#")[1] : "A test case"} covers ${c.id}, which the PRD does not define.`,
      ids: [c.id],
      citations: [{ doc: c.doc, line: c.line, role: "tcs", what: c.id }],
      subjects: [{ key: `${c.from ?? c.doc}->${c.id}`, hash: "" }],
    }));
}

const RULES: readonly RuleSpec[] = [
  {
    id: "DR-1", title: "Uncovered", severity: "warn", run: dr1,
    advice: "Link this requirement from the design entries or test cases in the provided documents.",
  },
  {
    id: "DR-2", title: "Scope conflict", severity: "fail", run: dr2,
    advice: "Decide which document is right. Drop the work from the TDD, or move the item out of the PRD's \"Not doing\" list. If both are right, accept the finding with a reason.",
  },
  {
    id: "DR-3", title: "PRD newer", severity: "warn", run: dr3,
    advice: "Read the PRD change and update the TDD rows that cite it, even if only to confirm they still hold.",
  },
  {
    id: "DR-4", title: "Dangling citation", severity: "warn", run: dr4,
    advice: "Point the citation at an ID that exists, or define the ID it names.",
  },
  {
    id: "DR-5", title: "Orphan matrix row", severity: "warn", run: dr5,
    advice: "Say which PRD requirement each row serves, so a PRD change reaches it.",
  },
  {
    id: "DR-6", title: "Covers an undefined ID", severity: "warn", run: dr6,
    advice: "Fix the test case's covers list, or add the requirement to the PRD.",
  },
];

/** Advice for a rule; agent-written rules get the generic version. */
export function adviceFor(rule: string): string {
  return RULES.find((r) => r.id === rule)?.advice ?? "Read the cited lines and fix the document that is wrong, or accept the finding with a reason.";
}

export function fingerprint(rule: string, subjects: readonly Subject[]): string {
  const parts = subjects.map((s) => `${s.key}@${s.hash}`).sort();
  return `${rule}:${shortHash([rule, ...parts])}`;
}

export function runRules(ctx: DriftContext): Finding[] {
  // Fingerprints name a document by its group and kind, not its path, so renaming a file keeps them.
  // That name is unique only for the group's one document of a kind; with two, each keeps its path,
  // or accepting a finding in one would waive the same finding in the other.
  const sharesKind = (d: DocInfo) => ctx.index.docs.some((o) => o !== d && o.group === d.group && o.kind === d.kind);
  const alias = ctx.index.docs.filter((d) => !sharesKind(d)).map((d) => [d.path as string, `${d.group}:${d.kind}`] as const);
  const stable = (s: Subject): Subject => {
    const hit = alias.find(([path]) => s.key.startsWith(path));
    return hit ? { ...s, key: hit[1] + s.key.slice(hit[0].length) } : s;
  };
  return RULES.flatMap((rule) =>
    rule.run(ctx).map(({ subjects, ...d }) => ({
      ...d,
      title: rule.title,
      severity: rule.severity,
      fingerprint: fingerprint(rule.id, subjects.map(stable)),
      status: "open" as const,
      source: "tails",
    })),
  );
}

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(compareBy((f) => f.rule, (f) => f.citations[0]?.doc ?? "", (f) => f.citations[0]?.line ?? 0, (f) => f.fingerprint));
}
