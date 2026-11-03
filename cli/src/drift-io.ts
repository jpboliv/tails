// Drift boundary: accepted findings (.tails/accepted.yml), agent-written findings
// (tails.drift/1 files), and the two outputs, drift.json and drift.md.
import { parseYaml } from "./yaml-lite.js";
import { fingerprint, sortFindings, type Cite, type Finding } from "./drift.js";
import { TailsInputError, type DocPath } from "./model.js";
import { textHash } from "./util.js";

export interface Acceptance {
  readonly fingerprint: string;
  readonly reason: string;
  readonly by: string;
  readonly date: string;
}

export function parseAccepted(text: string | null, file = ".tails/accepted.yml"): Acceptance[] {
  if (text === null) return [];
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    throw new TailsInputError(`${file}: not valid YAML (${(e as Error).message.split("\n")[0]})`);
  }
  if (raw === null || raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : (raw as { accepted?: unknown }).accepted;
  if (!Array.isArray(list)) throw new TailsInputError(`${file}: expected a list of accepted findings`);
  return list.map((item, i) => {
    const r = item as Record<string, unknown>;
    for (const k of ["fingerprint", "reason", "by", "date"]) {
      const v = r?.[k];
      if (typeof v !== "string" || v === "") throw new TailsInputError(`${file}: entry ${i + 1} needs "${k}"`);
    }
    return { fingerprint: r.fingerprint as string, reason: r.reason as string, by: r.by as string, date: r.date as string };
  });
}

/** Findings written by an agent in the tails.drift/1 format, labelled with their source. Unknown schema is an input error (INV-7). */
export function parseExtraFindings(text: string, file: string): Finding[] {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new TailsInputError(`${file}: not valid JSON`);
  }
  if (raw?.schema !== "tails.drift/1") throw new TailsInputError(`${file}: unknown schema ${JSON.stringify(raw?.schema)}; expected "tails.drift/1"`);
  const source = typeof raw.source === "string" ? raw.source : file;
  if (!Array.isArray(raw.findings)) throw new TailsInputError(`${file}: "findings" must be a list`);
  return raw.findings.map((f: Record<string, unknown> | null, i: number) => {
    const where = `${file}: finding ${i + 1}`;
    if (typeof f !== "object" || f === null) throw new TailsInputError(`${where} must be an object`);
    if (typeof f.rule !== "string") throw new TailsInputError(`${where} needs a string "rule"`);
    if (!Array.isArray(f.citations) || f.citations.length === 0) throw new TailsInputError(`${where} needs at least one citation (INV-5)`);
    const citations: Cite[] = f.citations.map((c: Record<string, unknown> | null) => {
      if (typeof c?.doc !== "string" || !c.doc.trim() || typeof c.line !== "number" || !Number.isInteger(c.line) || c.line < 1) {
        throw new TailsInputError(`${where}: every citation needs a nonempty "doc" and a positive integer "line"`);
      }
      return { doc: c.doc as DocPath, line: c.line, role: "doc", what: typeof c.what === "string" ? c.what : "" };
    });
    const ids = Array.isArray(f.ids) ? f.ids.map(String) : [];
    return {
      rule: f.rule,
      title: typeof f.title === "string" ? f.title : f.rule,
      severity: "warn",
      message: typeof f.message === "string" ? f.message : "",
      ids,
      citations,
      fingerprint: typeof f.fingerprint === "string" ? f.fingerprint : fingerprint(f.rule, [
        { key: source, hash: textHash(JSON.stringify([f.message ?? "", ids, citations])) },
      ]),
      status: "open",
      source,
    } satisfies Finding;
  });
}

export function applyAccepted(findings: readonly Finding[], accepted: readonly Acceptance[]): Finding[] {
  const byFp = new Map(accepted.map((a) => [a.fingerprint, a]));
  return sortFindings(
    findings.map((f) => {
      const a = byFp.get(f.fingerprint);
      return a ? { ...f, status: "accepted" as const, accepted: { reason: a.reason, by: a.by, date: a.date } } : f;
    }),
  );
}

export interface DriftReport {
  readonly schema: "tails.drift/1";
  readonly source: "tails";
  readonly commit: string | null;
  readonly findings: readonly Finding[];
}

const ROLE_LABEL: Record<Cite["role"], string> = { prd: "PRD", tdd: "TDD", tcs: "TCS", doc: "DOC" };

/** The block shape from TDD §4.4.4: one line per side, IDs grouped per document. */
export function citationLines(f: Finding): string[] {
  const groups = new Map<string, Cite[]>();
  for (const c of f.citations) {
    const k = `${c.role}\t${c.doc}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  const rows = [...groups.values()].map((cs) => {
    const c0 = cs[0]!;
    const where = cs.length === 1 ? `${c0.doc}:${c0.line}` : c0.doc;
    return { label: ROLE_LABEL[c0.role], where, what: cs.map((c) => c.what).join(", ") };
  });
  const width = Math.max(...rows.map((r) => r.where.length));
  return rows.map((r) => `  ${r.label.padEnd(4)} ${r.where.padEnd(width)}  ${r.what}`);
}

export function driftMarkdown(report: DriftReport): string {
  const open = report.findings.filter((f) => f.status === "open");
  const accepted = report.findings.filter((f) => f.status === "accepted");
  const failing = open.filter((f) => f.severity === "fail");
  const out: string[] = ["# Spec drift", ""];
  out.push(`${open.length} open (${failing.length} failing), ${accepted.length} accepted.${report.commit ? ` Commit \`${report.commit.slice(0, 12)}\`.` : ""}`, "");
  const section = (title: string, list: readonly Finding[]) => {
    if (list.length === 0) return;
    out.push(`## ${title}`, "");
    for (const f of list) {
      out.push("```text", `${f.rule} ${f.title}${f.source !== "tails" ? ` (from ${f.source})` : ""}`, ...citationLines(f), "```", "");
      out.push(`${f.message}`, "");
      if (f.citations.length > 1 && f.citations.some((c, i) => i > 0 && c.doc === f.citations[i - 1]!.doc)) {
        out.push(f.citations.map((c) => `\`${c.doc}:${c.line}\` ${c.what}`).join(" · "), "");
      }
      if (f.accepted) out.push(`Accepted by ${f.accepted.by} on ${f.accepted.date}: ${f.accepted.reason}`, "");
      out.push(`Fingerprint \`${f.fingerprint}\`${f.severity === "warn" ? " · warning" : " · failing"}`, "");
    }
  };
  section("Open", open);
  section("Accepted", accepted);
  return out.join("\n").trimEnd() + "\n";
}
