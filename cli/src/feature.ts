// `tails feature`: everything about one feature, from explicit links, read on your own machine.
//
// A feature file names the pull requests (or files) that hold the PRD, the TDD and the test case
// specification, the Linear ticket, and the implementation pull requests. Tails reads them with
// the GitHub CLI, under your own login, and renders the report locally. Nothing is published, and
// nothing is written to the projects: feature files and reports live in Tails' own folder.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DEFAULT_CONFIG } from "./config.js";
import type { SourceDoc } from "./indexer.js";
import { TailsInputError, type DocKind, type DocPath, type RefSource } from "./model.js";
import { parseYaml, YamlError } from "./yaml-lite.js";

// ---------------------------------------------------------------------------------------------
// The feature file

export const DOC_ROLES = ["prd", "tdd", "tests"] as const;
export type DocRole = (typeof DOC_ROLES)[number];
export const ROLE_KIND: Readonly<Record<DocRole, DocKind>> = { prd: "prd", tdd: "tdd", tests: "tcs" };
export const ROLE_LABEL: Readonly<Record<DocRole, string>> = { prd: "PRD", tdd: "TDD", tests: "Test cases" };

/** A link to a document: a pull request, or a file at a branch or commit. */
export interface DocLink {
  readonly link: string;
  /** The document to read when the pull request changes several. */
  readonly file?: string;
}

export interface FeatureSpec {
  readonly name: string;
  readonly docs: Readonly<Record<DocRole, readonly DocLink[]>>;
  /** The Linear ticket or epic, as given. */
  readonly linear: string | null;
  readonly implementation: readonly string[];
}

const KEYS = ["name", ...DOC_ROLES, "linear", "implementation"];

export function parseFeature(text: string, file: string): FeatureSpec {
  const fail = (msg: string): never => {
    throw new TailsInputError(`${file}: ${msg}`);
  };
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    fail(`not valid YAML (${e instanceof YamlError ? e.message : String(e)})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) fail("must be a mapping with name, prd, tdd, tests, linear and implementation");
  const top = raw as Record<string, unknown>;
  for (const k of Object.keys(top)) if (!KEYS.includes(k)) fail(`unknown key "${k}"; use ${KEYS.join(", ")}`);
  const name = typeof top.name === "string" && top.name.trim() ? top.name : fail("name must be a nonempty string");

  const link = (where: string, v: unknown): DocLink => {
    if (typeof v === "string") return { link: checkLink(where, v, fail) };
    if (typeof v !== "object" || v === null || Array.isArray(v)) return fail(`${where} must be a link, or a mapping with link and file`);
    const m = v as Record<string, unknown>;
    for (const k of Object.keys(m)) if (k !== "link" && k !== "file") fail(`${where}: unknown key "${k}"; use link and file`);
    if (typeof m.link !== "string") return fail(`${where}.link must be a link`);
    if (m.file !== undefined && (typeof m.file !== "string" || !m.file.trim())) fail(`${where}.file must be a path`);
    return { link: checkLink(`${where}.link`, m.link, fail), ...(m.file ? { file: (m.file as string).replace(/^\/+/, "") } : {}) };
  };
  const list = (v: unknown): unknown[] => (v === undefined || v === "" ? [] : Array.isArray(v) ? v : [v]);

  const docs = Object.fromEntries(DOC_ROLES.map((r) => [r, list(top[r]).map((v, i) => link(Array.isArray(top[r]) ? `${r}[${i}]` : r, v))])) as Record<DocRole, DocLink[]>;
  if (DOC_ROLES.every((r) => docs[r].length === 0)) fail("name at least one document: prd, tdd or tests");
  const linear = top.linear === undefined || top.linear === "" ? null : typeof top.linear === "string" ? top.linear.trim() : fail("linear must be a ticket key or link");
  if (linear !== null && !linearKey(linear)) fail(`linear: "${linear}" is not a ticket key such as ACME-12 or a Linear link`);
  const implementation = list(top.implementation).map((v, i) => {
    if (typeof v !== "string" || !parsePr(v)) return fail(`implementation[${i}] must be a pull request link`);
    return v.trim();
  });
  return { name: name.trim(), docs, linear, implementation };
}

function checkLink(where: string, v: string, fail: (m: string) => never): string {
  const s = v.trim();
  if (!parsePr(s) && !parseBlob(s)) fail(`${where}: "${s}" is not a GitHub pull request or file link`);
  return s;
}

/** The feature file Tails writes for `tails feature new`. */
export function featureYaml(f: FeatureSpec): string {
  const q = (s: string) => (/^[\w./:#@-]+$/.test(s) ? s : JSON.stringify(s));
  const out = [`name: ${q(f.name)}`];
  for (const r of DOC_ROLES) {
    const ls = f.docs[r];
    if (ls.length === 1 && !ls[0]!.file) out.push(`${r}: ${q(ls[0]!.link)}`);
    else if (ls.length) out.push(`${r}:`, ...ls.map((l) => (l.file ? `  - link: ${q(l.link)}\n    file: ${q(l.file)}` : `  - ${q(l.link)}`)));
  }
  if (f.linear) out.push(`linear: ${q(f.linear)}`);
  if (f.implementation.length) out.push("implementation:", ...f.implementation.map((l) => `  - ${q(l)}`));
  return out.join("\n") + "\n";
}

export const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-") || "feature";

// ---------------------------------------------------------------------------------------------
// Links

export interface PrRef {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export function parsePr(url: string): PrRef | null {
  const m = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/.exec(url.trim());
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null;
}

/** A file link: the ref and the path are split later, because a branch name can hold slashes. */
export function parseBlob(url: string): { owner: string; repo: string; rest: string[] } | null {
  const m = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([^?#]+)/.exec(url.trim());
  if (!m) return null;
  try {
    const rest = m[3]!.split("/").filter(Boolean).map(decodeURIComponent);
    return rest.length >= 2 ? { owner: m[1]!, repo: m[2]!, rest } : null;
  } catch {
    return null;
  }
}

export function linearKey(s: string): string | null {
  const m = /^(?:https?:\/\/linear\.app\/[^/]+\/issue\/)?([A-Z][A-Z0-9]*-\d+)(?:[/?#].*)?$/i.exec(s.trim());
  return m ? m[1]!.toUpperCase() : null;
}

export function linearUrl(s: string): string | null {
  return /^https?:\/\//.test(s) ? s : null;
}

// ---------------------------------------------------------------------------------------------
// Where features live

/**
 * The folder that holds feature files and reports: `--home`, then $TAILS_HOME, then
 * `~/tails-documentation`. Tails keeps its files apart from the projects it reads: it never looks
 * for this folder inside a project, so nothing of Tails lands in a project repository by default.
 */
export function featureHome(flag: string | undefined, cwd = process.cwd(), env = process.env, home = homedir()): string {
  if (flag) return resolve(cwd, flag);
  if (env.TAILS_HOME) return resolve(cwd, env.TAILS_HOME);
  return join(home, "tails-documentation");
}

/** Generated reports, one folder per feature. */
export const REPORTS = "reports";

/** A feature name is one filename, never a path or a command. */
export function checkSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(slug) || ["new", "list", "prepare", "import"].includes(slug.toLowerCase())) {
    throw new TailsInputError(`invalid feature name "${slug}"; use letters, numbers, hyphens or underscores, starting with a letter or number (not new, list, prepare or import)`);
  }
}

export function ensureHome(home: string): void {
  if (existsSync(home)) return;
  mkdirSync(home, { recursive: true });
  writeFileSync(
    join(home, "README.md"),
    "# Tails features\n\nEach `.yml` file here lists the documents and pull requests of one feature.\n" +
      `Run \`tails feature <name>\` to read them and open the report. Reports are written to \`${REPORTS}/\`.\n` +
      "This folder belongs to Tails. Keep it out of project repositories.\n",
  );
}

export function featureFiles(home: string): string[] {
  if (!existsSync(home)) return [];
  return readdirSync(home)
    .filter((f) => f.endsWith(".yml"))
    .map((f) => f.slice(0, -4))
    .sort();
}

export function readFeature(home: string, slug: string): FeatureSpec {
  checkSlug(slug);
  const file = join(home, `${slug}.yml`);
  if (!existsSync(file)) {
    const known = featureFiles(home);
    throw new TailsInputError(`no feature "${slug}" in ${home}.${known.length ? ` Known: ${known.join(", ")}.` : ""} Create one with: tails feature new`);
  }
  return parseFeature(readFileSync(file, "utf8"), file);
}

// ---------------------------------------------------------------------------------------------
// Reading from GitHub

export interface PullRequest {
  readonly url: string;
  readonly repo: string;
  readonly number: number;
  readonly title: string;
  readonly state: "open" | "draft" | "merged" | "closed";
  readonly author: string;
  readonly headSha: string;
  readonly baseRef: string;
  readonly updatedAt: string;
}

/** What Tails needs from GitHub. The CLI uses the GitHub CLI; tests pass a fake. */
export interface GitHub {
  pull(pr: PrRef): PullRequest;
  /** Files the pull request changes, with their status (added, modified, removed, renamed). */
  pullFiles(pr: PrRef): readonly { readonly path: string; readonly status: string }[];
  /** A file's text at a ref, or null when it does not exist there. */
  file(owner: string, repo: string, ref: string, path: string): string | null;
  /** The commit a ref points at. */
  commit(owner: string, repo: string, ref: string): string | null;
}

function gh(args: readonly string[]): string {
  try {
    return execFileSync("gh", [args[0]!, "--hostname", "github.com", ...args.slice(1)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 });
  } catch (e) {
    const err = e as { code?: string; stderr?: string };
    if (err.code === "ENOENT") throw new TailsInputError("tails feature reads GitHub with the GitHub CLI. Install it (https://cli.github.com) and run: gh auth login");
    throw new GhError((err.stderr ?? String(e)).trim().split("\n")[0] ?? "gh failed");
  }
}

class GhError extends TailsInputError {}

const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export const githubCli: GitHub = {
  pull({ owner, repo, number }) {
    let raw: Record<string, any>;
    try {
      raw = JSON.parse(gh(["api", `repos/${owner}/${repo}/pulls/${number}`]));
    } catch (e) {
      if (e instanceof GhError) throw new TailsInputError(`${owner}/${repo}#${number}: ${e.message}. Check the link and that \`gh auth status\` can see the repository.`);
      throw e;
    }
    const state = raw.merged_at ? "merged" : raw.state === "closed" ? "closed" : raw.draft ? "draft" : "open";
    return {
      url: raw.html_url,
      repo: `${owner}/${repo}`,
      number,
      title: raw.title,
      state,
      author: raw.user?.login ?? "",
      headSha: raw.head?.sha,
      baseRef: raw.base?.ref,
      updatedAt: raw.updated_at,
    };
  },
  pullFiles({ owner, repo, number }) {
    const out = gh(["api", "--paginate", `repos/${owner}/${repo}/pulls/${number}/files?per_page=100`, "--jq", ".[] | [.filename, .status] | @tsv"]);
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [path = "", status = ""] = l.split("\t");
        return { path, status };
      });
  },
  file(owner, repo, ref, path) {
    try {
      return gh(["api", "-H", "Accept: application/vnd.github.raw+json", `repos/${owner}/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(ref)}`]);
    } catch (e) {
      if (e instanceof GhError && /\(HTTP 404\)/.test(e.message)) return null;
      throw e;
    }
  },
  commit(owner, repo, ref) {
    try {
      return gh(["api", `repos/${owner}/${repo}/commits/${encodeURIComponent(ref)}`, "--jq", ".sha"]).trim() || null;
    } catch (e) {
      if (e instanceof GhError && /\(HTTP 404\)/.test(e.message)) return null;
      throw e;
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Building the feature

export interface FeatureSource {
  readonly role: DocRole;
  readonly link: string;
  /** The pull request, when the link is one. */
  readonly pull: PullRequest | null;
  /** Where the text was read: the head of an open pull request, or the branch a merged one went into. */
  readonly readFrom: RefSource;
  readonly docs: readonly DocPath[];
}

export interface Feature {
  readonly spec: FeatureSpec;
  readonly slug: string;
  readonly sources: readonly FeatureSource[];
  readonly docs: readonly SourceDoc[];
  readonly implementation: readonly PullRequest[];
  readonly linear: { readonly key: string; readonly url: string | null } | null;
  /** Things the reader should know, such as a closed pull request. */
  readonly notes: readonly string[];
}

const IGNORED = /(^|\/)(readme|changelog|contributing|license)[^/]*\.md$/i;

/** The documents a pull request holds for a role: under the role's usual folder, else its only document. */
export function pickDocs(role: DocRole, files: readonly { path: string; status: string }[], link: string): string[] {
  const md = files.filter((f) => f.status !== "removed" && /\.md$/i.test(f.path) && !IGNORED.test(f.path)).map((f) => f.path);
  const prefixes = DEFAULT_CONFIG.docs[ROLE_KIND[role]];
  const inFolder = md.filter((p) => prefixes.some((pre) => p.startsWith(pre) || p.includes(`/${pre}`)));
  if (inFolder.length) return inFolder;
  if (md.length === 1) return md;
  if (md.length === 0) throw new TailsInputError(`${link}: the pull request changes no Markdown document. Link the file instead, or add file: <path>.`);
  throw new TailsInputError(`${link}: the pull request changes several documents (${md.join(", ")}). Say which is the ${ROLE_LABEL[role]} with file: <path>.`);
}

export function buildFeature(spec: FeatureSpec, slug: string, github: GitHub): Feature {
  const sources: FeatureSource[] = [];
  const docs = new Map<string, SourceDoc>();
  const notes: string[] = [];

  for (const role of DOC_ROLES) {
    for (const l of spec.docs[role]) {
      const pr = parsePr(l.link);
      let owner: string, repo: string, ref: string, paths: string[], pull: PullRequest | null = null;
      if (pr) {
        pull = github.pull(pr);
        ({ owner, repo } = pr);
        // A merged document lives on the branch it went into, where later pull requests may have changed it.
        ref = pull.state === "merged" ? pull.baseRef : pull.headSha;
        paths = l.file ? [l.file] : pickDocs(role, github.pullFiles(pr), l.link);
        if (pull.state === "closed") notes.push(`${ROLE_LABEL[role]}: ${pull.repo}#${pull.number} was closed without merging. Tails read it at its last commit.`);
      } else {
        const blob = parseBlob(l.link)!;
        ({ owner, repo } = blob);
        // A branch name can hold slashes: take the shortest ref that has the file.
        const split = Array.from({ length: blob.rest.length - 1 }, (_, k) => ({ ref: blob.rest.slice(0, k + 1).join("/"), path: blob.rest.slice(k + 1).join("/") })).find(
          (s) => github.file(blob.owner, blob.repo, s.ref, l.file ?? s.path) !== null,
        );
        if (!split) throw new TailsInputError(`${l.link}: cannot read this file. Check the link and that \`gh auth status\` can see the repository.`);
        ref = split.ref;
        paths = [l.file ?? split.path];
      }
      const commit = pull && pull.state !== "merged" ? pull.headSha : github.commit(owner, repo, ref);
      if (!commit) throw new TailsInputError(`${l.link}: cannot resolve commit for "${ref}"`);
      const label = pull ? `${owner}/${repo}#${pull.number}` : `${owner}/${repo}@${ref}`;
      const readFrom: RefSource = { ref: label, commit };
      const mine: DocPath[] = [];
      for (const p of paths) {
        if (!/\.md$/i.test(p) || p.split(/[\\/]/).some((part) => part === ".." || part === ".") || p.includes("\0")) {
          throw new TailsInputError(`${l.link}: expected a Markdown document path without . or .. segments, got "${p}"`);
        }
        const text = github.file(owner, repo, commit, p);
        if (text === null) throw new TailsInputError(`${l.link}: ${p} does not exist at ${commit.slice(0, 7)}`);
        const path = `${owner}/${repo}/${p}` as DocPath;
        if (docs.has(path)) {
          notes.push(`${path} is linked more than once; Tails reads it from ${docs.get(path)!.source?.ref}.`);
          continue;
        }
        docs.set(path, { path, kind: ROLE_KIND[role], text, source: readFrom });
        mine.push(path);
      }
      sources.push({ role, link: l.link, pull, readFrom, docs: mine });
    }
  }

  const implementation = spec.implementation.map((u) => github.pull(parsePr(u)!));
  const key = spec.linear ? linearKey(spec.linear) : null;
  return {
    spec,
    slug,
    sources,
    docs: [...docs.values()],
    implementation,
    linear: key ? { key, url: linearUrl(spec.linear!) } : null,
    notes,
  };
}
