// Behaviour that needs history: --ref, DR-3 (PRD changed after the TDD) and spec review (S5).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { cli, edit, git, gitFixture, read, tmp } from "./helpers.js";

const PRD = "prds/ACME-1-export.md";
const TDD = "tdds/ACME-2-export.md";

function findings(repo: string, ...flags: string[]): { rule: string; ids: string[]; fingerprint: string }[] {
  const out = tmp();
  assert.equal(cli("drift", "--repo", repo, "--out", out, ...flags).code, 0);
  return (JSON.parse(read(join(out, "drift.json"))) as { findings: { rule: string; ids: string[]; fingerprint: string }[] }).findings;
}

test("DR-3 reports a PRD requirement changed after the TDD's last commit", () => {
  const repo = gitFixture("acme");
  assert.deepEqual(findings(repo).filter((f) => f.rule === "DR-3"), []);
  edit(join(repo, PRD), "then the person sees why.", "then the person sees why and can retry.");
  git(repo, "commit", "-qam", "prd: retry");
  const dr3 = findings(repo).filter((f) => f.rule === "DR-3");
  assert.deepEqual(dr3.map((f) => f.ids.join(",")), [`${PRD}#FR-1.3`]);

  edit(join(repo, TDD), "| EX-API-2 | Failures return a reason. |", "| EX-API-2 | Failures return a reason and a retry link. |");
  git(repo, "commit", "-qam", "tdd: retry");
  assert.deepEqual(findings(repo).filter((f) => f.rule === "DR-3"), [], "updating the TDD clears it");
});

test("--ref reads the spec at a commit, not the working tree", () => {
  const repo = gitFixture("acme");
  const first = git(repo, "rev-parse", "HEAD");
  edit(join(repo, "test-case-specs/ACME-1-export.md"), "FR-1.9", "FR-1.3");
  git(repo, "commit", "-qam", "tcs: fix covers");
  assert.ok(findings(repo).every((f) => f.rule !== "DR-6"));
  assert.ok(findings(repo, "--ref", first).some((f) => f.rule === "DR-6"));
  assert.equal(cli("index", "--repo", repo, "--ref", "no-such-ref", "--out", join(tmp(), "i.json")).code, 2);
});

test("review fails when an ID is renumbered", () => {
  const repo = gitFixture("acme");
  git(repo, "branch", "base");
  edit(join(repo, PRD), "- **FR-1.3**", "- **FR-1.4**");
  git(repo, "commit", "-qam", "renumber");
  const out = join(tmp(), "review.md");
  const r = cli("review", "--repo", repo, "--base", "base", "--head", "main", "--out", out);
  assert.equal(r.code, 1);
  assert.match(read(out), /FR-1\.3 was renumbered to FR-1\.4/);
});

test("review passes when a spec file is renamed, and its accepted findings stay accepted", () => {
  const repo = gitFixture("acme");
  const fp = findings(repo).map((f) => f.fingerprint);
  git(repo, "branch", "base");
  git(repo, "mv", TDD, "tdds/ACME-2-data-export.md");
  git(repo, "commit", "-qm", "rename");
  const out = join(tmp(), "r.md");
  assert.equal(cli("review", "--repo", repo, "--base", "base", "--head", "main", "--out", out).code, 0);
  assert.doesNotMatch(read(out), /renumbered/);
  assert.deepEqual(findings(repo).map((f) => f.fingerprint).sort(), fp.sort(), "fingerprints survive the rename");
});

test("review lists a finding accepted in the same change as accepted, not resolved", () => {
  const repo = gitFixture("acme");
  git(repo, "branch", "base");
  edit(join(repo, TDD), "| INV-1 | An export never includes another account's rows. |", "| INV-1 | An export never includes another account's rows. A scheduled job sends it. |");
  const dr2 = findings(repo).find((f) => f.rule === "DR-2")!;
  mkdirSync(join(repo, ".tails"), { recursive: true });
  writeFileSync(join(repo, ".tails/accepted.yml"), `accepted:\n  - fingerprint: "${dr2.fingerprint}"\n    reason: Scheduling is in scope.\n    by: QA\n    date: "2026-11-02"\n`);
  edit(join(repo, ".tails.yml"), "export: [csv]", "export: [csv, spreadsheet]");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "tdd: scheduled job, accepted");
  const out = join(tmp(), "r.md");
  assert.equal(cli("review", "--repo", repo, "--base", "base", "--head", "main", "--out", out).code, 0);
  const md = read(out);
  assert.match(md, /### Accepted in this change[\s\S]*DR-2 Scope conflict[\s\S]*Accepted by QA on 2026-11-02: Scheduling is in scope\./);
  assert.doesNotMatch(md, /Resolved by this change/);
  assert.match(md, /This change edits `\.tails\.yml`/);
});

test("review fails on a new open scope conflict and passes on a plain edit", () => {
  const repo = gitFixture("acme");
  git(repo, "branch", "base");
  edit(join(repo, PRD), "file arrives within a minute.", "file arrives within two minutes.");
  git(repo, "commit", "-qam", "edit");
  assert.equal(cli("review", "--repo", repo, "--base", "base", "--head", "main", "--out", join(tmp(), "r.md")).code, 0);

  edit(join(repo, TDD), "| INV-1 | An export never includes another account's rows. |", "| INV-1 | An export never includes another account's rows. A scheduled job sends it. |");
  git(repo, "commit", "-qam", "pdf");
  const out = join(tmp(), "r.md");
  assert.equal(cli("review", "--repo", repo, "--base", "base", "--head", "main", "--out", out).code, 1);
  const md = read(out);
  assert.match(md, /^## ❌ tails: 1 thing to fix before merge/);
  assert.match(md, /\*\*TDD · INV-1\*\* · `tdds\/ACME-2-export\.md:\d+`/, "quotes the TDD line it conflicts with");
  assert.match(md, /A scheduled job sends it\./);
  assert.match(md, /\*\*What to do:\*\* Decide which document is right\..*`DR-2:[0-9a-f]{12}`/);
});

test("review shows what a changed requirement reaches, with the words that changed", () => {
  const repo = gitFixture("catalog");
  git(repo, "branch", "base");
  edit(join(repo, "prds/CAT-1-catalog.md"), "then librarians\n  and reviewers can approve it", "then librarians\n  can approve it");
  git(repo, "commit", "-qam", "prd: librarians only");
  const out = join(tmp(), "r.md");
  assert.equal(cli("review", "--repo", repo, "--base", "base", "--head", "main", "--out", out).code, 0);
  const md = read(out);
  assert.match(md, /^## ✅ tails: no spec conflicts/);
  const row = md.split("\n").find((l) => l.startsWith("| **FR-9.1**"));
  assert.ok(row, "FR-9.1 is listed under the work that cites it");
  assert.match(row, /librarians ~~and reviewers~~ can approve/);
  assert.match(row, /TC-37/);
});

test("review names work that still cites a removed requirement", () => {
  const repo = gitFixture("acme");
  git(repo, "branch", "base");
  const file = join(repo, PRD);
  writeFileSync(file, read(file).split("\n").filter((line) => !line.includes("**FR-1.1**")).join("\n"));
  git(repo, "commit", "-qam", "remove requirement");
  const out = join(tmp(), "review.md");
  assert.equal(cli("review", "--repo", repo, "--base", "base", "--head", "main", "--out", out).code, 0);
  assert.match(read(out), /\| \*\*FR-1\.1\*\*[^\n]+\| removed \|[^\n]+EX-API-1[^\n]+TC-01/);
});

/** Main holds no specs; each document kind sits on its own PR branch. */
function specPrRepo(): string {
  const repo = gitFixture("catalog");
  const branchWith = (branch: string, keep: string) => {
    git(repo, "checkout", "-q", "-b", branch, "main");
    for (const dir of ["prds", "tdds", "test-case-specs"].filter((d) => d !== keep)) git(repo, "rm", "-rq", dir);
    git(repo, "commit", "-qm", `only ${keep}`);
  };
  branchWith("pr/77", "tdds");
  branchWith("pr/79", "prds");
  branchWith("pr/80", "test-case-specs");
  git(repo, "checkout", "-q", "main");
  git(repo, "rm", "-rq", "prds", "tdds", "test-case-specs");
  git(repo, "commit", "-qm", "main has no specs yet");
  return repo;
}

test("several --ref flags read open spec PRs as one tree and reveal a scope conflict", () => {
  const repo = specPrRepo();
  const prOnly = findings(repo, "--ref", "pr/77");
  assert.ok(!prOnly.some((f) => f.rule === "DR-2"), "the TDD alone has no PRD to conflict with");

  const all = findings(repo, "--ref", "main", "--ref", "pr/77", "--ref", "pr/79", "--ref", "pr/80");
  const dr2 = all.filter((f) => f.rule === "DR-2");
  assert.equal(dr2.length, 1);
  assert.ok(dr2[0]!.ids.some((id) => id.endsWith("#D9")));

  const out = join(tmp(), "index.json");
  assert.equal(cli("index", "--repo", repo, "--ref", "pr/77", "--ref", "pr/79", "--out", out).code, 0);
  const index = JSON.parse(read(out)) as { commit: string | null; refs: { ref: string }[]; docs: { path: string; source: { ref: string } }[] };
  assert.equal(index.commit, null);
  assert.deepEqual(index.refs.map((r) => r.ref), ["pr/77", "pr/79"]);
  assert.deepEqual(
    index.docs.map((d) => `${d.path} ${d.source.ref}`).sort(),
    ["prds/CAT-1-catalog.md pr/79", "tdds/CAT-2-catalog.md pr/77"],
  );
});

test("when two refs change the same file, the later ref wins and tails says so", () => {
  const repo = specPrRepo();
  git(repo, "checkout", "-q", "-b", "pr/81", "pr/79");
  edit(join(repo, "prds/CAT-1-catalog.md"), "| Archive migration |", "| Spreadsheet uploads |");
  git(repo, "commit", "-qam", "prd: reword");
  git(repo, "checkout", "-q", "main");

  const out = tmp();
  const r = cli("drift", "--repo", repo, "--out", out, "--ref", "pr/77", "--ref", "pr/79", "--ref", "pr/81");
  assert.match(r.stderr, /prds\/CAT-1-catalog\.md differs between pr\/79, pr\/81; reading it from pr\/81/);
  assert.doesNotMatch(read(join(out, "drift.md")), /Archive migration/);
});

test("review --with reads a TDD PR against its sibling PRD PR", () => {
  const repo = specPrRepo();
  const out = join(tmp(), "r.md");
  assert.equal(cli("review", "--repo", repo, "--base", "main", "--head", "pr/77", "--out", out).code, 0, "no PRD, no conflict");
  assert.equal(cli("review", "--repo", repo, "--base", "main", "--head", "pr/77", "--with", "pr/79", "--out", out).code, 1);
  assert.match(read(out), /read with `pr\/79`/);
  assert.match(read(out), /\*\*PRD · Not doing\*\*/);
});

/** The acme repo with FR-1.1 and FR-1.2 both left as the same placeholder, committed on branch "base". */
function placeholders(): string {
  const repo = gitFixture("acme");
  edit(join(repo, PRD), "- **FR-1.1** Given a list, when someone exports it, then they get a file.", "- **FR-1.1** TBD.");
  edit(join(repo, PRD), "- **FR-1.2** Given a large list, when someone exports it, then the file arrives within a minute.", "- **FR-1.2** TBD.");
  git(repo, "commit", "-qam", "placeholders");
  git(repo, "branch", "base");
  return repo;
}

test("review passes when one of two IDs with the same placeholder text is removed", () => {
  const repo = placeholders();
  edit(join(repo, PRD), "- **FR-1.2** TBD.\n", "");
  git(repo, "commit", "-qam", "drop FR-1.2");
  const out = join(tmp(), "r.md");
  const r = cli("review", "--repo", repo, "--base", "base", "--head", "main", "--out", out);
  assert.doesNotMatch(read(out), /renumbered/);
  assert.equal(r.code, 0, read(out));
});

test("review passes when a placeholder that another ID shares is filled in", () => {
  const repo = placeholders();
  edit(join(repo, PRD), "- **FR-1.2** TBD.", "- **FR-1.2** Given a large list, the file arrives within a minute.");
  git(repo, "commit", "-qam", "fill FR-1.2");
  const out = join(tmp(), "r.md");
  const r = cli("review", "--repo", repo, "--base", "base", "--head", "main", "--out", out);
  assert.doesNotMatch(read(out), /now means something else/);
  assert.equal(r.code, 0, read(out));
});

test("review still fails when an ID's text moves to a new ID", () => {
  const repo = gitFixture("acme");
  git(repo, "branch", "base");
  edit(join(repo, PRD), "- **FR-1.3** Given an export, when it fails, then the person sees why.", "- **FR-1.3** Given an export, when it is cancelled, then nothing is sent.\n- **FR-1.4** Given an export, when it fails, then the person sees why.");
  git(repo, "commit", "-qam", "reuse FR-1.3");
  const out = join(tmp(), "r.md");
  assert.equal(cli("review", "--repo", repo, "--base", "base", "--head", "main", "--out", out).code, 1);
  assert.match(read(out), /FR-1\.3 now means something else\*\* .*; its old text moved to FR-1\.4/);
});
