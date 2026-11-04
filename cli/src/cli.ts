#!/usr/bin/env node
// CLI boundary. Exit codes: 0 ok, 1 failing findings, 2 input error.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseConfig, type Config } from "./config.js";
import { applyAccepted, driftMarkdown, parseAccepted, parseExtraFindings, type DriftReport } from "./drift-io.js";
import { runRules, type Finding } from "./drift.js";
import { prdChanges } from "./history.js";
import { buildIndex, type SourceDoc } from "./indexer.js";
import { TailsInputError, type SpecIndex } from "./model.js";
import { loadSources, openRepo, type Repo } from "./repo.js";
import { review, reviewMarkdown } from "./review.js";
import { serve } from "./serve.js";
import { renderSite } from "./site.js";
import { skillsCommand } from "./skills.js";
import { featureCommand } from "./feature-cli.js";
import { featureHome, githubCli } from "./feature.js";
import { importAssessment, prepareFeatureAssessment } from "./feature-assessments.js";
import { toJson } from "./util.js";

const USAGE = `tails: requirement tracking, spec reports and project skills

  tails report --repo <path> [--ref <ref>]... [--out <dir>] [--extra <file>]... [--strict]   index + drift + site
  tails index  --repo <path> [--ref <ref>]... [--out index.json]
  tails drift  --repo <path> [--ref <ref>]... [--out <dir>] [--extra <tails.drift/1 file>]... [--strict]
  tails site   --repo <path> [--ref <ref>]... [--out site/]
  tails review --repo <path> --base <ref> --head <ref> [--with <ref>]... [--out review.md]
  tails serve  [<dir>] [--port 4173]                          preview a site at http://127.0.0.1:<port>/
  tails skills list|show|init|prepare [<role>] --repo <path>   select and customize agent skills
    prepare needs --task <request> [--out <new directory>]; roles: spec-review, pr-review, conformance
  tails feature [list]                                       list your features
  tails feature new [--name <name> --prd <link> --tdd <link> --tests <link> --linear <key> --pr <link>...]
                                                             save a feature from its links, then open it
  tails feature <name> [--port 4173] [--no-open] [--no-serve]  read the links again and open the report
  tails feature prepare <name> --repo <code checkout> --out <new task folder> [--pr <url>]
  tails feature import <name> --result <result.json> [--report <report.md>]
    Features live in ~/tails-documentation (or --home, or $TAILS_HOME), never in a project.
    Links are GitHub pull requests or files, read with your GitHub CLI login (gh).

Several --ref flags read the refs as one tree; a later ref wins a path both hold. Use it to read
spec PRs that have not merged: --ref origin/main --ref origin/pr/77 --ref origin/pr/79.

Exit codes: 0 ok, 1 failing findings (drift --strict, review), 2 input error.`;

interface Loaded {
  readonly repo: Repo;
  readonly config: Config;
  readonly sources: SourceDoc[];
  readonly index: SpecIndex;
}

/** `emptyOk` is for a review base: the first spec PR in a repository has nothing before it. */
function load(root: string, refs: readonly string[] = [], emptyOk = false): Loaded {
  const repo = openRepo(root, refs);
  for (const s of repo.shadowed) console.error(`tails: ${s.path} differs between ${s.refs.join(", ")}; reading it from ${s.refs[s.refs.length - 1]}`);
  const config = parseConfig(repo.read(".tails.yml"));
  const sources = loadSources(repo, config);
  if (sources.length === 0 && !emptyOk) throw new TailsInputError(`${root}: no spec documents under ${Object.values(config.docs).flat().join(", ")}`);
  const index = buildIndex(sources, config, { commit: repo.commit, ...(repo.refs.length > 1 ? { refs: repo.refs } : {}) });
  return { repo, config, sources, index };
}

function drift(l: Loaded, extraFiles: readonly string[] = []): DriftReport {
  const own = runRules({ index: l.index, config: l.config, prdChanges: prdChanges(l.index, l.repo.git, l.config) });
  const extra: Finding[] = extraFiles.flatMap((f) => parseExtraFindings(readText(f), f));
  const accepted = parseAccepted(l.repo.read(".tails/accepted.yml"));
  return { schema: "tails.drift/1", source: "tails", commit: l.index.commit, findings: applyAccepted([...own, ...extra], accepted) };
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new TailsInputError(`${path}: cannot read file`);
  }
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writeSite(dir: string, l: Loaded, report: DriftReport): void {
  for (const [path, html] of renderSite(l.index, l.sources, report.findings)) write(join(dir, path), html);
}

function failing(report: DriftReport): number {
  return report.findings.filter((f) => f.status === "open" && f.severity === "fail").length;
}

export function main(argv: readonly string[]): number | Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  const { values, positionals, tokens } = parseArgs({
    args: [...rest],
    options: {
      repo: { type: "string", default: "." },
      ref: { type: "string", multiple: true },
      with: { type: "string", multiple: true },
      out: { type: "string" },
      extra: { type: "string", multiple: true },
      strict: { type: "boolean", default: false },
      base: { type: "string" },
      head: { type: "string" },
      port: { type: "string", default: "4173" },
      task: { type: "string" },
      result: { type: "string" },
      report: { type: "string" },
      home: { type: "string" },
      name: { type: "string" },
      prd: { type: "string", multiple: true },
      tdd: { type: "string", multiple: true },
      tests: { type: "string", multiple: true },
      linear: { type: "string" },
      pr: { type: "string", multiple: true },
      "no-open": { type: "boolean", default: false },
      "no-serve": { type: "boolean", default: false },
    },
    allowPositionals: command === "serve" || command === "skills" || command === "feature",
    strict: true,
    tokens: true,
  });
  const root = resolve(values.repo!);
  const flags: Record<string, readonly string[]> = {
    report: ["repo", "ref", "out", "extra", "strict"],
    index: ["repo", "ref", "out"],
    drift: ["repo", "ref", "out", "extra", "strict"],
    site: ["repo", "ref", "out"],
    review: ["repo", "base", "head", "with", "out"],
    serve: ["port"],
    skills: ["repo", "out", "task"],
    feature: positionals[0] === "prepare" ? ["home", "repo", "out", "pr"]
      : positionals[0] === "import" ? ["home", "result", "report"]
        : ["home", "name", "prd", "tdd", "tests", "linear", "pr", "no-open", "no-serve", "port"],
  };
  for (const token of tokens) {
    if (token.kind === "option" && flags[command] && !flags[command]!.includes(token.name)) {
      throw new TailsInputError(`--${token.name} is not supported by tails ${command}`);
    }
  }

  switch (command) {
    case "feature": {
      const home = featureHome(values.home);
      const [action, slug] = positionals;
      if (action === "prepare" || action === "import") {
        if (positionals.length !== 2) throw new TailsInputError(`use tails feature ${action} <name>`);
        if (action === "prepare") {
          if (!values.out || !tokens.some((t) => t.kind === "option" && t.name === "repo") || (values.pr?.length ?? 0) > 1) throw new TailsInputError("feature prepare needs --repo <code checkout> --out <new task folder> and optionally one --pr <url>");
          prepareFeatureAssessment(home, slug!, root, values.pr?.[0], values.out, githubCli);
        } else {
          if (!values.result) throw new TailsInputError("feature import needs --result <result.json> and optionally --report <report.md>");
          const id = importAssessment(home, slug!, values.result, values.report);
          console.log(`tails feature: imported ${id.slice(0, 12)} for ${slug}. Run tails feature ${slug} to refresh the report.`);
        }
        return 0;
      }
      const port = Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TailsInputError(`--port must be a port number, got "${values.port}"`);
      return featureCommand(positionals, {
        home,
        port,
        open: !values["no-open"],
        serve: !values["no-serve"],
        ...(values.name ? { name: values.name } : {}),
        links: { prd: values.prd ?? [], tdd: values.tdd ?? [], tests: values.tests ?? [] },
        ...(values.linear ? { linear: values.linear } : {}),
        prs: values.pr ?? [],
      });
    }
    case "skills": {
      skillsCommand(root, positionals, { out: values.out, task: values.task });
      return 0;
    }
    case "index": {
      const l = load(root, values.ref ?? []);
      write(values.out ?? "index.json", toJson(l.index));
      console.log(`tails index: ${l.index.entries.length} IDs in ${l.index.docs.length} documents`);
      return 0;
    }
    case "drift": {
      const l = load(root, values.ref ?? []);
      const report = drift(l, values.extra ?? []);
      const out = values.out ?? ".";
      write(join(out, "drift.json"), toJson(report));
      write(join(out, "drift.md"), driftMarkdown(report));
      const open = report.findings.filter((f) => f.status === "open").length;
      console.log(`tails drift: ${open} open findings, ${failing(report)} failing`);
      return values.strict && failing(report) > 0 ? 1 : 0;
    }
    case "site": {
      const l = load(root, values.ref ?? []);
      writeSite(values.out ?? "site", l, drift(l));
      console.log(`tails site: wrote ${values.out ?? "site"}/index.html`);
      return 0;
    }
    case "report": {
      const l = load(root, values.ref ?? []);
      const report = drift(l, values.extra ?? []);
      const out = values.out ?? "tails-report";
      write(join(out, "index.json"), toJson(l.index));
      write(join(out, "drift.json"), toJson(report));
      write(join(out, "drift.md"), driftMarkdown(report));
      writeSite(join(out, "site"), l, report);
      console.log(`tails report: ${l.index.entries.length} IDs, ${report.findings.filter((f) => f.status === "open").length} open findings (${failing(report)} failing). Open ${join(out, "site", "index.html")}`);
      return values.strict && failing(report) > 0 ? 1 : 0;
    }
    case "review": {
      if (!values.base || !values.head) throw new TailsInputError("review needs --base and --head");
      // --with layers other refs (say, sibling spec PRs) under both sides, so a TDD PR is read with its PRD.
      const context = values.with ?? [];
      const base = load(root, [...context, values.base], true);
      const head = load(root, [...context, values.head]);
      const r = review(base.index, head.index, drift(base).findings, drift(head).findings);
      const configChanged = base.repo.read(".tails.yml") !== head.repo.read(".tails.yml");
      write(values.out ?? "review.md", reviewMarkdown(r, { base: values.base, head: values.head, with: context, index: head.index, configChanged }));
      console.log(`tails review: ${r.failures.length === 0 ? "passes" : `fails (${r.failures.length})`}`);
      return r.failures.length === 0 ? 0 : 1;
    }
    case "serve": {
      if (positionals.length > 1) throw new TailsInputError("tails serve takes one report directory");
      const port = Number(values.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new TailsInputError(`--port must be a port number, got "${values.port}"`);
      const given = positionals[0] ?? "tails-report";
      // A report directory holds site/; serve that so `tails serve tails-report` just works.
      const dir = existsSync(join(given, "site", "index.html")) && !existsSync(join(given, "index.html")) ? join(given, "site") : given;
      serve(dir, port).then(
        (s) => {
          const a = s.address();
          console.log(`tails serve: ${dir} at http://127.0.0.1:${typeof a === "object" && a ? a.port : port}/ (Ctrl+C to stop)`);
        },
        (e: Error) => {
          console.error(`tails: ${e.message}`);
          process.exitCode = 2;
        },
      );
      return 0;
    }
    default:
      throw new TailsInputError(`unknown command "${command}"\n\n${USAGE}`);
  }
}

function failed(e: unknown): number {
  const known = e instanceof TailsInputError || (e as { code?: string }).code?.startsWith("ERR_PARSE_ARGS");
  console.error(known ? `tails: ${(e as Error).message}` : e);
  return 2;
}

/** Most commands finish at once; `tails feature` may ask questions and keep serving, so it is async. */
export function run(argv: readonly string[]): number | Promise<number> {
  try {
    const r = main(argv);
    return typeof r === "number" ? r : r.catch(failed);
  } catch (e) {
    return failed(e);
  }
}

// realpath on both sides so the check holds when npm runs us through a bin symlink.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  const r = run(process.argv.slice(2));
  if (typeof r === "number") process.exitCode = r;
  else void r.then((code) => (process.exitCode = code));
}
