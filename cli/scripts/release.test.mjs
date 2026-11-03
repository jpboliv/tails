import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { checksum, publishRelease, releaseTarget, releaseVersion, verifyVersions } from "./release.mjs";

const tag = "v0.1.0";
const sha = "a".repeat(40);
const repo = "example/tails";

function temp(t) {
  const path = mkdtempSync(join(tmpdir(), "tails-release-test-"));
  t.after(() => rmSync(path, { recursive: true, force: true }));
  return path;
}

function fakeGitHub({ draft = true, commit = sha, target = sha, uploadError = false } = {}) {
  const calls = [];
  return {
    calls,
    run(args) {
      calls.push(args);
      if (args[0] === "api") return JSON.stringify({ sha: commit });
      if (args[1] === "view") return JSON.stringify({ tagName: tag, isDraft: draft, targetCommitish: target });
      if (args[1] === "upload" && uploadError) throw new Error("asset upload failed");
      return "";
    },
  };
}

function assets(t) {
  const dir = temp(t);
  const filename = "tails-0.1.0.tgz";
  writeFileSync(join(dir, filename), "the install-tested archive");
  writeFileSync(join(dir, "SHA256SUMS"), `${checksum(join(dir, filename))}  ${filename}\n`);
  return dir;
}

test("release tags reject branch names, prereleases and noncanonical versions", () => {
  assert.equal(releaseVersion(tag), "0.1.0");
  for (const invalid of ["main", "0.1.0", "v01.2.3", "v1.2.3-rc.1", "v1.2.3\n", "v1.2.3\nsha=other", "../v1.2.3"]) {
    assert.throws(() => releaseVersion(invalid), /stable release tag/);
  }
});

test("a release requires the package, both lockfile versions and manifest to match its tag", (t) => {
  const root = temp(t);
  const cli = join(root, "cli");
  mkdirSync(cli);
  const pkg = { version: "0.1.0" };
  const lock = { version: "0.1.0", packages: { "": { version: "0.1.0" } } };
  const write = (file, data) => writeFileSync(file, JSON.stringify(data));
  const reset = () => {
    write(join(cli, "package.json"), pkg);
    write(join(cli, "package-lock.json"), lock);
    write(join(root, ".release-please-manifest.json"), { cli: "0.1.0" });
  };
  reset();
  assert.equal(verifyVersions(tag, cli), "0.1.0");
  for (const [file, data] of [
    [join(cli, "package.json"), { version: "0.2.0" }],
    [join(cli, "package-lock.json"), { ...lock, version: "0.2.0" }],
    [join(cli, "package-lock.json"), { ...lock, packages: { "": { version: "0.2.0" } } }],
    [join(root, ".release-please-manifest.json"), {}],
  ]) {
    reset();
    write(file, data);
    assert.throws(() => verifyVersions(tag, cli), /must match v0.1.0/);
  }
});

test("draft recovery resolves the tagged commit instead of the current main", () => {
  const github = fakeGitHub();
  assert.deepEqual(releaseTarget(repo, tag, "", github.run), { tag, sha });
  assert.deepEqual(github.calls[1], ["api", `repos/${repo}/commits/${tag}`]);
  assert.throws(() => releaseTarget(repo, tag, "", fakeGitHub({ target: "main" }).run), /draft target/);
});

test("a moved tag is rejected before release assets can be changed", (t) => {
  const moved = "b".repeat(40);
  const github = fakeGitHub({ commit: moved, target: moved });
  assert.throws(() => publishRelease({ repo, tag, sha, assets: assets(t) }, github.run), /tag moved/);
  assert.ok(github.calls.every((args) => args[1] !== "upload" && args[1] !== "edit"));
});

test("publication uploads the archive and checksum before publishing the draft", (t) => {
  const github = fakeGitHub();
  const dir = assets(t);
  assert.equal(publishRelease({ repo, tag, sha, assets: dir }, github.run), true);
  assert.deepEqual(github.calls.slice(-2), [
    ["release", "upload", tag, join(dir, "tails-0.1.0.tgz"), join(dir, "SHA256SUMS"), "--repo", repo, "--clobber"],
    ["release", "edit", tag, "--repo", repo, "--draft=false"],
  ]);
});

test("a failed asset upload leaves the release unpublished and can be retried", (t) => {
  const options = { repo, tag, sha, assets: assets(t) };
  const failed = fakeGitHub({ uploadError: true });
  assert.throws(() => publishRelease(options, failed.run), /asset upload failed/);
  assert.ok(failed.calls.every((args) => args[1] !== "edit"));
  assert.equal(publishRelease(options, fakeGitHub().run), true);
});

test("a changed archive cannot be uploaded with an old checksum", (t) => {
  const dir = assets(t);
  writeFileSync(join(dir, "tails-0.1.0.tgz"), "changed archive");
  const github = fakeGitHub();
  assert.throws(() => publishRelease({ repo, tag, sha, assets: dir }, github.run), /checksum does not match/);
  assert.ok(github.calls.every((args) => args[1] !== "upload" && args[1] !== "edit"));
});

test("retrying a published release never replaces its assets", () => {
  const github = fakeGitHub({ draft: false });
  assert.equal(publishRelease({ repo, tag, sha, assets: "unused" }, github.run), false);
  assert.equal(github.calls.length, 1);
});

test("GitHub failures stop release preparation instead of being treated as no release", () => {
  assert.throws(() => releaseTarget(repo, tag, sha, () => { throw new Error("HTTP 403"); }), /HTTP 403/);
});
