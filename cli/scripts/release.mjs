// Release helpers used by Actions. The CLI runtime does not import this file.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const json = (file) => JSON.parse(readFileSync(file, "utf8"));
const gh = (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

export function releaseVersion(tag) {
  assert.match(tag, /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, "expected a stable release tag such as v0.1.0");
  assert.equal(tag, tag.trim(), "expected a stable release tag without whitespace");
  return tag.slice(1);
}

export function verifyVersions(tag, cli = root) {
  const version = releaseVersion(tag);
  const pkg = json(join(cli, "package.json"));
  const lock = json(join(cli, "package-lock.json"));
  const manifest = json(join(cli, "..", ".release-please-manifest.json"));
  for (const [file, actual] of [
    ["package.json", pkg.version],
    ["package-lock.json", lock.version],
    ["package-lock.json packages[\"\"]", lock.packages?.[""]?.version],
    [".release-please-manifest.json cli", manifest.cli],
  ]) assert.equal(actual, version, `${file} must match ${tag}`);
  return version;
}

export const checksum = (archive) => createHash("sha256").update(readFileSync(archive)).digest("hex");

// Resolve tags through GitHub, including annotated tags. A draft must pin its
// target commit, so retrying later cannot accidentally release a newer main.
export function releaseTarget(repo, tag, expectedSha = "", run = gh) {
  releaseVersion(tag);
  const release = JSON.parse(run(["release", "view", tag, "--repo", repo, "--json", "tagName,isDraft,targetCommitish"]));
  assert.equal(release.tagName, tag, "release tag does not match the request");
  if (!release.isDraft) return null;
  const { sha } = JSON.parse(run(["api", `repos/${repo}/commits/${tag}`]));
  assert.match(sha, /^[0-9a-f]{40}$/, "release tag must resolve to a commit SHA");
  assert.equal(release.targetCommitish, sha, "draft target must match the tagged commit SHA");
  if (expectedSha) assert.equal(sha, expectedSha, "release tag moved since validation");
  return { tag, sha };
}

export function publishRelease({ repo, tag, sha, assets }, run = gh) {
  assert.match(sha, /^[0-9a-f]{40}$/, "a validated release commit is required");
  const target = releaseTarget(repo, tag, sha, run);
  if (!target) return false; // Published versions are never replaced by a retry.
  const filename = `tails-${releaseVersion(tag)}.tgz`;
  const archive = join(assets, filename);
  const sums = join(assets, "SHA256SUMS");
  assert.equal(readFileSync(sums, "utf8"), `${checksum(archive)}  ${filename}\n`, "release archive checksum does not match");
  run(["release", "upload", tag, archive, sums, "--repo", repo, "--clobber"]);
  // Only the draft's assets can be replaced. Publication happens after both uploads.
  run(["release", "edit", tag, "--repo", repo, "--draft=false"]);
  return true;
}

function main() {
  const [command, tag] = process.argv.slice(2);
  if (command === "verify") {
    verifyVersions(tag);
  } else if (command === "prepare") {
    const { GITHUB_REPOSITORY: repo, RELEASE_TAG: requested, RELEASE_SHA: sha, GITHUB_OUTPUT: output } = process.env;
    if (!requested) return console.log("No release is ready; Release Please will maintain the release PR.");
    const target = releaseTarget(repo, requested, sha);
    if (!target) return console.log(`${requested} is already published; leaving it unchanged.`);
    appendFileSync(output, `tag=${target.tag}\nsha=${target.sha}\n`);
  } else if (command === "publish") {
    const { GITHUB_REPOSITORY: repo, RELEASE_TAG: tag, RELEASE_SHA: sha, RELEASE_ASSETS: assets } = process.env;
    verifyVersions(tag);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
    assert.equal(head, sha, "checkout must match the validated release commit");
    console.log(publishRelease({ repo, tag, sha, assets }) ? `Published ${tag}.` : `${tag} is already published; leaving it unchanged.`);
  } else {
    throw new Error("Usage: release.mjs prepare | verify <tag> | publish");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
