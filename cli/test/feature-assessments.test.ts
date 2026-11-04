import assert from "node:assert/strict";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { assessedRequirements, assessFreshness, featureSnapshots, importAssessment, prepareFeatureAssessment, readAssessments, type StoredAssessment } from "../src/feature-assessments.js";
import { buildFeature, parseFeature, type GitHub, type PullRequest } from "../src/feature.js";
import { renderFeature } from "../src/feature-cli.js";
import { buildIndex } from "../src/indexer.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { assessment, CODE_SHA, deviating, LOCATION, SPEC_SHA } from "./assessment-fixture.js";
import { read, tmp } from "./helpers.js";
import { main } from "../src/cli.js";

const YAML = "name: Queue\ntdd: https://github.com/acme/docs/pull/2\nimplementation:\n  - https://github.com/acme/api/pull/9\n  - https://github.com/acme/api/pull/10\n";
const DOC = "# Queue design\n\n- **WL-01** Join returns 201.\n";
const PROPOSED = "c".repeat(40);

function github(): GitHub {
  return {
    pull: ({ owner, repo, number }): PullRequest => ({ repo: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}/pull/${number}`, number, title: "Queue", state: repo === "docs" ? "open" : "draft", author: "ana", headSha: repo === "docs" ? PROPOSED : CODE_SHA, baseRef: "main", updatedAt: "2026-11-04T10:00:00Z" }),
    pullFiles: () => [{ path: "tdds/queue.md", status: "modified" }],
    file: (_owner, _repo, ref) => ref === PROPOSED ? DOC.replace("201", "200") : DOC,
    commit: () => SPEC_SHA,
  };
}
const stored = (a = assessment(), id = "d".repeat(64)): StoredAssessment => ({ id, assessment: a, report: "# Original review\n" });
const feature = () => buildFeature(parseFeature(YAML, "queue.yml"), "queue", github());
const home = () => { const h = tmp(); writeFileSync(join(h, "queue.yml"), YAML); return h; };

test("feature handoff pins baseline and proposed specs and uses the project's selected skill", () => {
  const h = home();
  const repo = tmp();
  writeFileSync(join(repo, "selected.md"), "# Team conformance\nRead references/rules.md.\n");
  writeFileSync(join(repo, ".tails.yml"), "skills:\n  conformance: selected.md\n");
  const out = join(tmp(), "task");
  prepareFeatureAssessment(h, "queue", repo, "https://github.com/acme/api/pull/9", out, github());
  const context = JSON.parse(read(join(out, "context.json")));
  assert.equal(context.pr.headSha, CODE_SHA);
  assert.deepEqual(context.sources.map((s: { purpose: string; revision: string }) => [s.purpose, s.revision]), [["proposed", PROPOSED], ["baseline", SPEC_SHA]]);
  assert.match(read(join(out, "skill.md")), /Team conformance/);
  assert.match(read(join(out, "prompt.md")), /feature import queue/);
  assert.equal(JSON.parse(read(join(out, "result.schema.json"))).$id, "tails.verdict/2");
  assert.throws(() => prepareFeatureAssessment(h, "queue", repo, undefined, join(tmp(), "task"), github()), /choose one linked/);
});

test("import is immutable, idempotent, feature-bound and survives report refresh", () => {
  const h = home();
  const task = tmp();
  const file = join(task, "result.json");
  writeFileSync(file, JSON.stringify(deviating()));
  writeFileSync(join(task, "report.md"), "# The team's full review\n<script>alert(1)</script>");
  const id = importAssessment(h, "queue", file);
  assert.equal(importAssessment(h, "queue", file), id);
  assert.equal(readAssessments(h, "queue").length, 1);
  const report = renderFeature(h, "queue", github(), "now");
  const html = read(join(report.dir, "site/conformance.html"));
  assert.match(html, /Does not conform — 1 decisions needed/);
  assert.match(html, /Option A — change the PR/);
  assert.match(html, /Option B — update the specs/);
  assert.doesNotMatch(html.split("<h2>acme/api#9")[0]!, /Join returns 200/, "the breakdown describes the assessed baseline, not the proposed head");
  assert.match(html, /acme\/api\/blob\/b{40}\/src\/queue.ts#L8/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;alert/);
  assert.match(read(join(report.dir, "site/index.html")), /conformance.html/);
  renderFeature(h, "queue", github(), "later");
  assert.equal(readAssessments(h, "queue").length, 1);
  writeFileSync(file, JSON.stringify({ ...assessment(), pr: { ...assessment().pr, number: 99 } }));
  assert.throws(() => importAssessment(h, "queue", file), /not an implementation PR/);
  assert.equal(readFileSync(join(h, "assessments/queue", `${id}.json`), "utf8"), JSON.stringify(deviating(), null, 2) + "\n");
});

test("freshness checks code and baseline revisions and retains unverified external sources", () => {
  const f = feature();
  const snapshots = featureSnapshots(f, github());
  assert.equal(assessFreshness([stored()], f, snapshots)[0]!.freshness, "current");
  assert.equal(assessFreshness([stored({ ...assessment(), pr: { ...assessment().pr, head_sha: "e".repeat(40) } })], f, snapshots)[0]!.freshness, "outdated");
  assert.equal(assessFreshness([stored()], f, snapshots.map((s) => s.purpose === "baseline" ? { ...s, revision: PROPOSED } : s))[0]!.freshness, "outdated");
  const tracker = { ...assessment(), sources: [...assessment().sources, { key: "ticket", kind: "ticket" as const, location: "https://linear.app/acme/issue/APP-1", revision: "2026-11-04", purpose: "baseline" as const }] };
  assert.equal(assessFreshness([stored(tracker)], f, snapshots)[0]!.freshness, "unverified");
});

test("aggregation preserves conflicting PR scopes and excludes stale or superseded reviews", () => {
  const f = feature();
  const ix = buildIndex(f.docs, DEFAULT_CONFIG, { group: "queue" });
  const snapshots = featureSnapshots(f, github());
  const other = { ...deviating(), pr: { ...assessment().pr, number: 10 } };
  const mixed = assessFreshness([stored(), stored(other, "e".repeat(64))], f, snapshots);
  const row = assessedRequirements(ix, mixed).find((r) => r.source === LOCATION)!;
  assert.equal(row.outcome, "mixed");
  assert.equal(row.evidence.length, 2);
  const newer = { ...deviating(), checked_at: "2026-11-04T11:00:00Z" };
  const runs = assessFreshness([stored(), stored(newer, "e".repeat(64))], f, snapshots);
  assert.equal(runs[0]!.superseded, true);
  assert.equal(assessedRequirements(ix, runs)[0]!.outcome, "deviates");
  assert.equal(assessedRequirements(ix, assessFreshness([stored()], f, []))[0]!.outcome, "unassessed");
});

test("assessment storage refuses directory symlinks", () => {
  const h = home();
  const outside = tmp();
  mkdirSync(join(h, "assessments"));
  symlinkSync(outside, join(h, "assessments/queue"));
  assert.throws(() => readAssessments(h, "queue"), /must not be symbolic links/);
});

test("the import command accepts structured results and rejects unrelated flags", async () => {
  const h = home();
  const file = join(tmp(), "result.json");
  writeFileSync(file, JSON.stringify(assessment()));
  assert.equal(await main(["feature", "import", "queue", "--home", h, "--result", file]), 0);
  assert.equal(readAssessments(h, "queue").length, 1);
  assert.throws(() => main(["feature", "import", "queue", "--result", file, "--pr", "https://github.com/acme/api/pull/9"]), /--pr is not supported/);
  assert.throws(() => main(["feature", "prepare", "queue", "--no-serve"]), /--no-serve is not supported/);
});

test("malformed specs do not hide an imported assessment's spec defects", () => {
  const h = home();
  const file = join(tmp(), "result.json");
  writeFileSync(file, JSON.stringify({ ...assessment(), overall: "cannot_check", results: [], not_checked: [{ source: "TDD", reason: "Duplicate WL-01 definitions." }] }));
  importAssessment(h, "queue", file);
  const gh = github();
  gh.file = () => DOC + "\n- **WL-01** A contradictory contract.\n";
  const report = renderFeature(h, "queue", gh, "now");
  assert.match(read(join(report.dir, "site/index.html")), /Spec indexing unavailable/);
  assert.match(read(join(report.dir, "site/conformance.html")), /Cannot check/);
});

test("closed unmerged documentation heads never become the conformance baseline", () => {
  for (const hasBaseline of [true, false]) {
    const gh = github();
    const pull = gh.pull;
    gh.pull = (ref) => ({ ...pull(ref), state: ref.repo === "docs" ? "closed" : "open" });
    gh.file = (_owner, _repo, ref) => ref === PROPOSED ? DOC.replace("201", "200") : hasBaseline ? DOC : null;
    const f = buildFeature(parseFeature(YAML, "queue.yml"), "queue", gh);
    const sources = featureSnapshots(f, gh);
    assert.equal(sources.find((s) => s.revision === PROPOSED)?.purpose, "proposed");
    assert.deepEqual(sources.filter((s) => s.purpose === "baseline").map((s) => s.revision), hasBaseline ? [SPEC_SHA] : []);
    assert.equal(assessFreshness([stored()], f, sources)[0]!.freshness, hasBaseline ? "current" : "unverified");
  }
});
