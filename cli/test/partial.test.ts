import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../src/config.js";
import { runRules } from "../src/drift.js";
import { buildIndex, type SourceDoc } from "../src/indexer.js";
import { epics } from "../src/ledger.js";
import type { DocPath } from "../src/model.js";
import { renderSite } from "../src/site.js";

const prd: SourceDoc = { path: "prds/report.md" as DocPath, kind: "prd", text: `# Reporting — PRD
Epic: REP-1

## FR-1 Reports
- **FR-1.1** Create a report.
- **FR-1.2** Download a report.
` };
const tdd: SourceDoc = { path: "tdds/report.md" as DocPath, kind: "tdd", text: `# Technical Design — Reporting
Epic: REP-1

## Contracts
- **RP-API-1** Create the report for FR-1.1. Verify with TC-01.
` };
const tcs: SourceDoc = { path: "test-case-specs/report.md" as DocPath, kind: "tcs", text: `# Reporting — Test case specification
Epic: REP-1

## TC-01 Create
- **Covers:** FR-1.1

## TC-02 Download
- **Covers:** FR-1.2
` };

function report(docs: readonly SourceDoc[]) {
  const index = buildIndex(docs, DEFAULT_CONFIG);
  const findings = runRules({ index, config: DEFAULT_CONFIG, prdChanges: null });
  return { index, findings, groups: epics(index, findings), site: renderSite(index, docs, findings) };
}

for (const docs of [[prd], [tdd], [tcs], [prd, tdd], [prd, tcs], [tdd, tcs], [prd, tdd, tcs]]) {
  test(`${docs.map((d) => d.kind).join(" + ")} renders with checks limited to the provided documents`, () => {
    const { site, findings } = report(docs);
    for (const path of ["index.html", "drift.html", "docs.html"]) {
      assert.ok(site.get(path)?.includes("Reporting"), path);
      assert.doesNotMatch(site.get(path)!, /Incomplete spec set|The specs agree/);
    }
    assert.ok(!findings.some((f) => f.rule === "DR-4" || f.rule === "DR-6"), JSON.stringify(findings));
    if (!docs.includes(prd) || docs.length === 1) assert.deepEqual(findings, []);
  });
}

test("a PRD alone has no coverage warnings, percentages or missing-design accusation", () => {
  const { site, groups } = report([prd]);
  const home = site.get("index.html")!;
  assert.match(home, /class="verdict info"/);
  assert.match(home, /<h2>PRD only<\/h2>/);
  assert.match(home, /Not provided: TDD, Test cases/);
  assert.match(home, /TDD not provided/);
  assert.match(home, /Test cases not provided/);
  assert.doesNotMatch(home, /<small>%<\/small>|The TDD names no PRD/);
  assert.ok(groups[0]!.requirements.every((r) => r.trace === "pending"));
  const ledger = site.get("epics/REP-1.html")!;
  assert.doesNotMatch(ledger, /<th scope="col">(?:TDD|Test cases)<\/th>|The TDD names no PRD/);
  assert.match(ledger, /chip neutral">Not assessed/);
  assert.match(site.get("docs.html")!, /data-category="prd"/);
  assert.doesNotMatch(site.get("docs.html")!, /data-choice="(?:tdd|tcs)"/);
});

test("PRD + TDD assesses design gaps while deferring absent test cases", () => {
  const { findings, groups, site } = report([prd, tdd]);
  assert.deepEqual(findings.map((f) => [f.rule, f.ids]), [["DR-1", ["prds/report.md#FR-1.2"]]]);
  assert.match(findings[0]!.message, /a design entry/);
  assert.doesNotMatch(findings[0]!.message, /test case/);
  assert.equal(groups[0]!.requirements[0]!.trace, "design_only");
  const home = site.get("index.html")!;
  assert.match(home, /Test coverage<\/span><span class="n">–<\/span><span class="l">Test cases not provided/);
  assert.match(home, /Design coverage<\/span><span class="n">50<small>%/);
  const ledger = site.get("epics/REP-1.html")!;
  assert.match(ledger, /<th scope="col">TDD<\/th>/);
  assert.doesNotMatch(ledger, /<th scope="col">Test cases<\/th>|Designed, no test/);
  assert.match(site.get("ids/tdds/report/RP-API-1.html")!, /References to <code>TC-01<\/code> were not checked/);
});

test("adding test cases enables their checks and coverage", () => {
  const { site, groups, findings } = report([prd, tdd, tcs]);
  assert.deepEqual(findings, []);
  assert.equal(groups[0]!.requirements[0]!.trace, "designed_and_tested");
  assert.match(site.get("index.html")!, /Test coverage<\/span><span class="n">100<small>%/);
  assert.match(site.get("epics/REP-1.html")!, /<th scope="col">Test cases<\/th>/);
  const broken = { ...tcs, text: tcs.text.replace("FR-1.2", "FR-9.9") };
  assert.ok(report([prd, tdd, broken]).findings.some((f) => f.rule === "DR-6"));
});

test("missing documents do not hide broken citations within provided document types", () => {
  const badPrd = { ...prd, text: prd.text + "\nSee FR-9.9.\n" };
  assert.deepEqual(report([badPrd]).findings.map((f) => f.rule), ["DR-4"]);
  const badTdd = { ...tdd, text: tdd.text + "\nSee INV-99 and FR-9.9.\n" };
  const solo = report([badTdd]).findings;
  assert.deepEqual(solo.map((f) => f.ids), [["INV-99"]]);
  assert.ok(report([prd, badTdd]).findings.some((f) => f.ids.includes("FR-9.9")));
});

test("a TDD alone defers PRD matrix mapping until the PRD is provided", () => {
  const matrix = { ...tdd, text: tdd.text + "\n## Matrix\n| ID | Rule |\n| --- | --- |\n| RP-API-2 | Download reports |\n" };
  assert.ok(!report([matrix]).findings.some((f) => f.rule === "DR-5"));
  assert.ok(report([prd, matrix]).findings.some((f) => f.rule === "DR-5"));
});

test("a complete feature does not enable checks or dilute coverage for a PRD-only feature", () => {
  const waiting = { ...prd, path: "prds/waiting.md" as DocPath, text: prd.text.replace("Reporting", "Waiting").replace("REP-1", "WAIT-1") };
  const { site, findings, groups } = report([prd, tdd, tcs, waiting]);
  assert.deepEqual(findings, []);
  assert.ok(groups.find((g) => g.group === "WAIT-1")!.requirements.every((r) => r.trace === "pending"));
  const home = site.get("index.html")!;
  assert.match(home, /2 of 2 have test cases · provided sets only/);
  assert.doesNotMatch(home, /2 of 4 have test cases/);
  assert.match(home, /Waiting · Not provided: TDD, Test cases/);
});

test("a prose-only PRD remains readable without requiring downstream documents or IDs", () => {
  const draft = { ...prd, text: "# Reporting — PRD\n\nEarly product notes.\n" };
  const { findings, site } = report([draft]);
  assert.deepEqual(findings, []);
  assert.match(site.get("prds/report.html")!, /Early product notes/);
  assert.match(site.get("index.html")!, /class="verdict info"/);
});
