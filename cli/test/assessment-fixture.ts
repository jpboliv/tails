import type { Assessment } from "../src/assessment.js";

export const SPEC_SHA = "a".repeat(40);
export const CODE_SHA = "b".repeat(40);
export const LOCATION = "acme/docs/tdds/queue.md";
export const RESULT_KEY = `${LOCATION}#WL-01`;

export function assessment(): Assessment {
  return {
    schema: "tails.verdict/2", checker: { name: "deemaze/spec-conformance", version: "18257ce" }, checked_at: "2026-11-04T10:00:00Z",
    pr: { repo: "acme/api", number: 9, head_sha: CODE_SHA }, scope: { basis: "inferred", tickets: [], description: "Queue endpoint sections touched by this PR; no ticket found." },
    sources: [{ key: "design", kind: "tdd", location: LOCATION, revision: SPEC_SHA, purpose: "baseline" }],
    overall: "conforms", summary: "The endpoint follows the design.",
    results: [{ key: RESULT_KEY, id: "WL-01", source: "design", requirement: "Join returns 201.", derived: false, verdict: "met", spec: { source: "design", line: 3, quote: "Join returns 201." }, code: [{ path: "src/queue.ts", line: 8, quote: "return 201;" }], note: "Code reviewed; no test run observed.", decision_ids: [], defect_ids: [], moved_to: null }],
    decisions: [], spec_defects: [], manual_checks: [], not_checked: [{ source: "ticket", reason: "No ticket referenced by the PR." }],
  };
}

export function deviating(): Assessment {
  const a = assessment();
  return { ...a, overall: "does_not_conform", results: [{ ...a.results[0]!, verdict: "deviates", decision_ids: ["D1"] }], decisions: [{
    id: "D1", kind: "deviates", results: [RESULT_KEY], spec_says: "Join returns 201.", pr_does: "Join returns 200.", impact: "Clients see a different status.", change_pr: "Return 201.", update_specs: [{ source: "design", change: "Change WL-01 to 200." }], who_decides: "Product and engineering", declared: false, documentation_prs: [],
  }] };
}
