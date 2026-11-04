// The user can replace a method without losing its source, references, or output contract.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { cli, copyFixture, git, gitFixture, read, snapshot, tmp } from "./helpers.js";

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function prepare(repo: string, role = "spec-review", out = join(tmp(), "task")) {
  return { ...cli("skills", "prepare", role, "--repo", repo, "--task", "Review the supplied project against its rules.", "--out", out), out };
}

test("skills work before specs exist, with absent or empty configuration", () => {
  const repo = tmp();
  for (const content of [null, "", "# use defaults\n"]) {
    if (content !== null) write(join(repo, ".tails.yml"), content);
    const result = cli("skills", "--repo", repo);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.split("\n").length, 3);
    assert.match(result.stdout, /spec-review\tbundled/);
    assert.match(cli("skills", "show", "pr-review", "--repo", repo).stdout, /name: tails-pr-review/);
  }
});

test("init makes an editable project skill and never replaces user edits", () => {
  const repo = tmp();
  const path = join(repo, ".tails/skills/spec-review/SKILL.md");
  assert.equal(cli("skills", "init", "spec-review", "--repo", repo).code, 0);
  assert.match(read(path), /name: tails-spec-review/);
  write(path, "# Our review\nUse our accounting rules.\n");
  assert.equal(cli("skills", "show", "spec-review", "--repo", repo).stdout, "# Our review\nUse our accounting rules.");
  assert.equal(cli("skills", "init", "spec-review", "--repo", repo).code, 2);
  assert.match(read(path), /Our review/);
  assert.match(cli("skills", "list", "--repo", repo).stdout, /spec-review\tproject/);
});

test("an explicit shared skill replaces the local and bundled methods, without modifying its library", () => {
  const repo = tmp();
  const library = join(tmp(), "shared skills");
  const entry = join(library, "SKILL.md");
  const content = "---\nname: team-review\n---\nRead references/rules.md.\n";
  write(entry, content);
  write(join(library, "references/rules.md"), "Follow the team's rule.\n");
  write(join(repo, ".tails/skills/spec-review/SKILL.md"), "Local method that must not be merged.\n");
  write(join(repo, ".tails.yml"), `skills:\n  spec-review: "${relative(repo, entry)}"\n`);
  const before = snapshot(library);
  const result = prepare(repo);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(read(join(result.out, "skill.md")), content);
  const source = JSON.parse(read(join(result.out, "source.json")));
  assert.equal(source.selectedBy, "config");
  assert.equal(source.path, entry);
  assert.equal(source.sha256, createHash("sha256").update(content).digest("hex"));
  const prompt = read(join(result.out, "prompt.md"));
  assert.ok(prompt.includes(JSON.stringify(library)), "references stay relative to the original source");
  assert.doesNotMatch(prompt, /Local method that must not be merged/);
  assert.deepEqual(snapshot(library), before);
  assert.equal(cli("skills", "init", "spec-review", "--repo", repo).code, 2, "do not create an ignored local override");
});

test("local symlink skills keep their real resource directory", () => {
  const repo = tmp();
  const source = join(tmp(), "skill/SKILL.md");
  write(source, "Read references/rules.md.\n");
  symlinkSync(source, join(repo, "selected.md"));
  write(join(repo, ".tails.yml"), "skills:\n  pr-review:\n    path: selected.md\n");
  const result = prepare(repo, "pr-review");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(read(join(result.out, "source.json"))).path, source);
});

test("Git skills read the selected commit, record it, and keep resources on that commit", () => {
  const library = gitFixture("acme");
  const path = "plugins/review/skills/review/SKILL.md";
  write(join(library, path), "# Original method\nRead ../../references/rules.md.\n");
  write(join(library, "plugins/review/references/rules.md"), "Original rule.\n");
  git(library, "add", "-A");
  git(library, "commit", "-qm", "add shared skill");
  const commit = git(library, "rev-parse", "HEAD");
  git(library, "tag", "v1");
  write(join(library, path), "Working tree method that must not be read.\n");
  const repo = tmp();
  write(join(repo, ".tails.yml"), `skills:\n  spec-review:\n    repo: "${relative(repo, library)}"\n    ref: v1\n    path: ${path}\n`);
  const result = prepare(repo);
  assert.equal(result.code, 0, result.stderr);
  assert.match(read(join(result.out, "skill.md")), /Original method/);
  const source = JSON.parse(read(join(result.out, "source.json")));
  assert.equal(source.commit, commit);
  assert.equal(source.path, path);
  assert.equal(source.repo, library);
  assert.equal(source.ref, "v1");
  assert.match(read(join(result.out, "prompt.md")), new RegExp(`commit ${commit}`));
  assert.match(read(join(result.out, "prompt.md")), /git show at that commit/);
  const another = prepare(repo);
  assert.equal(read(join(another.out, "source.json")), read(join(result.out, "source.json")));
});

test("a broken selected skill fails visibly instead of falling back", () => {
  const repo = tmp();
  write(join(repo, ".tails.yml"), "skills:\n  conformance: missing.md\n");
  const missing = prepare(repo, "conformance");
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /missing\.md: cannot read file/);
  write(join(repo, "missing.md"), "  \n");
  assert.match(prepare(repo, "conformance").stderr, /skill file is empty/);
  write(join(repo, ".tails.yml"), "");
  const local = join(repo, ".tails/skills/spec-review/SKILL.md");
  mkdirSync(dirname(local), { recursive: true });
  symlinkSync(join(repo, "absent.md"), local);
  assert.equal(prepare(repo).code, 2, "a broken project symlink is not an absent override");
});

test("Git references require an available commit and a regular entry file", () => {
  const repo = tmp();
  const library = gitFixture("acme");
  for (const [ref, path, expected] of [
    ["missing-ref", "prds/ACME-1-export.md", /unknown skill ref/],
    ["HEAD", "missing.md", /regular skill file/],
    ["HEAD", "prds", /regular skill file/],
  ] as const) {
    write(join(repo, ".tails.yml"), `skills:\n  spec-review:\n    repo: ${library}\n    ref: ${ref}\n    path: ${path}\n`);
    const result = prepare(repo);
    assert.equal(result.code, 2);
    assert.match(result.stderr, expected);
  }
});

test("invalid skill configuration names the offending choice", () => {
  const repo = tmp();
  for (const [body, expected] of [
    ["  typo: some.md", /unknown skill role "typo"/],
    ["  spec-review:\n    path: some.md\n    unknown: value", /unknown key "unknown"/],
    ["  spec-review:\n    path: ''", /path must be a nonempty string/],
    ["  spec-review:\n    path: some.md\n    ref: main", /repo must be a nonempty string/],
    ["  spec-review:\n    path: some.md\n    repo: ../skills", /ref must be a nonempty string/],
    ["  spec-review:\n    path: ../outside.md\n    repo: ../skills\n    ref: main", /path must be relative/],
    ["  spec-review:\n    path: SKILL.md\n    repo: https://example.invalid/skills.git\n    ref: main", /clone the repository first/],
  ] as const) {
    write(join(repo, ".tails.yml"), `skills:\n${body}\n`);
    const result = cli("skills", "list", "--repo", repo);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /\.tails\.yml:/);
    assert.match(result.stderr, expected);
  }
});

test("handoffs use the role's output contract and never invent an assessment", () => {
  const repo = tmp();
  for (const [role, schema] of [["spec-review", "tails.drift/1"], ["conformance", "tails.verdict/2"], ["pr-review", null]] as const) {
    const result = prepare(repo, role);
    assert.equal(result.code, 0, result.stderr);
    const files = snapshot(result.out);
    assert.deepEqual([...files.keys()].sort(), ["prompt.md", "skill.md", "source.json", ...(schema ? ["result.schema.json"] : [])].sort());
    if (schema) assert.equal(JSON.parse(files.get("result.schema.json")!).$id, schema);
    assert.match(files.get("prompt.md")!, /Review the supplied project against its rules/);
    const again = prepare(repo, role, result.out);
    assert.equal(again.code, 2);
    assert.match(again.stderr, /output already exists/);
    assert.deepEqual(snapshot(result.out), files);
  }
});

test("skill selection does not require skill access for deterministic reports", () => {
  const repo = copyFixture("acme");
  write(join(repo, ".tails.yml"), `${read(join(repo, ".tails.yml"))}\nskills:\n  pr-review: /unavailable/on-this-machine/SKILL.md\n`);
  const out = tmp();
  assert.equal(cli("report", "--repo", repo, "--out", out).code, 0);
  assert.match(read(join(out, "drift.md")), /FR-1\.2/);
});

test("skills reject missing tasks, ambiguous actions, and unsupported flags", () => {
  const repo = tmp();
  for (const args of [
    ["prepare", "spec-review"], ["show"], ["show", "unknown"], ["list", "spec-review"],
    ["run", "spec-review"], ["show", "spec-review", "extra"], ["list", "--ref", "HEAD"],
    ["init", "spec-review", "--out", "elsewhere"],
  ]) assert.equal(cli("skills", ...args, "--repo", repo).code, 2, args.join(" "));
});

test("a selected local skill must be a Markdown file, so configuration cannot copy other files into a handoff", () => {
  const repo = tmp();
  const secret = join(tmp(), "credentials");
  write(secret, "[default]\naws_secret_access_key = do-not-copy\n");
  for (const path of [secret, relative(repo, secret)]) {
    write(join(repo, ".tails.yml"), `skills:\n  spec-review: "${path}"\n`);
    const result = prepare(repo);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /must be a Markdown \(\.md\) file/);
  }
  symlinkSync(secret, join(repo, "skill.md"));
  write(join(repo, ".tails.yml"), "skills:\n  spec-review: skill.md\n");
  const linked = prepare(repo);
  assert.equal(linked.code, 2, "a .md link to another file is checked at its target");
  assert.doesNotMatch(linked.stdout + linked.stderr, /do-not-copy/);
});
