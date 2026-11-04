import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAssessment } from "../src/assessment.js";
import { assessment, deviating, RESULT_KEY } from "./assessment-fixture.js";

const parse = (value: unknown) => parseAssessment(JSON.stringify(value), "review.json");

test("assessment contract preserves both decision options and refuses misleading overall verdicts", () => {
  const a = deviating();
  assert.deepEqual(parse(a), a);
  assert.throws(() => parse({ ...a, overall: "conforms" }), /overall must be does_not_conform/);
  assert.throws(() => parse({ ...a, decisions: [] }), /must link back/);
  assert.throws(() => parse({ ...assessment(), overall: "does_not_conform" }), /overall must be conforms/);
});

test("Conforms can retain manual checks and blocked requirements without claiming verification", () => {
  const a = assessment();
  const manual = { ...a, results: [{ ...a.results[0]!, verdict: "not_checkable", code: [] }], manual_checks: [{ result: RESULT_KEY, where: "Staging dashboard", check: "Inspect queue delay", expected: "Below two seconds" }] };
  assert.equal(parse(manual).overall, "conforms");
  assert.throws(() => parse({ ...manual, manual_checks: [] }), /needs a concrete manual check/);
  assert.equal(parse({ ...a, results: [{ ...a.results[0]!, verdict: "blocked", code: [] }] }).overall, "conforms");
});

test("missing ticket/spec is representable without fabricated identities", () => {
  const a = assessment();
  const absent = { ...a, sources: [], overall: "cannot_check", results: [], not_checked: [{ source: "TDD", reason: "No design spec found in linked sources." }] };
  assert.equal(parse(absent).sources.length, 0);
  assert.throws(() => parse({ ...absent, results: a.results }), /unknown source/);
});

test("spec contradictions stay separate from decisions and require reciprocal evidence links", () => {
  const a = assessment();
  const contradictory = { ...a, results: [{ ...a.results[0]!, verdict: "missing", code: [], defect_ids: ["S1"] }], spec_defects: [{ id: "S1", kind: "contradiction", results: [RESULT_KEY], evidence: [a.results[0]!.spec], message: "Two contracts disagree.", suggested_change: "Choose one contract." }] };
  assert.equal(parse(contradictory).overall, "conforms");
  assert.throws(() => parse({ ...contradictory, spec_defects: [] }), /must link back/);
});

test("validation rejects invalid evidence, unqualified identities and unknown schema fields", () => {
  const a = assessment();
  for (const result of [
    { ...a.results[0]!, key: "WL-01" },
    { ...a.results[0]!, code: [] },
    { ...a.results[0]!, code: [{ path: "../secret", line: 1, quote: "x" }] },
    { ...a.results[0]!, code: [{ path: "x", line: 0, quote: "x" }] },
    { ...a.results[0]!, spec: { source: "design", line: null, quote: "x" } },
    { ...a.results[0]!, derived: true },
    { ...a.results[0]!, verdict: "moved" },
  ]) assert.throws(() => parse({ ...a, results: [result] }), /review.json:/);
  assert.throws(() => parse({ ...a, results: [...a.results, ...a.results] }), /duplicate result/);
  assert.throws(() => parse({ ...a, typo: true }), /additional properties/);
  assert.throws(() => parse({ ...a, sources: [{ ...a.sources[0]!, purpose: "proposed" }] }), /baseline/);
});
