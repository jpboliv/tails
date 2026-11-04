// Feature assessment storage and handoffs. Reports are disposable; assessments are retained separately.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseAssessment, prKey, type Assessment, type AssessmentResult, type Outcome } from "./assessment.js";
import { buildFeature, checkSlug, parsePr, readFeature, type Feature, type GitHub } from "./feature.js";
import { TailsInputError, type SpecIndex } from "./model.js";
import { skillsCommand } from "./skills.js";
import { toJson } from "./util.js";
import { isRetired } from "./reader.js";

export interface SpecSnapshot {
  readonly location: string;
  readonly kind: "prd" | "tdd" | "tcs";
  readonly purpose: "baseline" | "proposed";
  readonly revision: string;
  readonly text: string;
}
export interface StoredAssessment {
  readonly id: string;
  readonly assessment: Assessment;
  readonly report: string | null;
}
export interface AssessmentRun extends StoredAssessment {
  readonly freshness: "current" | "outdated" | "unverified";
  readonly codeSpecFreshness: AssessmentRun["freshness"];
  readonly reasons: readonly string[];
  readonly superseded: boolean;
}
export interface UnreadableAssessment {
  readonly id: string;
  readonly error: string;
}
export interface AssessedRequirement {
  readonly key: string;
  readonly id: string;
  readonly source: string;
  readonly text: string;
  readonly outcome: Outcome | "mixed" | "unassessed";
  readonly evidence: readonly { readonly run: string; readonly pr: string; readonly result: AssessmentResult; readonly freshness: AssessmentRun["freshness"]; readonly superseded: boolean }[];
}

function assessmentDir(home: string, slug: string): string {
  checkSlug(slug);
  for (const path of [join(home, "assessments"), join(home, "assessments", slug)]) {
    try {
      if (lstatSync(path).isSymbolicLink()) throw new TailsInputError(`${path}: assessment directories must not be symbolic links`);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
  return join(home, "assessments", slug);
}

export function readAssessments(home: string, slug: string): { assessments: StoredAssessment[]; unreadable: UnreadableAssessment[] } {
  const dir = assessmentDir(home, slug);
  const assessments: StoredAssessment[] = [];
  const unreadable: UnreadableAssessment[] = [];
  if (!existsSync(dir)) return { assessments, unreadable };
  for (const p of readdirSync(dir).filter((p) => /^[a-f0-9]{64}\.json$/.test(p)).sort()) {
    const file = join(dir, p);
    if (lstatSync(file).isSymbolicLink()) throw new TailsInputError(`${file}: assessment files must not be symbolic links`);
    const report = file.replace(/\.json$/, ".md");
    if (existsSync(report) && lstatSync(report).isSymbolicLink()) throw new TailsInputError(`${report}: assessment files must not be symbolic links`);
    try {
      assessments.push({ id: p.slice(0, -5), assessment: parseAssessment(readFileSync(file, "utf8"), file), report: existsSync(report) ? readFileSync(report, "utf8") : null });
    } catch (e) {
      if (!(e instanceof TailsInputError)) throw e;
      unreadable.push({ id: p.slice(0, -5), error: e.message });
    }
  }
  return { assessments, unreadable };
}

export function importAssessment(home: string, slug: string, file: string, reportFile?: string): string {
  const spec = readFeature(home, slug);
  const assessment = parseAssessment(readFileSync(file, "utf8"), file);
  if (!spec.implementation.some((link) => {
    const pr = parsePr(link)!;
    return `${pr.owner}/${pr.repo}#${pr.number}` === prKey(assessment.pr);
  })) throw new TailsInputError(`${file}: ${prKey(assessment.pr)} is not an implementation PR linked to ${slug}`);
  const text = toJson(assessment);
  const id = createHash("sha256").update(text).digest("hex");
  const dir = assessmentDir(home, slug);
  const markdown = reportFile ?? join(dirname(file), "report.md");
  const report = reportFile || existsSync(markdown) ? readFileSync(markdown, "utf8") : null;
  mkdirSync(dir, { recursive: true });
  const save = (path: string, content: string) => {
    try { writeFileSync(path, content, { flag: "wx" }); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST" || lstatSync(path).isSymbolicLink() || readFileSync(path, "utf8") !== content) {
        throw new TailsInputError(`${path}: an imported assessment is immutable; use a new assessment for a new review`);
      }
    }
  };
  save(join(dir, `${id}.json`), text);
  if (report !== null) save(join(dir, `${id}.md`), report);
  return id;
}

/** Keep proposed specs visible while independently resolving the accepted baseline for conformance. */
export function featureSnapshots(feature: Feature, github: GitHub): SpecSnapshot[] {
  const snapshots: SpecSnapshot[] = [];
  const commits = new Map<string, string | null>();
  for (const doc of feature.docs) {
    const source = feature.sources.find((s) => s.docs.includes(doc.path))!;
    const proposed = source.pull !== null && source.pull.state !== "merged";
    snapshots.push({ location: doc.path, kind: doc.kind, revision: source.readFrom.commit, purpose: proposed ? "proposed" : "baseline", text: doc.text });
    if (!proposed) continue;
    const [owner, repo, ...path] = doc.path.split("/");
    const ref = source.pull!.baseRef;
    const key = `${owner}/${repo}@${ref}`;
    if (!commits.has(key)) commits.set(key, github.commit(owner!, repo!, ref));
    const revision = commits.get(key);
    if (!revision) throw new TailsInputError(`${key}: cannot resolve the conformance baseline`);
    const text = github.file(owner!, repo!, revision, path.join("/"));
    if (text !== null) snapshots.push({ location: doc.path, kind: doc.kind, revision, purpose: "baseline", text });
  }
  return snapshots;
}

export function prepareFeatureAssessment(home: string, slug: string, root: string, prUrl: string | undefined, output: string, github: GitHub): void {
  if (prUrl && !parsePr(prUrl)) throw new TailsInputError(`${prUrl}: expected a GitHub pull request link`);
  const feature = buildFeature(readFeature(home, slug), slug, github);
  const chosen = prUrl ? parsePr(prUrl) : null;
  const pr = chosen
    ? feature.implementation.find((p) => p.repo === `${chosen.owner}/${chosen.repo}` && p.number === chosen.number)
    : feature.implementation.length === 1 ? feature.implementation[0] : undefined;
  if (!pr) throw new TailsInputError(`${slug}: choose one linked implementation PR with --pr <url>`);
  const snapshots = featureSnapshots(feature, github);
  const context = {
    feature: feature.spec.name, pr, ticket_hint: feature.spec.linear, sources: snapshots,
    instructions: "Fetch the PR's actual tickets and parents using the selected skill. The feature ticket is a hint, not the scope of every PR. Baseline sources govern verdicts; proposed sources show possible resolutions. Missing baseline documents must be reported as unavailable.",
  };
  const out = resolve(output);
  const task = `Assess ${pr.url} at head ${pr.headSha} for feature ${JSON.stringify(feature.spec.name)}.\nRead context.json in this handoff folder for the linked documents, exact baseline/proposed revisions, and ticket hint.\nCollect the PR body, diff, unchanged code at this head, and actual ticket scope as the selected skill requires.\nImport the completed result with: tails feature import ${slug} --home ${JSON.stringify(home)} --result ${JSON.stringify(join(out, "result.json"))}`;
  skillsCommand(root, ["prepare", "conformance"], { task, out });
  writeFileSync(join(out, "context.json"), toJson(context), { flag: "wx" });
}

export function assessFreshness(stored: readonly StoredAssessment[], feature: Feature, snapshots: readonly SpecSnapshot[]): AssessmentRun[] {
  return stored.map((run) => {
    const a = run.assessment;
    const reasons: string[] = [];
    let outdated = false;
    let unverified = false;
    let ticketUnverified = false;
    const pr = feature.implementation.find((p) => `${p.repo}#${p.number}` === prKey(a.pr));
    if (!pr) { unverified = true; reasons.push("PR is no longer linked to this feature."); }
    else if (pr.headSha !== a.pr.head_sha) { outdated = true; reasons.push("Implementation head changed since this review."); }
    for (const source of a.sources) {
      if (source.kind === "ticket") {
        ticketUnverified = true;
        reasons.push(`${source.location}: ticket scope is unverified; reviewed ${source.revision}. Tails cannot refresh ticket sources.`);
        continue;
      }
      const now = snapshots.find((s) => s.location === source.location && s.purpose === source.purpose && s.kind === source.kind);
      if (!now) {
        unverified = true;
        reasons.push(`${source.location}: current revision is unavailable; reviewed ${source.revision}.`);
      } else if (now.revision !== source.revision) {
        outdated = true;
        reasons.push(`${source.location}: ${source.purpose} changed since ${source.revision.slice(0, 12)}.`);
      }
    }
    const superseded = stored.some((other) => prKey(other.assessment.pr) === prKey(a.pr) && Date.parse(other.assessment.checked_at) > Date.parse(a.checked_at));
    const codeSpecFreshness = outdated ? "outdated" : unverified ? "unverified" : "current";
    return { ...run, codeSpecFreshness, freshness: codeSpecFreshness === "current" && ticketUnverified ? "unverified" : codeSpecFreshness, reasons, superseded };
  });
}

/** Combine explicit PR-scoped evidence. Unknown, old and superseded runs never turn a row green. */
export function assessedRequirements(index: SpecIndex, runs: readonly AssessmentRun[]): AssessedRequirement[] {
  const rows = new Map<string, { id: string; source: string; text: string; evidence: AssessedRequirement["evidence"][number][] }>();
  for (const entry of index.entries) {
    if (!["FR", "REC", "MATRIX", "TC"].includes(entry.family) || (entry.family === "FR" && (!entry.id.includes(".") || isRetired(entry.text)))) continue;
    rows.set(`${entry.doc}#${entry.id}`, { id: entry.id, source: entry.doc, text: entry.text, evidence: [] });
  }
  for (const run of runs) for (const result of run.assessment.results) {
    const source = run.assessment.sources.find((s) => s.key === result.source)!;
    const row = rows.get(result.key) ?? { id: result.id, source: source.location, text: result.requirement, evidence: [] };
    row.evidence.push({ run: run.id, pr: prKey(run.assessment.pr), result, freshness: run.freshness, superseded: run.superseded });
    rows.set(result.key, row);
  }
  return [...rows].map(([key, row]): AssessedRequirement => {
    const current = row.evidence.filter((e) => e.freshness === "current" && !e.superseded);
    const outcomes = new Set(current.map((e) => e.result.verdict));
    const outcome = outcomes.size > 1 ? "mixed" : current[0]?.result.verdict ?? "unassessed";
    return { key, ...row, outcome };
  }).sort((a, b) => a.key.localeCompare(b.key));
}
