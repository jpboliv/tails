// TDD contract records (deemaze-skills#108) are IDs like any other: indexed where a TDD bullet
// defines them, cited by their notes and other records, traced to the PRD, and read by DR-2.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, copyFixture, edit, fixture, read, siteOf, tmp } from "./helpers.js";

const TDD = "tdds/LIB-2-loans.md";
const PRD = "prds/LIB-1-loans.md";

interface Out {
  code: number;
  stderr: string;
  entries: { key: string; id: string; family: string; doc: string; line: number }[];
  citations: { doc: string; line: number; kind: string; id: string; from: string | null; to: string | null }[];
  findings: { rule: string; ids: string[]; message: string }[];
}

function run(repo: string): Out {
  const out = tmp();
  const r = cli("report", "--repo", repo, "--out", out);
  if (r.code === 2) return { code: 2, stderr: r.stderr, entries: [], citations: [], findings: [] };
  const ix = JSON.parse(read(join(out, "index.json")));
  const drift = JSON.parse(read(join(out, "drift.json")));
  return { code: r.code, stderr: r.stderr, entries: ix.entries, citations: ix.citations, findings: drift.findings };
}

test("a TDD bullet that opens with a bold record ID defines it, and an item can define several", () => {
  const { entries } = run(fixture("records"));
  const recs = entries.filter((e) => e.family === "REC").map((e) => `${e.id}@${e.line}`);
  assert.deepEqual(recs, ["LN-API-1@26", "LN-API-2@32", "LN-API-3@34", "LN-APP-1@44", "LN-APP-2@49", "LN-WEB-1@49"]);
  assert.ok(entries.filter((e) => e.family === "REC").every((e) => e.key === e.id), "records are unique across the repository, like matrix rows");
});

test("notes and records that cite a record resolve, so nothing dangles", () => {
  const { citations, findings } = run(fixture("records"));
  const verify = citations.filter((c) => c.doc === TDD && /^LN-/.test(c.id));
  assert.ok(verify.length >= 5);
  assert.deepEqual(verify.filter((c) => c.to === null), []);
  assert.deepEqual(findings.filter((f) => f.rule === "DR-4"), []);
});

test("a record that cites a PRD criterion counts as its design in the ledger", () => {
  const { citations } = run(fixture("records"));
  assert.ok(citations.some((c) => c.from === "LN-APP-1" && c.to === `${PRD}#FR-1.1`));
  const site = siteOf(fixture("records"));
  const epic = site.get("epics/LIB-1.html")!;
  assert.match(epic, /FR-1\.1<\/a>.*?LN-APP-1/s);
  assert.match(site.get("ids/tdds/LIB-2-loans/LN-APP-1.html")!, /<span class="chip neutral">Record<\/span>/, "a record gets its own ID page");
});

test("only TDDs define records, and a bold label in prose is never read as a broken one", () => {
  const repo = copyFixture("records");
  edit(join(repo, PRD), "**In:** borrowing", "- **LN-API-9** is not a record here.\n\n**In:** borrowing");
  edit(join(repo, TDD), "## 3. Architecture", "- **API-GW-Proxy** a prose label.\n\n## 3. Architecture");
  const { code, stderr, entries } = run(repo);
  assert.notEqual(code, 2, stderr);
  assert.ok(!entries.some((e) => e.id === "LN-API-9"));
});

test("a malformed record ID in a TDD is an input error that names the line", () => {
  const repo = copyFixture("records");
  edit(join(repo, TDD), "- **LN-API-2** A tool", "- **LN-API-2a** A tool");
  const { code, stderr } = run(repo);
  assert.equal(code, 2);
  assert.match(stderr, /tdds\/LIB-2-loans\.md:32: malformed record ID "LN-API-2a"/);
});

test("a test case specification can map coverage in one table instead of Covers: lines", () => {
  const repo = copyFixture("records");
  const tcs = join(repo, "test-case-specs/LIB-1-loans.md");
  const lines = read(tcs).split("\n").filter((l) => !l.startsWith("- **Covers:**"));
  const table = ["## Coverage", "", "| FR | Test cases | Note |", "| --- | --- | --- |", "| FR-1.1 | TC-01 | |", "| FR-1.2 | TC-02, TC-09 | TC-09 is not written yet. |", "| FR-2.1 | TC-03 | |", ""];
  lines.splice(4, 0, ...table);
  writeFileSync(tcs, lines.join("\n"));
  const { citations, findings } = run(repo);
  const covers = citations.filter((c) => c.kind === "covers").map((c) => `${c.from!.split("#")[1]}→${c.id}`);
  assert.deepEqual(covers.sort(), ["TC-01→FR-1.1", "TC-02→FR-1.2", "TC-03→FR-2.1"]);
  assert.deepEqual(findings.filter((f) => f.rule === "DR-1"), [], "every live criterion is still covered");
  assert.ok(findings.some((f) => f.rule === "DR-4" && f.message.includes("TC-09")), "a test case the table names but nobody wrote is dangling");
});

test("a retired criterion needs no design and no test: no DR-1, and no row in the ledger", () => {
  const { findings } = run(fixture("records"));
  assert.ok(!findings.some((f) => f.ids.includes(`${PRD}#FR-1.3`)));
  const epic = siteOf(fixture("records")).get("epics/LIB-1.html")!;
  assert.doesNotMatch(epic, />FR-1\.3<\/a><\/td>/);
  assert.match(epic, />FR-1\.2<\/a><\/td>/);
});

test("DR-2 does not read records, whose prose matched only by accident on a real TDD", () => {
  const repo = copyFixture("records");
  // LN-API-3 "emails a receipt": a word match, which DR-2 would fail the spec PR on.
  edit(join(repo, PRD), "| Paid deposits | The library does not take payments. |", "| Paid deposits | The library does not take payments. |\n| Emails | The desk prints receipts. |");
  const { findings } = run(repo);
  assert.deepEqual(findings.filter((f) => f.rule === "DR-2"), []);
});
