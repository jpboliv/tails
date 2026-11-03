// `tails feature`: a feature file of explicit links, read through GitHub, rendered in Tails' own
// folder. GitHub is a fake here; the CLI uses the GitHub CLI.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { featureCommand, renderFeature } from "../src/feature-cli.js";
import { buildFeature, featureHome, featureYaml, parseFeature, pickDocs, type GitHub, type PullRequest } from "../src/feature.js";
import { TailsInputError } from "../src/model.js";
import { fixture, read, snapshot, tmp } from "./helpers.js";

const DOCS = "https://github.com/acme/docs";
const fx = (p: string) => read(join(fixture("records"), p));

/** A GitHub with three spec pull requests and one implementation pull request. */
function fakeGitHub(over: Partial<Record<number, Partial<PullRequest>>> = {}): GitHub & { calls: string[] } {
  const calls: string[] = [];
  const pulls: Record<number, { pr: PullRequest; files: { path: string; status: string }[] }> = {
    1: { pr: pull(1, "Add the loans PRD"), files: [{ path: "prds/LIB-1-loans.md", status: "added" }, { path: "README.md", status: "modified" }] },
    2: { pr: pull(2, "Add the loans TDD"), files: [{ path: "tdds/LIB-2-loans.md", status: "added" }] },
    3: { pr: pull(3, "Add the loans test cases"), files: [{ path: "test-case-specs/LIB-1-loans.md", status: "added" }] },
    9: { pr: { ...pull(9, "Loans endpoint"), repo: "acme/api", url: "https://github.com/acme/api/pull/9" }, files: [] },
  };
  for (const [n, o] of Object.entries(over)) pulls[Number(n)]!.pr = { ...pulls[Number(n)]!.pr, ...o };
  const files: Record<string, string> = {
    "prds/LIB-1-loans.md": fx("prds/LIB-1-loans.md"),
    "tdds/LIB-2-loans.md": fx("tdds/LIB-2-loans.md"),
    "test-case-specs/LIB-1-loans.md": fx("test-case-specs/LIB-1-loans.md"),
  };
  return {
    calls,
    pull: ({ number }) => (calls.push(`pull ${number}`), pulls[number]!.pr),
    pullFiles: ({ number }) => pulls[number]!.files,
    file: (_o, _r, ref, path) => (calls.push(`file ${ref} ${path}`), ref === "missing" ? null : (files[path] ?? null)),
    commit: (_o, _r, ref) => (ref.startsWith("feature/") || ref === "main" ? `c0ffee${ref.length}000000` : null),
  };
}

function pull(n: number, title: string): PullRequest {
  return { url: `${DOCS}/pull/${n}`, repo: "acme/docs", number: n, title, state: "open", author: "ana", headSha: `head${n}`.padEnd(40, "0"), baseRef: "main", updatedAt: "2026-11-01T10:00:00Z" };
}

function home(yaml: string, slug = "loans"): string {
  const h = tmp();
  writeFileSync(join(h, `${slug}.yml`), yaml);
  return h;
}

const LOANS = `name: Tool loans
prd: ${DOCS}/pull/1
tdd: ${DOCS}/pull/2
tests: ${DOCS}/pull/3
linear: https://linear.app/acme/issue/LIB-1
implementation:
  - https://github.com/acme/api/pull/9
`;

test("the Tails folder is --home, then $TAILS_HOME, then ~/tails-documentation, never inside a project", () => {
  assert.equal(featureHome("x", "/work/shop", {}, "/Users/ana"), "/work/shop/x");
  assert.equal(featureHome(undefined, "/work/shop", { TAILS_HOME: "/t" }, "/Users/ana"), "/t");
  const project = tmp();
  writeFileSync(join(project, "tails-documentation"), "");
  assert.equal(featureHome(undefined, project, {}, "/Users/ana"), "/Users/ana/tails-documentation", "a folder of that name in a project is not used");
});

test("a feature file is checked where it is read, and names the bad key", () => {
  const spec = parseFeature(LOANS, "loans.yml");
  assert.equal(spec.name, "Tool loans");
  assert.deepEqual(spec.docs.prd, [{ link: `${DOCS}/pull/1` }]);
  assert.equal(spec.implementation.length, 1);
  const bad = (yaml: string, msg: RegExp) => assert.throws(() => parseFeature(yaml, "f.yml"), (e: Error) => e instanceof TailsInputError && msg.test(e.message));
  bad("name: X\nprd: https://example.com/doc.md\n", /f\.yml: prd: "https:\/\/example\.com\/doc\.md" is not a GitHub pull request or file link/);
  bad("name: X\n", /name at least one document/);
  bad(`name: X\ntdd: ${DOCS}/pull/2\nlinear: soon\n`, /linear: "soon" is not a ticket key/);
  bad(`name: X\ntdd: ${DOCS}/pull/2\nticket: LIB-1\n`, /unknown key "ticket"/);
  bad(`name: X\ntdd: ${DOCS}/pull/2\nimplementation:\n  - ${DOCS}/blob/main/x.md\n`, /implementation\[0\] must be a pull request link/);
  assert.deepEqual(parseFeature(`name: X\ntdd:\n  link: ${DOCS}/pull/2\n  file: /docs/tdd.md\n`, "f.yml").docs.tdd, [{ link: `${DOCS}/pull/2`, file: "docs/tdd.md" }]);
});

test("a pull request's document is the one in the role's folder, else its only document, else you name it", () => {
  const f = (...paths: string[]) => paths.map((path) => ({ path, status: "added" }));
  assert.deepEqual(pickDocs("prd", f("prds/A.md", "tdds/B.md", "README.md"), "l"), ["prds/A.md"]);
  assert.deepEqual(pickDocs("tdd", f("docs/design.md", "README.md", "src/a.ts"), "l"), ["docs/design.md"], "a project without a docs repository");
  assert.throws(() => pickDocs("tdd", f("docs/a.md", "docs/b.md"), "PR"), /PR: the pull request changes several documents \(docs\/a\.md, docs\/b\.md\)\. Say which is the TDD with file: <path>/);
  assert.throws(() => pickDocs("prd", [{ path: "prds/A.md", status: "removed" }], "PR"), /changes no Markdown document/);
});

test("an open pull request is read at its head, a merged one from the branch it went into", () => {
  const gh = fakeGitHub({ 2: { state: "merged" }, 3: { state: "closed" } });
  const f = buildFeature(parseFeature(LOANS, "loans.yml"), "loans", gh);
  const by = Object.fromEntries(f.sources.map((s) => [s.role, s]));
  assert.equal(by.prd!.readFrom.commit, "head1".padEnd(40, "0"));
  assert.ok(gh.calls.includes(`file ${by.tdd!.readFrom.commit} tdds/LIB-2-loans.md`));
  assert.equal(by.tdd!.readFrom.commit, "c0ffee4000000", "the latest commit on main");
  assert.deepEqual(f.docs.map((d) => [d.path, d.kind]), [
    ["acme/docs/prds/LIB-1-loans.md", "prd"],
    ["acme/docs/tdds/LIB-2-loans.md", "tdd"],
    ["acme/docs/test-case-specs/LIB-1-loans.md", "tcs"],
  ]);
  assert.match(f.notes.join(" "), /Test cases: acme\/docs#3 was closed without merging/);
  assert.deepEqual(f.linear, { key: "LIB-1", url: "https://linear.app/acme/issue/LIB-1" });
  assert.equal(f.implementation[0]!.title, "Loans endpoint");
});

test("a file link reads the file, even on a branch whose name has a slash", () => {
  const gh = fakeGitHub();
  const f = buildFeature(parseFeature(`name: X\ntdd: ${DOCS}/blob/feature/loans/tdds/LIB-2-loans.md\n`, "x.yml"), "x", gh);
  assert.deepEqual(f.sources[0]!.readFrom, { ref: "acme/docs@feature/loans", commit: "c0ffee13000000" });
  assert.deepEqual(f.docs.map((d) => d.path), ["acme/docs/tdds/LIB-2-loans.md"]);
});

test("the report is written in the Tails folder and opens on the feature, with its sources", () => {
  const h = home(LOANS);
  const r = renderFeature(h, "loans", fakeGitHub(), "3 Nov 2026, 14:05");
  assert.equal(r.dir, join(h, "reports", "loans"));
  const site = snapshot(join(r.dir, "site"));
  const index = site.get("index.html")!;
  assert.match(index, /Read 3 Nov 2026, 14:05<\/span>/);
  assert.match(index, /<h1>Tool loans<\/h1>/);
  assert.match(index, /<h2 id="sources">Sources<\/h2>/);
  assert.match(index, /<a href="https:\/\/github\.com\/acme\/docs\/pull\/2" rel="noopener noreferrer nofollow">Add the loans TDD<\/a>/);
  assert.match(index, /acme\/docs#2 · read at its head <span class="mono">head200<\/span>/);
  assert.match(index, /href="acme\/docs\/tdds\/LIB-2-loans\.html">.*?<span>tdds\/LIB-2-loans\.md<\/span>/);
  assert.match(index, /LIB-1<\/a><\/span><span class="m"><span class="chip neutral">Link only<\/span>/);
  assert.match(index, /Implementation · acme\/api#9 · ana/);
  assert.doesNotMatch(site.get("drift.html")!, /Accept it with a reason|\.tails\/accepted\.yml/);
  // Every document is one feature, named by its Linear ticket.
  assert.ok(site.has("epics/LIB-1.html"));
  assert.ok(site.has("acme/docs/tdds/LIB-2-loans.html") && site.has("ids/acme/docs/tdds/LIB-2-loans/LN-API-1.html"));
  const json = JSON.parse(readFileSync(join(r.dir, "index.json"), "utf8"));
  assert.deepEqual([...new Set(json.docs.map((d: { group: string }) => d.group))], ["LIB-1"]);
});

test("feature refresh cannot escape its report folder or follow a report-directory symlink", () => {
  const root = tmp();
  const h = join(root, "home");
  mkdirSync(h);
  writeFileSync(join(root, "victim.yml"), LOANS);
  mkdirSync(join(h, "victim"));
  writeFileSync(join(h, "victim", "keep.txt"), "user data");
  assert.throws(() => renderFeature(h, "../victim", fakeGitHub(), "now"), /invalid feature name/);
  assert.equal(read(join(h, "victim", "keep.txt")), "user data");
  writeFileSync(join(h, "loans.yml"), LOANS);
  const outside = tmp();
  mkdirSync(join(outside, "loans"));
  writeFileSync(join(outside, "loans", "keep.txt"), "user data");
  symlinkSync(outside, join(h, "reports"), "dir");
  assert.throws(() => renderFeature(h, "loans", fakeGitHub(), "now"), /must not be symbolic links/);
  assert.equal(read(join(outside, "loans", "keep.txt")), "user data");
});

test("same-named repositories under different owners keep both documents", () => {
  const spec = parseFeature(`name: Both\nprd:\n  - ${DOCS}/pull/1\n  - https://github.com/other/docs/pull/1\n`, "both.yml");
  const feature = buildFeature(spec, "both", fakeGitHub());
  assert.deepEqual(feature.docs.map((d) => d.path), ["acme/docs/prds/LIB-1-loans.md", "other/docs/prds/LIB-1-loans.md"]);
  assert.equal(feature.sources[1]!.docs.length, 1);
  assert.deepEqual(feature.notes, []);
});

test("a feature file round-trips quotes, hashes and escaped whitespace", () => {
  const spec = { ...parseFeature(LOANS, "loans.yml"), name: 'Say " # launch\nnext' };
  assert.deepEqual(parseFeature(featureYaml(spec), "loans.yml"), spec);
  assert.throws(() => parseFeature(`name: X\nprd: ${DOCS}/blob/main/%ZZ.md\n`, "bad.yml"), /not a GitHub/);
});

test("an unresolved branch cannot be presented as a source commit", () => {
  const spec = parseFeature(LOANS, "loans.yml");
  const gh = fakeGitHub({ 2: { state: "merged" } });
  assert.throws(() => buildFeature(spec, "loans", { ...gh, commit: () => null }), /cannot resolve commit/);
});

test("a local PRD-only feature renders only its sources and keeps unavailable coverage neutral", () => {
  const h = home(`name: Tool loans\nprd: ${DOCS}/pull/1\n`);
  const report = renderFeature(h, "loans", fakeGitHub(), "now");
  const page = read(join(report.dir, "site", "index.html"));
  assert.equal(report.docs, 1);
  assert.equal(report.open, 0);
  assert.match(page, /<h2>PRD only<\/h2>/);
  assert.match(page, /class="source-stage prd"/);
  assert.doesNotMatch(page, /class="source-stage (?:tdd|tcs)"|stage-missing|id="linked-work"/);
  assert.match(page, /Test cases not provided/);
});

test("a supplied document that cannot be loaded is still an error", () => {
  const h = home(`name: Tool loans\nprd: ${DOCS}/pull/1\n`);
  assert.throws(() => renderFeature(h, "loans", { ...fakeGitHub(), file: () => null }, "now"), /does not exist at/);
});

test("tails feature new saves the links in the Tails folder and opens the report; list shows it", async () => {
  const h = join(tmp(), "tails-documentation");
  const logs: string[] = [];
  const log = console.log;
  console.log = (...a: unknown[]) => void logs.push(a.join(" "));
  try {
    const o = { home: h, port: 0, open: false, serve: false, name: "Tool loans", links: { prd: [`${DOCS}/pull/1`], tdd: [`${DOCS}/pull/2`], tests: [] }, linear: "LIB-1", prs: [] };
    assert.equal(await featureCommand(["new"], o, fakeGitHub()), 0);
    assert.equal(read(join(h, "tool-loans.yml")), `name: "Tool loans"\nprd: ${DOCS}/pull/1\ntdd: ${DOCS}/pull/2\nlinear: LIB-1\n`);
    assert.ok(existsSync(join(h, "reports", "tool-loans", "site", "index.html")));
    await assert.rejects(featureCommand(["new"], o, fakeGitHub()), /tool-loans\.yml already exists/);
    logs.length = 0;
    const savedOptions = { ...o, name: undefined, linear: undefined, links: { prd: [], tdd: [], tests: [] } };
    await featureCommand([], savedOptions, fakeGitHub());
    assert.match(logs.join("\n"), /Features in .*tails-documentation:\n  tool-loans/);
    await assert.rejects(featureCommand(["nope"], savedOptions, fakeGitHub()), /no feature "nope" in .*Known: tool-loans/);
    await assert.rejects(featureCommand(["tool-loans"], o, fakeGitHub()), /only work with tails feature new/);
    for (const name of ["new", "list", "---"]) {
      await assert.rejects(featureCommand(["new"], { ...o, name }, fakeGitHub()), /invalid feature name/);
    }
  } finally {
    console.log = log;
  }
});
