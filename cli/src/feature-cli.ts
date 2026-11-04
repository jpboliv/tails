// `tails feature`: list features, create one from links, or read one and open its report.
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { DEFAULT_CONFIG } from "./config.js";
import { driftMarkdown, type DriftReport } from "./drift-io.js";
import { runRules } from "./drift.js";
import {
  buildFeature,
  checkSlug,
  DOC_ROLES,
  ensureHome,
  featureFiles,
  featureYaml,
  githubCli,
  linearKey,
  parseBlob,
  parsePr,
  readFeature,
  REPORTS,
  ROLE_LABEL,
  slugOf,
  type DocLink,
  type DocRole,
  type FeatureSpec,
  type GitHub,
} from "./feature.js";
import { buildIndex, type SourceDoc } from "./indexer.js";
import { TailsInputError, type DocPath, type SpecIndex } from "./model.js";
import { serve } from "./serve.js";
import { renderSite } from "./site.js";
import { plural, toJson } from "./util.js";
import { assessFreshness, featureSnapshots, readAssessments } from "./feature-assessments.js";

export interface FeatureOptions {
  readonly home: string;
  readonly port: number;
  readonly open: boolean;
  readonly serve: boolean;
  readonly name?: string;
  readonly links: Readonly<Record<DocRole, readonly string[]>>;
  readonly linear?: string;
  readonly prs: readonly string[];
}

/** "3 Nov 2026, 14:05" in local time. */
export const readAtLabel = (d: Date): string =>
  `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}, ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/** Reads a feature's sources and writes its report under the Tails folder. Returns the report folder. */
export function renderFeature(home: string, slug: string, github: GitHub, readAt: string): { dir: string; ids: number; open: number; failing: number; docs: number } {
  const spec = readFeature(home, slug);
  const feature = buildFeature(spec, slug, github);
  const { assessments: stored, unreadable } = readAssessments(home, slug);
  const snapshots = featureSnapshots(feature, github);
  const assessments = assessFreshness(stored, feature, snapshots);
  if (feature.docs.length === 0) throw new TailsInputError(`${slug}: no documents found in the linked pull requests`);
  const notes = [...feature.notes];
  if (unreadable.length) notes.push(`${plural(unreadable.length, "stored assessment")} could not be read. Files were retained; see Implementation assessments for diagnostics.`);
  const indexSources = (sources: readonly SourceDoc[]): SpecIndex => {
    const options = { refs: feature.sources.map((s) => s.readFrom), group: feature.linear?.key ?? slug };
    try { return buildIndex(sources, DEFAULT_CONFIG, options); }
    catch (e) {
      if ((!stored.length && !unreadable.length) || !(e instanceof TailsInputError)) throw e;
      notes.push(`Spec indexing unavailable: ${e.message}. Read the source and imported spec defects; document coverage was not assessed.`);
      return { ...buildIndex([], DEFAULT_CONFIG, options), docs: sources.map((s) => ({ path: s.path, kind: s.kind, title: s.path, epic: null, group: options.group, ...(s.source ? { source: s.source } : {}) })) };
    }
  };
  const index = indexSources(feature.docs);
  const baseline = snapshots.filter((s) => s.purpose === "baseline").map((s): SourceDoc => ({ path: s.location as DocPath, kind: s.kind, text: s.text, source: { ref: "conformance baseline", commit: s.revision } }));
  const assessmentIndex = indexSources(baseline);
  const findings = runRules({ index, config: DEFAULT_CONFIG, prdChanges: null });
  const report: DriftReport = { schema: "tails.drift/1", source: "tails", commit: null, findings };
  const dir = join(home, REPORTS, slug);
  for (const path of [join(home, REPORTS), dir]) {
    try {
      if (lstatSync(path).isSymbolicLink()) throw new TailsInputError(`${path}: report directories must not be symbolic links`);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const pages = renderSite(index, feature.docs, findings, { feature: { ...feature, notes }, readAt, assessments, assessmentIndex, unreadableAssessments: unreadable });
  rmSync(dir, { recursive: true, force: true });
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  write("index.json", toJson(index));
  write("drift.json", toJson(report));
  write("drift.md", driftMarkdown(report));
  write("assessments.json", toJson(assessments));
  write("assessment-errors.json", toJson(unreadable));
  for (const [path, html] of pages) write(join("site", path), html);
  const open = findings.filter((f) => f.status === "open");
  return { dir, ids: index.entries.length, open: open.length, failing: open.filter((f) => f.severity === "fail").length, docs: feature.docs.length };
}

/** A new feature from flags, or by asking for each link when a person is at the terminal. */
async function newFeature(o: FeatureOptions): Promise<string> {
  let name = o.name;
  const links: Record<DocRole, string[]> = { prd: [...o.links.prd], tdd: [...o.links.tdd], tests: [...o.links.tests] };
  let linear = o.linear;
  const prs = [...o.prs];
  const asked = !name && process.stdin.isTTY;
  if (asked) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const ask = async (q: string, ok: (s: string) => boolean, bad: string): Promise<string> => {
      for (;;) {
        const a = (await rl.question(q)).trim();
        if (a === "" || ok(a)) return a;
        console.log(`  ${bad}`);
      }
    };
    const docLink = (s: string) => !!(parsePr(s) || parseBlob(s));
    try {
      console.log("A feature is a set of links. Press Enter to skip one.\n");
      name = await ask("Feature name: ", (s) => s.length > 0, "Give the feature a name.");
      if (!name) throw new TailsInputError("a feature needs a name");
      for (const r of DOC_ROLES) {
        const a = await ask(`${ROLE_LABEL[r]} (pull request or file link): `, docLink, "Paste a GitHub pull request or file link.");
        if (a) links[r].push(a);
      }
      linear = (await ask("Linear ticket (key or link): ", (s) => !!linearKey(s), "Paste a ticket key such as ACME-12, or its Linear link.")) || undefined;
      for (;;) {
        const a = await ask("Implementation pull request (Enter when done): ", (s) => !!parsePr(s), "Paste a GitHub pull request link.");
        if (!a) break;
        prs.push(a);
      }
    } finally {
      rl.close();
    }
  }
  if (!name) throw new TailsInputError("tails feature new needs --name and at least one of --prd, --tdd or --tests (or run it in a terminal to be asked)");
  const spec: FeatureSpec = {
    name,
    docs: Object.fromEntries(DOC_ROLES.map((r) => [r, links[r].map((link): DocLink => ({ link }))])) as Record<DocRole, DocLink[]>,
    linear: linear ?? null,
    implementation: prs,
  };
  if (DOC_ROLES.every((r) => spec.docs[r].length === 0)) throw new TailsInputError("a feature needs at least one document: a PRD, a TDD or test cases");
  const slug = slugOf(name);
  checkSlug(slug);
  ensureHome(o.home);
  const file = join(o.home, `${slug}.yml`);
  if (existsSync(file)) throw new TailsInputError(`${file} already exists. Edit it, or open it with: tails feature ${slug}`);
  // Validate through the same parser that reads it back, so a saved file always opens.
  const text = featureYaml(spec);
  writeFileSync(file, text);
  try {
    readFeature(o.home, slug);
  } catch (e) {
    rmSync(file);
    throw e;
  }
  console.log(`tails feature: saved ${file}`);
  return slug;
}

function openBrowser(url: string): void {
  const [cmd, args] = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd as string, args as string[], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // The address is printed; opening a browser is a convenience.
  }
}

/** Serves the report, moving to the next port when one is taken. */
async function serveReport(dir: string, port: number, open: boolean): Promise<void> {
  const last = Math.min(port + 19, 65535);
  for (let p = port; p <= last; p++) {
    try {
      const server = await serve(join(dir, "site"), p);
      const address = server.address();
      const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : p}/`;
      console.log(`tails feature: open ${url} (Ctrl+C to stop)`);
      if (open) openBrowser(url);
      return;
    } catch (e) {
      if ((e as { code?: string }).code !== "EADDRINUSE") throw e;
    }
  }
  throw new TailsInputError(`ports ${port} to ${last} are all in use; pass --port`);
}

export async function featureCommand(args: readonly string[], o: FeatureOptions, github: GitHub = githubCli): Promise<number> {
  const [sub, ...more] = args;
  if (more.length) throw new TailsInputError(`tails feature takes one name, got: ${args.join(" ")}`);
  if (sub !== "new" && (o.name !== undefined || o.linear !== undefined || o.prs.length || DOC_ROLES.some((r) => o.links[r].length))) {
    throw new TailsInputError("--name, --prd, --tdd, --tests, --linear and --pr only work with tails feature new; edit the saved feature file to change its links");
  }
  if (!sub || sub === "list") {
    const all = featureFiles(o.home);
    if (!all.length) {
      console.log(`No features yet in ${o.home}.\nCreate one with: tails feature new`);
      return 0;
    }
    console.log(`Features in ${o.home}:\n${all.map((s) => `  ${s}`).join("\n")}\n\nOpen one with: tails feature <name>`);
    return 0;
  }
  const slug = sub === "new" ? await newFeature(o) : sub;
  console.log(`tails feature: reading ${slug}…`);
  const r = renderFeature(o.home, slug, github, readAtLabel(new Date()));
  console.log(`tails feature: ${r.docs} documents, ${r.ids} IDs, ${r.open} open findings (${r.failing} failing). Report in ${r.dir}`);
  if (o.serve) await serveReport(r.dir, o.port, o.open);
  return 0;
}
