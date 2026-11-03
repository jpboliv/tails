// The per-epic requirement ledger: each PRD criterion, the TDD rows that cite it, and the test
// cases that cover it. It answers "is every requirement designed and tested?" for one epic.
import type { Finding } from "./drift.js";
import { hasKind } from "./availability.js";
import type { Citation, Definition, DocInfo, SpecIndex } from "./model.js";
import { isRetired } from "./reader.js";
import { compareBy } from "./util.js";

/** Where a requirement stands, from the documents alone. Nothing here says what shipped. */
export type Trace = "designed_and_tested" | "tested" | "designed" | "untraced" | "design_only" | "pending";

export const TRACE_LABEL: Readonly<Record<Trace, string>> = {
  designed_and_tested: "Designed and tested",
  tested: "Tested",
  designed: "Designed, no test",
  untraced: "Not traced",
  design_only: "Designed",
  pending: "Not assessed",
};

export interface Requirement {
  readonly entry: Definition;
  /** The parent heading (FR-9 for FR-9.1), when the PRD has one. */
  readonly parent: Definition | null;
  /** TDD definitions that cite this requirement. */
  readonly design: readonly Definition[];
  /** Test cases that cover or cite it. */
  readonly tests: readonly Definition[];
  readonly trace: Trace;
  readonly findings: readonly Finding[];
}

export interface Epic {
  readonly group: string;
  readonly title: string;
  readonly docs: readonly DocInfo[];
  readonly requirements: readonly Requirement[];
  /** True when some TDD row in the epic cites a PRD requirement. When false, the design column says nothing. */
  readonly tddCitesPrd: boolean;
  readonly findings: readonly Finding[];
  readonly counts: Readonly<Record<Trace, number>>;
}

const ORDER: readonly DocInfo["kind"][] = ["prd", "tdd", "tcs"];

export function epics(index: SpecIndex, findings: readonly Finding[]): Epic[] {
  const byKey = new Map(index.entries.map((e) => [e.key as string, e]));
  const kindOf = new Map(index.docs.map((d) => [d.path as string, d.kind]));
  const citersOf = new Map<string, Citation[]>();
  for (const c of index.citations) if (c.to && c.from) citersOf.set(c.to, [...(citersOf.get(c.to) ?? []), c]);
  const open = findings.filter((f) => f.status === "open");

  return [...new Set(index.docs.map((d) => d.group))].sort().map((group) => {
    const docs = index.docs.filter((d) => d.group === group).sort(compareBy((d) => ORDER.indexOf(d.kind), (d) => d.path));
    const paths = new Set<string>(docs.map((d) => d.path));
    const prds = docs.filter((d) => d.kind === "prd").map((d) => d.path as string);
    const from = (kind: DocInfo["kind"], key: string) =>
      [...new Map((citersOf.get(key) ?? []).filter((c) => kindOf.get(c.doc) === kind).map((c) => [c.from as string, byKey.get(c.from as string)!])).values()]
        .sort(compareBy((e) => e.doc, (e) => e.line));
    const requirements = index.entries
      // A retired criterion keeps its ID but asks for nothing, so the ledger leaves it out.
      .filter((e) => e.family === "FR" && e.id.includes(".") && prds.includes(e.doc) && !isRetired(e.text))
      .map((entry): Requirement => {
        const design = from("tdd", entry.key);
        const tests = from("tcs", entry.key);
        const trace: Trace = design.length && tests.length ? "designed_and_tested" : tests.length ? "tested"
          : design.length ? hasKind(docs, "tcs") ? "designed" : "design_only"
            : hasKind(docs, "tdd") || hasKind(docs, "tcs") ? "untraced" : "pending";
        return {
          entry,
          parent: byKey.get(`${entry.doc}#${entry.id.split(".")[0]}`) ?? null,
          design,
          tests,
          trace,
          findings: open.filter((f) => f.ids.includes(entry.key)),
        };
      });
    const counts = { designed_and_tested: 0, tested: 0, designed: 0, untraced: 0, design_only: 0, pending: 0 };
    for (const r of requirements) counts[r.trace]++;
    return {
      group,
      title: (docs.find((d) => d.kind === "prd") ?? docs[0])!.title.replace(/\s+[—–-]\s+(PRD|Technical Design|Test case specification)$/i, "").replace(/^Technical Design\s+[—–-]\s+/i, ""),
      docs,
      requirements,
      tddCitesPrd: index.citations.some((c) => paths.has(c.doc) && kindOf.get(c.doc) === "tdd" && c.to !== null && prds.some((p) => c.to!.startsWith(`${p}#`))),
      findings: findings.filter((f) => f.citations.some((c) => paths.has(c.doc))),
      counts,
    };
  });
}
