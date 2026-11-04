// Skill selection and agent handoff. Skill instructions stay opaque to the CLI.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseConfig, SKILL_ROLES, skillRole, type Config, type SkillRole } from "./config.js";
import { TailsInputError } from "./model.js";
import { toJson } from "./util.js";

const ASSETS = fileURLToPath(new URL("../../", import.meta.url));
const RESULTS: Record<SkillRole, { file: string; schema?: string }> = {
  "spec-review": { file: "result.json", schema: "tails.drift-1.schema.json" },
  "pr-review": { file: "result.md" },
  conformance: { file: "result.json", schema: "tails.verdict-2.schema.json" },
};

interface ResolvedSkill {
  readonly source: {
    readonly role: SkillRole;
    readonly selectedBy: "config" | "project" | "bundled";
    readonly path: string;
    readonly repo?: string;
    readonly ref?: string;
    readonly commit?: string;
    readonly sha256: string;
  };
  readonly content: string;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new TailsInputError(`${path}: cannot read file`);
  }
}

function readSkill(path: string): string {
  const content = readText(path);
  if (!content.trim()) throw new TailsInputError(`${path}: skill file is empty`);
  return content;
}

function git(root: string, args: string[], message: string): string {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 8 << 20 });
  } catch {
    throw new TailsInputError(`${root}: ${message}`);
  }
}

function projectSkill(root: string, role: SkillRole): string {
  return join(root, ".tails", "skills", role, "SKILL.md");
}

function bundledSkill(role: SkillRole): string {
  return join(ASSETS, "skills", role, "SKILL.md");
}

/** The file a path names, through links; the path itself when it cannot be resolved, so the read reports it. */
function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** lstat also sees broken links, so a broken override never silently selects a default. */
function present(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new TailsInputError(`${path}: cannot inspect skill path`);
  }
}

function resolveSkill(root: string, config: Config, role: SkillRole): ResolvedSkill {
  const reference = config.skills[role];
  const local = projectSkill(root, role);
  const selectedBy = reference ? "config" : present(local) ? "project" : "bundled";
  let content: string;
  let path: string;
  let repository: { repo: string; ref: string; commit: string } | undefined;
  if (reference?.repo !== undefined) {
    const checkout = resolve(root, reference.repo);
    const repo = git(checkout, ["rev-parse", "--show-toplevel"], "not a Git checkout").trim();
    const commit = git(repo, ["rev-parse", "--verify", "--end-of-options", `${reference.ref}^{commit}`], `unknown skill ref "${reference.ref}"; fetch it first`).trim();
    path = reference.path.replace(/^(\.\/)+/, "");
    const entry = git(repo, ["ls-tree", commit, "--", path], `cannot inspect skill "${path}" at ${commit}`);
    if (!/^100(?:644|755) blob /.test(entry)) throw new TailsInputError(`${repo}: ${path} must be a regular skill file at ${commit}`);
    content = git(repo, ["show", `${commit}:${path}`], `cannot read skill "${path}" at ${commit}`);
    if (!content.trim()) throw new TailsInputError(`${repo}: ${path} is empty at ${commit}`);
    repository = { repo, ref: reference.ref, commit };
  } else {
    path = reference ? resolve(root, reference.path) : selectedBy === "project" ? local : bundledSkill(role);
    // A shared skill may live outside the project, but .tails.yml comes with the project and its
    // entry file is copied into the handoff: only a Markdown file, checked at a link's target, qualifies.
    if (reference && !/\.md$/i.test(realOrSelf(path))) throw new TailsInputError(`.tails.yml: skills.${role} must be a Markdown (.md) file, got "${reference.path}"`);
    content = readSkill(path);
    path = realpathSync(path);
  }
  return {
    source: { role, selectedBy, path, ...repository, sha256: createHash("sha256").update(content).digest("hex") },
    content,
  };
}

function initSkill(root: string, config: Config, role: SkillRole): string {
  if (config.skills[role]) throw new TailsInputError(`.tails.yml: skills.${role} already selects a skill; edit that source or remove the selection before init`);
  const path = projectSkill(root, role);
  const content = readSkill(bundledSkill(role));
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, content, { flag: "wx" });
  } catch {
    throw new TailsInputError(`${path}: cannot create skill file; an existing file is never replaced`);
  }
  return path;
}

function prepareSkill(root: string, skill: ResolvedSkill, task: string, output: string): void {
  const { source } = skill;
  const result = RESULTS[source.role];
  const schema = result.schema ? readText(join(ASSETS, "schemas", result.schema)) : null;
  const adapter = source.role === "conformance" ? readText(join(ASSETS, "skills/conformance/adapter.md")) : "";
  const resourceNote = source.repo
    ? `The skill comes from Git checkout ${JSON.stringify(source.repo)}, commit ${source.commit}, path ${JSON.stringify(source.path)}.
Resolve relative references from the skill's original directory within that commit.
Read each reference with git show at that commit, rather than from the checkout's working tree.`
    : `Resolve relative references from the original skill directory: ${JSON.stringify(dirname(source.path))}.
The handoff contains a copy of the entry file. Supporting files remain in that original directory.`;
  const contract = schema
    ? `Also write ${JSON.stringify(join(output, result.file))} using result.schema.json in this directory.
Adapt the selected skill's conclusions to that format without changing its assessment rules.
If required context is missing, explain the gap in report.md and request it instead of inventing IDs, commits, or evidence.`
    : `Write the selected skill's review to ${JSON.stringify(join(output, result.file))}.
Include the reviewed base and head, findings with file and line evidence, and any missing context.
This Markdown review is for people. Tails does not turn it into requirement delivery states.`;
  const prompt = `# Tails task: ${source.role}

## Request

${task.trim()}

## Project and skill

The project directory is ${JSON.stringify(root)}. Read its applicable instructions and conventions.
Read skill.md in this handoff directory and use it as the method for this task.
${resourceNote}
Load the references and dependency skills that it requires through your agent's normal skill support.
If a required dependency or plugin capability is unavailable, report that gap rather than claiming a complete review.
The selected skill replaces the bundled method. Do not add the bundled method's rules.

## Results

Write an explanation of the result and any limits to ${JSON.stringify(join(output, "report.md"))}.
${contract}
${adapter}
${source.role === "spec-review" ? 'Use a source name that identifies the selected skill. Cite paths relative to the project and one-based line numbers. Agent findings enter Tails as warnings.\n' : ""}
## Source record

source.json records the selected entry file and its SHA-256 digest.
Only the entry file is copied and hashed. Local supporting files and project files remain live inputs.
This command prepared the task. It did not execute the skill or produce an assessment.
`;
  if (present(output)) throw new TailsInputError(`${output}: output already exists; choose a new --out directory`);
  mkdirSync(dirname(output), { recursive: true });
  try {
    mkdirSync(output);
    const files = { "skill.md": skill.content, "source.json": toJson(source), "prompt.md": prompt, ...(schema ? { "result.schema.json": schema } : {}) };
    for (const [name, content] of Object.entries(files)) writeFileSync(join(output, name), content, { flag: "wx" });
  } catch (e) {
    throw new TailsInputError(`${output}: cannot write skill handoff (${(e as NodeJS.ErrnoException).code ?? "write error"})`);
  }
}

export function skillsCommand(root: string, args: readonly string[], options: { out?: string; task?: string }): void {
  const [action = "list", name, ...rest] = args;
  if (rest.length || !["list", "show", "init", "prepare"].includes(action) || (action === "list" ? name !== undefined : !name)) {
    throw new TailsInputError("use tails skills list, or tails skills show|init|prepare <spec-review|pr-review|conformance>");
  }
  if (action !== "prepare" && (options.out !== undefined || options.task !== undefined)) throw new TailsInputError("--out and --task are only supported by tails skills prepare");
  if (action === "prepare" && !options.task?.trim()) throw new TailsInputError("tails skills prepare needs --task describing the work and its input files or PR");
  if (!present(root) || !statSync(root).isDirectory()) throw new TailsInputError(`${root}: not a project directory`);
  const configPath = join(root, ".tails.yml");
  const config = parseConfig(present(configPath) ? readText(configPath) : null, configPath);
  if (action === "list") {
    const skills = SKILL_ROLES.map((role) => resolveSkill(root, config, role));
    for (const { source } of skills) console.log(`${source.role}\t${source.selectedBy}\t${source.path}${source.commit ? ` @ ${source.commit} (${source.repo})` : ""}`);
    return;
  }
  const role = skillRole(name!);
  if (action === "init") {
    console.log(`tails skills: created ${initSkill(root, config, role)}; edit this file to change the project skill`);
    return;
  }
  const skill = resolveSkill(root, config, role);
  if (action === "show") console.log(skill.content.trimEnd());
  else {
    const output = resolve(options.out ?? `tails-task-${role}`);
    prepareSkill(root, skill, options.task!, output);
    console.log(`tails skills: prepared ${join(output, "prompt.md")}; give this file to your agent`);
  }
}
