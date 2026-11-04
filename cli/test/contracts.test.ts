import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { buildIndex, type SourceDoc } from "../src/indexer.js";
import { epics } from "../src/ledger.js";
import type { DocKind, DocPath } from "../src/model.js";
import { review } from "../src/review.js";
import { runRules } from "../src/drift.js";

const doc = (kind: DocKind, text: string, path = `${kind}/example.md`): SourceDoc => ({ kind, path: path as DocPath, text });
const index = (...docs: SourceDoc[]) => buildIndex(docs, DEFAULT_CONFIG, { group: "example" });

test("short Deemaze records and table-defined QA cases trace product requirements", () => {
  const result = index(
    doc("prd", "# Feature\n\n- **FR-1.1** Join a queue.\n- **FR-1.2** Leave a queue.\n"),
    doc("tdd", "# Design\n\nTicket APP-42.\n\n- **WL-01** Join. (PRD FR-1.1)\n- **WL-02** Leave. (PRD FR-1.2)\n\n_Verify (WL-01, WL-02):_ Request tests.\n"),
    doc("tcs", "# Tests\n\n| Test case | Covers | Steps | Expected result |\n| --- | --- | --- | --- |\n| TC-01 | FR-1.1 | Join | In queue |\n| **TC-02** | FR-1.2 | Leave | Out of queue |\n"),
  );
  assert.equal(result.entries.length, 6);
  assert.equal(result.entries.find((e) => e.id === "WL-01")?.key, "tdd/example.md#WL-01");
  assert.ok(!result.citations.some((c) => c.id === "APP-42"));
  assert.deepEqual(epics(result, [])[0]!.requirements.map((r) => r.trace), ["designed_and_tested", "designed_and_tested"]);
  assert.deepEqual(runRules({ index: result, config: DEFAULT_CONFIG, prdChanges: null }), []);
});

test("heading records define IDs and own their body references", () => {
  const result = index(doc("tdd", "# Design\n\n### **EX-API-1** Response\n\nReturns 200.\n\n#### Details\n\nSee EX-API-2.\n\n### **EX-API-2** Errors\n\nReturns 422.\n"));
  const first = result.entries[0]!;
  assert.equal(first.id, "EX-API-1");
  assert.match(first.text, /Returns 200/);
  assert.doesNotMatch(first.text, /Returns 422/);
  assert.ok(result.citations.some((c) => c.from === first.key && c.to === "EX-API-2"));
});

test("contract edits in nested tables, fenced code and shared verification are detected", () => {
  const source = "# Design\n\n- **EX-API-1** Response:\n\n  | Field | Value |\n  | --- | --- |\n  | status | 200 |\n\n  ```json\n  {\"limit\": 10}\n  ```\n\n- **EX-API-2** Errors return 422.\n\n_Verify (EX-API-1, EX-API-2):_ Assert both outcomes.\n";
  const base = index(doc("tdd", source));
  for (const [before, after, ids] of [
    ["200", "201", ["EX-API-1"]],
    ['"limit": 10', '"limit": 20', ["EX-API-1"]],
    ["Assert both outcomes", "Assert both outcomes and retries", ["EX-API-1", "EX-API-2"]],
  ] as const) {
    const head = index(doc("tdd", source.replace(before, after)));
    assert.deepEqual(review(base, head, [], []).changed.map((e) => e.id), ids);
  }
  assert.equal(base.entries[0]!.verification?.length, 1);
  assert.doesNotMatch(base.entries[0]!.text, /Errors return/);
});

test("short IDs are scoped to their document and unrelated tickets do not become dangling records", () => {
  const result = index(
    doc("tdd", "# A\n\n- **WL-01** A.\n\nSee WL-02 and APP-42.\n", "tdd/a.md"),
    doc("tdd", "# B\n\n- **WL-01** B.\n", "tdd/b.md"),
  );
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.citations.map((c) => c.id), ["WL-02"]);
  assert.equal(runRules({ index: result, config: DEFAULT_CONFIG, prdChanges: null })[0]?.rule, "DR-4");
});

test("table coverage still reports undefined requirements", () => {
  const result = index(
    doc("prd", "# Product\n\n- **FR-1.1** Join.\n"),
    doc("tcs", "# Cases\n\n| Test case | Covers | Expected |\n| --- | --- | --- |\n| TC-01 | FR-1.9 | Joined |\n"),
  );
  assert.ok(runRules({ index: result, config: DEFAULT_CONFIG, prdChanges: null }).some((f) => f.rule === "DR-6"));
});

test("verification continuations and whitespace inside literals remain part of the contract", () => {
  const source = '# Design\n\n- **EX-API-1** Responds:\n\n  ```json\n  {"label": "a b"}\n  ```\n\n_Verify (EX-API-1):_ Assert the body\nand the status.\n';
  const before = index(doc("tdd", source));
  assert.match(before.entries[0]!.verification![0]!.text, /and the status/);
  for (const text of [source.replace("a b", "a  b"), source.replace("and the status", "and the headers")]) {
    assert.equal(review(before, index(doc("tdd", text)), [], []).changed.length, 1);
  }
});
