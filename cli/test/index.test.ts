// S1 behaviour: the spec index, its input errors, and deterministic output.
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, copyFixture, edit, fixture, read, snapshot, tmp } from "./helpers.js";

interface JsonIndex {
  schema: string;
  docs: { path: string; kind: string; epic: string | null; group: string }[];
  entries: { key: string; id: string; family: string; doc: string; line: number }[];
  citations: { doc: string; line: number; kind: string; id: string; from: string | null; to: string | null }[];
}

function index(repo: string): JsonIndex {
  const out = join(tmp(), "index.json");
  const r = cli("index", "--repo", repo, "--out", out);
  assert.equal(r.code, 0, r.stderr);
  return JSON.parse(read(out)) as JsonIndex;
}

test("indexes every ID family in the catalog fixture with its file and line", () => {
  const ix = index(fixture("catalog"));
  assert.equal(ix.schema, "tails.index/1");
  const keys = ix.entries.map((e) => e.key);
  for (const k of [
    "prds/CAT-1-catalog.md#FR-1",
    "prds/CAT-1-catalog.md#FR-1.1",
    "prds/CAT-1-catalog.md#FR-9.2",
    "tdds/CAT-2-catalog.md#INV-14",
    "tdds/CAT-2-catalog.md#D9",
    "test-case-specs/CAT-1-catalog.md#TC-37",
    "BK-API-42",
  ]) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
  const inv14 = ix.entries.find((e) => e.key === "tdds/CAT-2-catalog.md#INV-14")!;
  assert.equal(inv14.line, 11);
  assert.match(read(join(fixture("catalog"), inv14.doc)).split("\n")[inv14.line - 1]!, /^\| INV-14 \|/);
});

test("puts the PRD, TDD and test spec of one epic in one group", () => {
  const groups = new Set(index(fixture("catalog")).docs.map((d) => d.group));
  assert.equal(groups.size, 1);
});

test("resolves Covers and in-text citations to the defining document", () => {
  const ix = index(fixture("catalog"));
  const covers = ix.citations.filter((c) => c.kind === "covers").map((c) => `${c.from} -> ${c.to}`);
  assert.deepEqual(covers.sort(), [
    "test-case-specs/CAT-1-catalog.md#TC-01 -> prds/CAT-1-catalog.md#FR-1.1",
    "test-case-specs/CAT-1-catalog.md#TC-37 -> prds/CAT-1-catalog.md#FR-9.1",
  ]);
  const riskCite = ix.citations.find((c) => c.id === "INV-14" && c.from === null);
  assert.equal(riskCite?.to, "tdds/CAT-2-catalog.md#INV-14", "the §7 risk row cites INV-14");
});

test("ignores IDs in inline code, link targets and HTML comments, and short tokens a group does not define", () => {
  const ix = index(fixture("catalog"));
  // TC-37 says "S1's draft"; the group defines no slices, so S1 is a word.
  assert.ok(!ix.citations.some((c) => c.id === "S1"));
  assert.ok(!ix.citations.some((c) => c.id === "CAT-1"));
  for (const id of ["FR-8.1", "FR-8.2", "FR-8.3"]) assert.ok(!ix.citations.some((c) => c.id === id));
});

test("a malformed ID in a definition position is an input error naming the line (INV-8)", () => {
  const repo = copyFixture("catalog");
  edit(join(repo, "prds/CAT-1-catalog.md"), "- **FR-9.2**", "- **FR-9.2b**");
  const r = cli("index", "--repo", repo, "--out", join(tmp(), "i.json"));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /prds\/CAT-1-catalog\.md:29/);
  assert.match(r.stderr, /FR-9\.2b/);
});

test("a duplicate ID is an input error", () => {
  const repo = copyFixture("catalog");
  edit(join(repo, "tdds/CAT-2-catalog.md"), "| INV-13 |", "| INV-14 |");
  const r = cli("index", "--repo", repo, "--out", join(tmp(), "i.json"));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /INV-14/);
});

test("an unknown key in .tails.yml is an input error", () => {
  const repo = copyFixture("acme");
  edit(join(repo, ".tails.yml"), "drift:", "drfit:");
  const r = cli("index", "--repo", repo, "--out", join(tmp(), "i.json"));
  assert.equal(r.code, 2);
  assert.match(r.stderr, /drfit/);
});

test("the same input gives byte-identical output (INV-3)", () => {
  const a = tmp();
  const b = tmp();
  assert.equal(cli("report", "--repo", fixture("catalog"), "--out", a).code, 0);
  assert.equal(cli("report", "--repo", fixture("catalog"), "--out", b).code, 0);
  const sa = snapshot(a);
  const sb = snapshot(b);
  assert.ok(sa.size > 4);
  assert.deepEqual([...sa.keys()], [...sb.keys()]);
  for (const [k, v] of sa) assert.equal(sb.get(k), v, k);
});

test("bad usage exits 2", () => {
  assert.equal(cli("nonsense").code, 2);
  assert.equal(cli("index", "--bogus").code, 2);
  assert.equal(cli("index", "--repo", "/nonexistent/tails").code, 2);
  for (const args of [["feature", "--strict"], ["site", "--extra", "a.json"], ["review", "--ref", "HEAD"], ["serve", "one", "two"]]) {
    assert.equal(cli(...args).code, 2, args.join(" "));
  }
});

test("index skips dependency trees and symlink loops before descending", () => {
  const repo = copyFixture("catalog");
  const before = index(repo);
  symlinkSync(repo, join(repo, "loop"), "dir");
  mkdirSync(join(repo, "node_modules"));
  symlinkSync(repo, join(repo, "node_modules", "loop"), "dir");
  symlinkSync("missing", join(repo, "broken"));
  assert.deepEqual(index(repo), before);
});

test("commented templates and nested code fences do not define or cite IDs", () => {
  const repo = tmp();
  mkdirSync(join(repo, "prds"));
  writeFileSync(join(repo, "prds", "x.md"), '# X\n<!--\n- **FR-1.1** Hidden template.\nFR-9.9\n-->\n````md\n```ts\n- **FR-1.1** Example.\n```\n````\n- **FR-1.1** Real requirement.\n');
  const ix = index(repo);
  assert.deepEqual(ix.entries.map((e) => [e.id, e.line]), [["FR-1.1", 11]]);
  assert.equal(ix.citations.length, 0);
});
