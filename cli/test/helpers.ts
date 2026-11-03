// Test helpers: run the CLI in-process and capture what a user would see.
import { cpSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { run } from "../src/cli.js";

/** Fixtures stay in test/fixtures; tests run from dist/test. */
export const FIXTURES = fileURLToPath(new URL("../../test/fixtures/", import.meta.url));
export const fixture = (name: string): string => join(FIXTURES, name);

/** A fresh directory, by its real path: on macOS the temp dir /var/… is a link to /private/var/…, and tails reports real paths. */
export function tmp(prefix = "tails-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export interface CliResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export function cli(...argv: string[]): CliResult {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  try {
    const code = run(argv);
    if (typeof code !== "number") throw new Error(`tails ${argv[0]} is async; call its command function directly`);
    return { code, stdout: out.join("\n"), stderr: err.join("\n") };
  } finally {
    console.log = log;
    console.error = error;
  }
}

export const read = (path: string): string => readFileSync(path, "utf8");

/** Every file under dir, relative path to content, for byte-for-byte comparison. */
export function snapshot(dir: string, rel = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(join(dir, rel)).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(join(dir, r)).isDirectory()) for (const [k, v] of snapshot(dir, r)) out.set(k, v);
    else out.set(r, read(join(dir, r)));
  }
  return out;
}

/** `tails report` on a repo; returns its site, page path to HTML. */
export function siteOf(repo: string): Map<string, string> {
  const out = tmp();
  const r = cli("report", "--repo", repo, "--out", out);
  if (r.code === 2) throw new Error(r.stderr);
  return snapshot(join(out, "site"));
}

/** A copy of a fixture in a fresh directory, so a test can edit it. */
export function copyFixture(name: string): string {
  const dir = tmp();
  cpSync(fixture(name), dir, { recursive: true });
  return dir;
}

export function edit(path: string, from: string, to: string): void {
  const text = read(path);
  if (!text.includes(from)) throw new Error(`${path} does not contain ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
}

export function git(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, "-c", "user.name=tails", "-c", "user.email=tails@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    encoding: "utf8",
  }).trim();
}

/** A git repo holding a copy of a fixture as its first commit. */
export function gitFixture(name: string): string {
  const dir = copyFixture(name);
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "spec");
  return dir;
}
