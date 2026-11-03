// `.tails.yml` boundary: read once, validate, hand a typed Config to the core.
import { parseYaml } from "./yaml-lite.js";
import { TailsInputError, type DocKind } from "./model.js";

export const SKILL_ROLES = ["spec-review", "pr-review", "conformance"] as const;
export type SkillRole = (typeof SKILL_ROLES)[number];
export type SkillReference =
  | { readonly path: string; readonly repo?: never; readonly ref?: never }
  | { readonly path: string; readonly repo: string; readonly ref: string };

export interface Config {
  /** Directory prefixes per document kind, relative to the repo root. */
  readonly docs: Readonly<Record<DocKind, readonly string[]>>;
  /** Epic override per document path. */
  readonly epics: Readonly<Record<string, string>>;
  /** Explicit skill choices override project-local and bundled defaults. */
  readonly skills: Readonly<Partial<Record<SkillRole, SkillReference>>>;
  readonly drift: {
    /** Extra words a "Not doing" term also matches: `{ sidekiq: ["job dashboard"] }`. */
    readonly aliases: Readonly<Record<string, readonly string[]>>;
    readonly stopWords: readonly string[];
  };
}

export const DEFAULT_CONFIG: Config = {
  docs: { prd: ["prds/"], tdd: ["tdds/"], tcs: ["test-case-specs/"] },
  epics: {},
  skills: {},
  drift: { aliases: {}, stopWords: [] },
};

function fail(file: string, msg: string): never {
  throw new TailsInputError(`${file}: ${msg}`);
}

function stringList(file: string, where: string, v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) fail(file, `${where} must be a string or a list of strings`);
  return v as string[];
}

function record(file: string, where: string, v: unknown): Record<string, unknown> {
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) fail(file, `${where} must be a mapping`);
  return v as Record<string, unknown>;
}

export function skillRole(value: string): SkillRole {
  if (!SKILL_ROLES.includes(value as SkillRole)) throw new TailsInputError(`unknown skill role "${value}"; choose ${SKILL_ROLES.join(", ")}`);
  return value as SkillRole;
}

function skillReferences(file: string, value: unknown): Config["skills"] {
  const skills: Partial<Record<SkillRole, SkillReference>> = {};
  for (const [name, v] of Object.entries(record(file, "skills", value))) {
    if (!SKILL_ROLES.includes(name as SkillRole)) fail(file, `unknown skill role "${name}"; choose ${SKILL_ROLES.join(", ")}`);
    const where = `skills.${name}`;
    const entry = typeof v === "string" ? { path: v } : record(file, where, v);
    for (const k of Object.keys(entry)) if (!["path", "repo", "ref"].includes(k)) fail(file, `${where}: unknown key "${k}"`);
    const nonempty = (key: string): string => {
      const text = entry[key];
      if (typeof text !== "string" || text.trim() === "" || text.includes("\0")) fail(file, `${where}.${key} must be a nonempty string`);
      return text;
    };
    const path = nonempty("path");
    if (entry.repo !== undefined || entry.ref !== undefined) {
      const repo = nonempty("repo");
      const ref = nonempty("ref");
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(repo) || /^[^/]+@[^:]+:/.test(repo)) fail(file, `${where}.repo must be a local Git checkout; clone the repository first`);
      if (path.startsWith("/") || path.split("/").includes("..") || path.includes("\\")) fail(file, `${where}.path must be relative to the Git repository, without .. or backslashes`);
      skills[name as SkillRole] = { path, repo, ref };
    } else skills[name as SkillRole] = { path };
  }
  return skills;
}

export function parseConfig(text: string | null, file = ".tails.yml"): Config {
  if (text === null) return DEFAULT_CONFIG;
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (e) {
    fail(file, `not valid YAML (${(e as Error).message.split("\n")[0]})`);
  }
  const top = record(file, "top level", raw);
  for (const k of Object.keys(top)) if (!["docs", "epics", "drift", "skills"].includes(k)) fail(file, `unknown key "${k}"`);

  const docsRaw = record(file, "docs", top.docs);
  const docs = { ...DEFAULT_CONFIG.docs } as Record<DocKind, readonly string[]>;
  for (const [k, v] of Object.entries(docsRaw)) {
    if (k !== "prd" && k !== "tdd" && k !== "tcs") fail(file, `docs.${k}: kind must be prd, tdd or tcs`);
    docs[k] = stringList(file, `docs.${k}`, v).map((p) => (p.endsWith("/") ? p : p + "/"));
  }

  const epics: Record<string, string> = {};
  for (const [k, v] of Object.entries(record(file, "epics", top.epics))) {
    if (typeof v !== "string" || !/^[A-Z][A-Z0-9]*-\d+$/.test(v)) fail(file, `epics.${k} must be an issue key like ACME-1`);
    epics[k] = v;
  }

  const driftRaw = record(file, "drift", top.drift);
  for (const k of Object.keys(driftRaw)) if (!["aliases", "stop_words"].includes(k)) fail(file, `drift: unknown key "${k}"`);
  const aliases: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(record(file, "drift.aliases", driftRaw.aliases))) {
    aliases[k.toLowerCase()] = stringList(file, `drift.aliases.${k}`, v).map((s) => s.toLowerCase());
  }
  const stopWords = driftRaw.stop_words === undefined ? [] : stringList(file, "drift.stop_words", driftRaw.stop_words).map((s) => s.toLowerCase());

  return { docs, epics, drift: { aliases, stopWords }, skills: skillReferences(file, top.skills) };
}
