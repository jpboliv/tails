// Repository boundary: read spec documents from the working tree, a git ref, or several refs merged.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { Config } from "./config.js";
import type { SourceDoc } from "./indexer.js";
import { compareBy } from "./util.js";
import { TailsInputError, type DocKind, type DocPath, type RefSource } from "./model.js";

export interface Git {
  /** Last commit at or before `ref` that touched `path`, or null. */
  lastCommit(path: string): string | null;
  /** File content at a commit, or null when the file did not exist there. */
  show(commit: string, path: string): string | null;
}

export interface Repo {
  /** The single commit read, or null for the working tree or several refs. */
  readonly commit: string | null;
  /** Every ref read, in the order given. Empty for the working tree. */
  readonly refs: readonly RefSource[];
  readonly git: Git | null;
  list(): string[];
  read(path: string): string | null;
  /** The ref a path is read from, when reading refs. */
  sourceOf(path: string): RefSource | undefined;
  /** Paths that more than one ref holds with different content: the later ref wins. */
  readonly shadowed: readonly { readonly path: string; readonly refs: readonly string[] }[];
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
  } catch {
    return null;
  }
}

function gitFor(root: string, refOf: (path: string) => string): Git {
  return {
    lastCommit: (path) => git(root, ["log", "-1", "--format=%H", refOf(path), "--", path])?.trim() || null,
    show: (commit, path) => git(root, ["show", `${commit}:./${path}`]),
  };
}

function resolveRef(root: string, ref: string): RefSource {
  const commit = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])?.trim();
  if (!commit) throw new TailsInputError(`${root}: unknown ref "${ref}". For a PR head, fetch it first: git fetch origin 'refs/pull/*/head:refs/remotes/origin/pr/*'`);
  return { ref, commit };
}

/**
 * Several refs read as one tree. Spec PRs usually add their own files, so the union is
 * what the spec will look like once they all merge. A later ref wins a path both hold.
 */
function openRefs(root: string, refs: readonly string[]): Repo {
  const sources = refs.map((r) => resolveRef(root, r));
  const owner = new Map<string, RefSource>();
  const holders = new Map<string, { src: RefSource; blob: string }[]>();
  for (const src of sources) {
    // Each entry is "<mode> <type> <blob>\t<path>"; -z keeps paths unquoted.
    for (const line of (git(root, ["ls-tree", "-r", "-z", src.commit, "."]) ?? "").split("\0").filter(Boolean)) {
      const [meta = "", path = ""] = line.split("\t");
      owner.set(path, src);
      holders.set(path, [...(holders.get(path) ?? []), { src, blob: meta.split(" ")[2]! }]);
    }
  }
  const shadowed = [...holders]
    .filter(([, hs]) => hs.length > 1 && new Set(hs.map((h) => h.blob)).size > 1)
    .map(([path, hs]) => ({ path, refs: hs.map((h) => h.src.ref) }))
    .sort(compareBy((x) => x.path));
  return {
    commit: sources.length === 1 ? sources[0]!.commit : null,
    refs: sources,
    git: gitFor(root, (path) => owner.get(path)?.commit ?? sources[sources.length - 1]!.commit),
    list: () => [...owner.keys()].sort(),
    read: (path) => {
      const src = owner.get(path);
      return src ? git(root, ["show", `${src.commit}:./${path}`]) : null;
    },
    sourceOf: (path) => owner.get(path),
    shadowed,
  };
}

function walk(root: string, dir: string, out: string[]): void {
  const abs = join(root, dir);
  if (!existsSync(abs)) return;
  for (const entry of readdirSync(abs, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const name = entry.name;
    if (name === ".git" || name === "node_modules" || entry.isSymbolicLink()) continue;
    const rel = dir === "" ? name : posix.join(dir, name);
    if (entry.isDirectory()) walk(root, rel, out);
    else if (entry.isFile()) out.push(rel);
  }
}

export function openRepo(root: string, refs: readonly string[] = []): Repo {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new TailsInputError(`${root}: not a directory`);
  const inGit = git(root, ["rev-parse", "--is-inside-work-tree"])?.trim() === "true";
  if (refs.length > 0) {
    if (!inGit) throw new TailsInputError(`${root}: --ref needs a git repository`);
    return openRefs(root, refs);
  }
  const head = inGit ? git(root, ["rev-parse", "HEAD"])?.trim() ?? null : null;
  return {
    commit: null,
    refs: [],
    git: inGit && head ? gitFor(root, () => "HEAD") : null,
    list: () => {
      const out: string[] = [];
      walk(root, "", out);
      return out.sort();
    },
    read: (path) => (existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null),
    sourceOf: () => undefined,
    shadowed: [],
  };
}

function kindOf(path: string, config: Config): DocKind | null {
  for (const kind of ["prd", "tdd", "tcs"] as const) {
    if (config.docs[kind].some((prefix) => path.startsWith(prefix))) return kind;
  }
  return null;
}

export function loadSources(repo: Repo, config: Config): SourceDoc[] {
  const out: SourceDoc[] = [];
  for (const path of repo.list()) {
    if (!/\.md$/i.test(path) || /(^|\/)README\.md$/i.test(path)) continue;
    const kind = kindOf(path, config);
    if (!kind) continue;
    const text = repo.read(path);
    const source = repo.refs.length > 1 ? repo.sourceOf(path) : undefined;
    if (text !== null) out.push({ path: path as DocPath, kind, text, ...(source ? { source } : {}) });
  }
  return out;
}
