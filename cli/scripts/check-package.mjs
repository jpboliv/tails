// Exercise the installable artifact outside the checkout, including its bundled assets.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { checksum, verifyVersions } from "./release.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({ options: { out: { type: "string" }, tag: { type: "string" } } });
if (values.tag) verifyVersions(values.tag);
const output = values.out ? resolve(values.out) : null;
const temp = mkdtempSync(join(tmpdir(), "tails-package-"));
const npm = (args, cwd = temp) => execFileSync("npm", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
try {
  const [pack] = JSON.parse(npm(["pack", "--json", "--pack-destination", temp], root));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pack.name, "tails");
  assert.equal(pack.version, pkg.version);
  assert.equal(pack.filename, `tails-${pkg.version}.tgz`);
  const files = pack.files.map((f) => f.path);
  const compiled = readdirSync(join(root, "src")).filter((f) => f.endsWith(".ts")).map((f) => `dist/src/${f.replace(/\.ts$/, ".js")}`);
  assert.deepEqual(files.filter((f) => f.startsWith("dist/")).sort(), compiled.sort(), "the artifact contains only current runtime modules");
  assert.ok(files.every((f) => /^(dist\/src\/|schemas\/|skills\/[^/]+\/(?:SKILL|adapter)\.md$|examples\/feature-flags\/|README\.md$|package\.json$)/.test(f)), "development files are excluded");
  const prefix = join(temp, "installed");
  npm(["install", "--global", "--prefix", prefix, "--ignore-scripts", "--no-audit", "--no-fund", join(temp, pack.filename)]);
  const bin = join(prefix, "bin", "tails");
  const tails = (...args) => execFileSync(bin, args, { cwd: temp, encoding: "utf8" });
  assert.match(tails("--help"), /tails feature/);
  assert.match(tails("skills", "list"), /conformance\s+bundled/);
  for (const role of ["spec-review", "pr-review", "conformance"]) {
    const out = join(temp, role);
    tails("skills", "prepare", role, "--task", "Inspect the sample specs", "--out", out);
    assert.ok(existsSync(join(out, "skill.md")));
    if (role !== "pr-review") assert.ok(existsSync(join(out, "result.schema.json")));
    if (role === "conformance") {
      assert.equal(JSON.parse(readFileSync(join(out, "result.schema.json"), "utf8")).$id, "tails.verdict/2");
      assert.match(readFileSync(join(out, "prompt.md"), "utf8"), /Structured assessment handoff/);
    }
  }
  const installed = join(prefix, "lib", "node_modules", "tails");
  assert.equal(JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).version, pkg.version);
  const out = join(temp, "report");
  tails("report", "--repo", join(installed, "examples", "feature-flags"), "--out", out);
  const report = JSON.parse(readFileSync(join(out, "drift.json"), "utf8"));
  assert.ok(report.findings.some((f) => f.severity === "fail"));
  assert.ok(existsSync(join(out, "site", "index.html")));
  if (output) {
    mkdirSync(output, { recursive: true });
    const archive = join(output, pack.filename);
    copyFileSync(join(temp, pack.filename), archive, constants.COPYFILE_EXCL);
    writeFileSync(join(output, "SHA256SUMS"), `${checksum(archive)}  ${pack.filename}\n`, { flag: "wx" });
    console.log(`Release assets saved in ${output}.`);
  }
  console.log(`Package verified: ${pack.filename}, ${files.length} files, ${pack.size} bytes; global CLI, reports and all skill handoffs work.`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
