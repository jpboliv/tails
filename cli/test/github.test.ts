import assert from "node:assert/strict";
import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { githubCli } from "../src/feature.js";
import { tmp } from "./helpers.js";

test("GitHub reads use github.com and preserve API failures other than missing files", (t) => {
  const bin = tmp();
  const file = join(bin, "gh");
  writeFileSync(file, `#!${process.execPath}
const args = process.argv.slice(2);
if (args[1] !== '--hostname' || args[2] !== 'github.com') process.exit(3);
const status = process.env.TAILS_TEST_STATUS;
if (status !== '200') {
  console.error('gh: request failed (HTTP ' + status + ')');
  process.exit(1);
}
console.log(args.includes('--jq') ? 'abc123' : '# Document');
`);
  chmodSync(file, 0o755);
  const saved = { PATH: process.env.PATH, GH_HOST: process.env.GH_HOST, TAILS_TEST_STATUS: process.env.TAILS_TEST_STATUS };
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.PATH = bin + delimiter + process.env.PATH;
  process.env.GH_HOST = "enterprise.example";
  process.env.TAILS_TEST_STATUS = "200";
  assert.equal(githubCli.file("acme", "docs", "main", "a.md"), "# Document\n");
  assert.equal(githubCli.commit("acme", "docs", "main"), "abc123");
  process.env.TAILS_TEST_STATUS = "404";
  assert.equal(githubCli.file("acme", "docs", "main", "a.md"), null);
  for (const status of ["403", "429", "500"]) {
    process.env.TAILS_TEST_STATUS = status;
    assert.throws(() => githubCli.file("acme", "docs", "main", "a.md"), new RegExp(`HTTP ${status}`));
    assert.throws(() => githubCli.commit("acme", "docs", "main"), new RegExp(`HTTP ${status}`));
  }
});
