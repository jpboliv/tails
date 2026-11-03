// S2 behaviour: drift findings on synthetic catalog and export specs.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, copyFixture, edit, fixture, read, tmp } from "./helpers.js";
import { parseExtraFindings } from "../src/drift-io.js";

interface JsonFinding {
  rule: string;
  severity: string;
  status: string;
  source: string;
  ids: string[];
  fingerprint: string;
  citations: { doc: string; line: number; role: string; what: string }[];
}

function drift(repo: string, ...flags: string[]) {
  const out = tmp();
  const r = cli("drift", "--repo", repo, "--out", out, ...flags);
  const json = JSON.parse(read(join(out, "drift.json"))) as { findings: JsonFinding[] };
  return { ...r, md: read(join(out, "drift.md")), findings: json.findings };
}

test("DR-2 reports the excluded scope with its source line and conflicting TDD entries", () => {
  const { md, findings } = drift(fixture("catalog"));
  const expected = [
    "DR-2 Scope conflict",
    '  PRD  prds/CAT-1-catalog.md:13  Not doing: "Archive migration"',
    '  TDD  tdds/CAT-2-catalog.md     D9, INV-14, BK-API-42, BK-API-44, BK-API-45, §7 risk "Archive records contain duplicates"',
  ].join("\n");
  assert.ok(md.includes(expected), `drift.md lacks the expected block:\n${md}`);

  const archive = findings.filter((f) => f.rule === "DR-2" && f.citations[0]!.what.includes("Archive"));
  assert.equal(archive.length, 1);
  assert.equal(archive[0]!.severity, "fail");
  assert.equal(archive[0]!.status, "open");
});

test("a failing finding fails drift --strict and nothing else", () => {
  assert.equal(drift(fixture("catalog")).code, 0);
  assert.equal(drift(fixture("catalog"), "--strict").code, 1);
  assert.equal(drift(fixture("acme"), "--strict").code, 0, "acme has warnings only");
});

test("a decision's rejected alternatives do not count as plans", () => {
  // D10 mentions Archive only in its alternatives column.
  const { findings } = drift(fixture("catalog"));
  const ids = findings.filter((f) => f.rule === "DR-2").flatMap((f) => f.ids);
  assert.ok(!ids.some((id) => id.endsWith("#D10")), ids.join(", "));
  // acme's D1 alternative is "a queue with emailed links, sent on a schedule"; the PRD is not doing scheduled email.
  assert.equal(drift(fixture("acme")).findings.filter((f) => f.rule === "DR-2").length, 0);
});

test("DR-2 ignores negated plans and evidence-only matches but keeps the scope conflict", () => {
  const dr2 = drift(fixture("catalog")).findings.filter((f) => f.rule === "DR-2");
  // INV-8 and BK-API-14 negate tenant lookup; D8 rejects offline editing;
  // BK-API-24 mentions barcode scanning only in its evidence column.
  const quiet = ["#INV-8", "#BK-API-14", "#D8", "#BK-API-24"];
  assert.deepEqual(dr2.flatMap((f) => f.ids).filter((id) => quiet.some((q) => id.endsWith(q))), []);
  assert.equal(dr2.length, 1);
  assert.match(dr2[0]!.citations[0]!.what, /Archive/);
});

test("a negation only silences what follows it in the same clause", () => {
  const repo = copyFixture("catalog");
  const tdd = join(repo, "tdds/CAT-2-catalog.md");
  // Turn the INV-8 false positive into a real plan: the negation now sits after the term.
  edit(tdd, "It never reads `X-Tenant` or `Session`.", "It reads `X-Tenant` and never `Session`.");
  const tenant = drift(repo).findings.filter((f) => f.rule === "DR-2" && f.citations[0]!.what.includes("Tenant"));
  assert.deepEqual(tenant.flatMap((f) => f.ids).map((id) => id.split("#")[1]), ["INV-8"]);

  // A negation in one sentence does not carry into the next.
  edit(tdd, "| D8 Offline editing | Not supported.", "| D8 Offline editing | Supported.");
  const offline = drift(repo).findings.filter((f) => f.rule === "DR-2" && f.citations[0]!.what.includes("Offline"));
  assert.deepEqual(offline.flatMap((f) => f.ids).map((id) => id.split("#")[1]), ["D8"]);
});

test("an accepted finding stays in the report but is no longer open", () => {
  const repo = copyFixture("catalog");
  const archive = drift(repo).findings.find((f) => f.rule === "DR-2")!;
  assert.equal(archive.status, "open");
  writeFileSync(
    join(repo, ".tails/accepted.yml"),
    `accepted:\n  - fingerprint: "${archive.fingerprint}"\n    reason: "Archive migration moved into this TDD."\n    by: "tails test"\n    date: "2026-10-30"\n`,
  );
  const after = drift(repo);
  assert.equal(after.findings.find((f) => f.fingerprint === archive.fingerprint)?.status, "accepted");
  assert.match(after.md, /## Accepted[\s\S]*Archive/);
  assert.equal(drift(repo, "--strict").code, 0, "an accepted failure no longer fails --strict");
});

test("each warning rule fires on the synthetic spec set, with a file and line", () => {
  const { findings } = drift(fixture("acme"));
  const got = findings.map((f) => `${f.rule} ${f.ids.join(",")}`).sort();
  assert.deepEqual(got, [
    "DR-1 prds/ACME-1-export.md#FR-1.2",
    "DR-4 FR-7.1",
    "DR-5 EX-API-3",
    "DR-6 FR-1.9",
  ]);
  for (const f of findings) {
    assert.ok(f.citations.length > 0);
    for (const c of f.citations) assert.ok(c.doc.endsWith(".md") && c.line > 0, JSON.stringify(c));
  }
});

test("a matrix with no PRD column gives one DR-5 per table, not per row", () => {
  const dr5 = drift(fixture("catalog")).findings.filter((f) => f.rule === "DR-5");
  assert.deepEqual(dr5.map((f) => f.ids.length), [2, 6]);
});

test("agent findings in tails.drift/1 are merged and labelled with their source", () => {
  const dir = tmp();
  const extra = join(dir, "agent.json");
  writeFileSync(
    extra,
    JSON.stringify({
      schema: "tails.drift/1",
      source: "drift-agent",
      findings: [{ rule: "DR-9", title: "Meaning drift", message: "Approval permissions need clarification.", ids: ["FR-9.1"], citations: [{ doc: "prds/CAT-1-catalog.md", line: 27 }] }],
    }),
  );
  const f = drift(fixture("catalog"), "--extra", extra).findings.find((x) => x.rule === "DR-9");
  assert.equal(f?.source, "drift-agent");
  assert.equal(f?.severity, "warn");
});

test("an unknown schema is an input error", () => {
  const dir = tmp();
  const extra = join(dir, "agent.json");
  writeFileSync(extra, JSON.stringify({ schema: "tails.drift/2", findings: [] }));
  const r = cli("drift", "--repo", fixture("catalog"), "--out", dir, "--extra", extra);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /unknown schema "tails.drift\/2"/);
});

test("a null agent finding is an input error that names the finding", () => {
  const dir = tmp();
  const extra = join(dir, "agent.json");
  writeFileSync(extra, JSON.stringify({ schema: "tails.drift/1", findings: [null] }));
  const r = cli("drift", "--repo", fixture("catalog"), "--out", dir, "--extra", extra);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /agent\.json: finding 1 must be an object/);
});

test("agent findings reject invalid source lines and keep distinct evidence distinct", () => {
  const finding = { rule: "AGENT-1", message: "Check this requirement", citations: [{ doc: "prds/x.md", line: 1 }] };
  const input = (findings: unknown[]) => JSON.stringify({ schema: "tails.drift/1", source: "reviewer", findings });
  for (const line of [0, -1, 1.5]) {
    assert.throws(() => parseExtraFindings(input([{ ...finding, citations: [{ doc: "prds/x.md", line }] }]), "agent.json"), /positive integer/);
  }
  const findings = parseExtraFindings(input([finding, { ...finding, message: "Different evidence" }]), "agent.json");
  assert.notEqual(findings[0]!.fingerprint, findings[1]!.fingerprint);
});

test("the same finding in two documents of one kind and group gets two fingerprints", () => {
  const repo = tmp();
  for (const name of ["a", "b"]) {
    mkdirSync(join(repo, "prds"), { recursive: true });
    writeFileSync(join(repo, `prds/${name}.md`), `# ${name} — PRD\n\nEpic: X-1\n\n## 2. Requirements\n\n- **FR-1.1** Given ${name}, see INV-9.\n`);
  }
  mkdirSync(join(repo, "tdds"), { recursive: true });
  writeFileSync(join(repo, "tdds/x.md"), "# X — Technical Design\n\nEpic: X-1\n\n## 4. Invariants\n\n| ID | Rule |\n| --- | --- |\n| INV-1 | Something holds. |\n");
  const dr4 = drift(repo).findings.filter((f) => f.rule === "DR-4");
  assert.deepEqual(dr4.map((f) => f.citations[0]!.doc).sort(), ["prds/a.md", "prds/b.md"]);
  assert.notEqual(dr4[0]!.fingerprint, dr4[1]!.fingerprint);
});
