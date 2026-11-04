// Assessment boundary: schema validation followed by cross-reference and verdict consistency checks.
import { Ajv } from "ajv";
import { readFileSync } from "node:fs";
import { TailsInputError } from "./model.js";

export interface SpecEvidence { readonly source: string; readonly line: number | null; readonly quote: string }
export interface CodeEvidence { readonly path: string; readonly line: number; readonly quote: string }
export interface AssessmentSource {
  readonly key: string;
  readonly kind: "prd" | "tdd" | "tcs" | "ticket";
  /** GitHub documents use owner/repo/path; tracker documents use their canonical URL. */
  readonly location: string;
  readonly revision: string;
  readonly purpose: "baseline" | "proposed";
}
export type Outcome = "met" | "missing" | "deviates" | "not_checkable" | "blocked" | "moved" | "unresolved";
export interface AssessmentResult {
  readonly key: string;
  readonly id: string;
  readonly source: string;
  readonly requirement: string;
  readonly derived: boolean;
  readonly verdict: Outcome;
  readonly spec: SpecEvidence;
  readonly code: readonly CodeEvidence[];
  readonly note: string;
  readonly decision_ids: readonly string[];
  readonly defect_ids: readonly string[];
  readonly moved_to: string | null;
}
export interface Decision {
  readonly id: string;
  readonly kind: "missing" | "deviates" | "addition" | "early_work" | "decides_blocked";
  readonly results: readonly string[];
  readonly spec_says: string;
  readonly pr_does: string;
  readonly impact: string;
  readonly change_pr: string;
  readonly update_specs: readonly { readonly source: string; readonly change: string }[];
  readonly who_decides: string;
  readonly declared: boolean;
  readonly documentation_prs: readonly string[];
}
export interface SpecDefect {
  readonly id: string;
  readonly kind: "contradiction" | "vague" | "missing_id" | "undefined_id" | "duplicate_id" | "missing_contract" | "process_gap";
  readonly results: readonly string[];
  readonly evidence: readonly SpecEvidence[];
  readonly message: string;
  readonly suggested_change: string;
}
export interface Assessment {
  readonly schema: "tails.verdict/2";
  readonly checker: { readonly name: string; readonly version: string };
  readonly checked_at: string;
  readonly pr: { readonly repo: string; readonly number: number; readonly head_sha: string };
  readonly scope: { readonly basis: "ticket" | "inferred"; readonly tickets: readonly string[]; readonly description: string };
  readonly sources: readonly AssessmentSource[];
  readonly overall: "conforms" | "does_not_conform" | "cannot_check";
  readonly summary: string;
  readonly results: readonly AssessmentResult[];
  readonly decisions: readonly Decision[];
  readonly spec_defects: readonly SpecDefect[];
  readonly manual_checks: readonly { readonly result: string; readonly where: string; readonly check: string; readonly expected: string }[];
  readonly not_checked: readonly { readonly source: string; readonly reason: string }[];
}

const schema = JSON.parse(readFileSync(new URL("../../schemas/tails.verdict-2.schema.json", import.meta.url), "utf8"));
const validate = new Ajv({ allErrors: true, strict: true }).compile<Assessment>(schema);

export function parseAssessment(text: string, file: string): Assessment {
  const fail = (message: string): never => { throw new TailsInputError(`${file}: ${message}`); };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail("not valid JSON"); }
  if (!validate(raw)) return fail(validate.errors!.slice(0, 5).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; "));
  const a = raw;
  const unique = <T>(items: readonly T[], key: (x: T) => string, kind: string): Map<string, T> => {
    const map = new Map<string, T>();
    for (const item of items) {
      const id = key(item);
      if (map.has(id)) fail(`duplicate ${kind} "${id}"`);
      map.set(id, item);
    }
    return map;
  };
  const checkedAt = Date.parse(a.checked_at);
  if (!Number.isFinite(checkedAt) || new Date(checkedAt).toISOString().slice(0, 19) !== a.checked_at.slice(0, 19)) fail("checked_at is not a date");
  const sources = unique(a.sources, (s) => s.key, "source");
  const results = unique(a.results, (r) => r.key, "result");
  const decisions = unique(a.decisions, (d) => d.id, "decision");
  const defects = unique(a.spec_defects, (d) => d.id, "spec defect");
  const source = (key: string) => sources.get(key) ?? fail(`unknown source "${key}"`);
  const result = (key: string) => results.get(key) ?? fail(`unknown result "${key}"`);
  const evidence = (e: SpecEvidence) => {
    const s = source(e.source);
    if (s.kind !== "ticket" && !/^https?:\/\//.test(s.location) && e.line === null) fail(`${s.key}: file evidence needs a line number`);
  };
  if (a.scope.basis === "ticket" && !a.scope.tickets.length) fail("ticket scope needs at least one ticket");
  for (const r of a.results) {
    const s = source(r.source);
    if (s.purpose !== "baseline") fail(`${r.key}: verdicts must assess the baseline, not a proposed spec`);
    if (r.key !== `${s.location}#${r.id}`) fail(`${r.key}: result key must be source location + # + requirement ID`);
    if (r.spec.source !== r.source) fail(`${r.key}: requirement quote must cite its defining source`);
    evidence(r.spec);
    for (const e of r.code) if (e.path.startsWith("/") || e.path.split(/[\\/]/).some((p) => p === ".." || p === ".") || e.path.includes("\0")) fail(`${r.key}: code evidence needs a repository-relative path`);
    if (r.verdict === "met" && !r.code.length) fail(`${r.key}: Met needs code evidence`);
    if (r.verdict === "moved" && !r.moved_to) fail(`${r.key}: moved requirement needs its destination ticket`);
    if (r.verdict !== "moved" && r.moved_to !== null) fail(`${r.key}: only moved requirements have moved_to`);
    for (const id of r.decision_ids) if (!decisions.get(id)?.results.includes(r.key)) fail(`${r.key}: decision "${id}" must link back to this result`);
    for (const id of r.defect_ids) if (!defects.get(id)?.results.includes(r.key)) fail(`${r.key}: defect "${id}" must link back to this result`);
    if (["missing", "deviates"].includes(r.verdict) && !r.decision_ids.length && !r.defect_ids.some((id) => defects.get(id)?.kind === "contradiction")) fail(`${r.key}: ${r.verdict} needs a decision or a contradictory-spec defect`);
    if (r.verdict === "unresolved" && !r.defect_ids.length) fail(`${r.key}: unresolved requirements need a spec defect`);
    if (r.derived && !r.defect_ids.some((id) => defects.get(id)?.kind === "missing_id")) fail(`${r.key}: derived requirements need a missing-ID defect`);
    if (r.verdict === "not_checkable" && !a.manual_checks.some((m) => m.result === r.key)) fail(`${r.key}: not_checkable needs a concrete manual check`);
  }
  for (const d of a.decisions) {
    for (const key of d.results) if (!result(key).decision_ids.includes(d.id)) fail(`${d.id}: result ${key} must link back to this decision`);
    for (const update of d.update_specs) source(update.source);
  }
  for (const d of a.spec_defects) {
    for (const key of d.results) if (!result(key).defect_ids.includes(d.id)) fail(`${d.id}: result ${key} must link back to this defect`);
    for (const e of d.evidence) evidence(e);
  }
  for (const m of a.manual_checks) result(m.result);
  if (a.overall === "cannot_check") {
    if (a.results.length || a.decisions.length) fail("cannot_check must not invent requirement verdicts or decisions");
    if (!a.not_checked.length && !a.spec_defects.length) fail("cannot_check needs the missing context or spec defect");
  } else {
    if (!a.sources.some((s) => s.kind === "tdd" && s.purpose === "baseline")) fail("conformance requires a baseline design spec");
    if (!a.results.length) fail("a checkable assessment needs requirements");
    const expected = a.decisions.length ? "does_not_conform" : "conforms";
    if (a.overall !== expected) fail(`overall must be ${expected}: it follows decisions, not spec defects or manual checks`);
  }
  return a;
}

export const prKey = (pr: Assessment["pr"]): string => `${pr.repo}#${pr.number}`;
export const OUTCOME_LABEL: Readonly<Record<Outcome, string>> = {
  met: "Met", missing: "Missing", deviates: "Deviates", not_checkable: "Not checkable from the diff",
  blocked: "Blocked", moved: "Moved to another ticket", unresolved: "Unresolved spec defect",
};
