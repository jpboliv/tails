import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { serve } from "../src/serve.js";
import { cli, tmp } from "./helpers.js";

test("serve answers site pages over http and refuses paths outside the site", async () => {
  const root = tmp();
  const site = join(root, "site");
  mkdirSync(join(site, "prds"), { recursive: true });
  writeFileSync(join(site, "index.html"), "<h1>home</h1>");
  writeFileSync(join(site, "prds", "a.html"), "<h1>a</h1>");
  writeFileSync(join(root, "secret.txt"), "no");
  symlinkSync(join(root, "secret.txt"), join(site, "leak.txt"));
  symlinkSync(root, join(site, "outside"), "dir");
  symlinkSync(join(root, "missing.txt"), join(site, "broken.txt"));
  const server = await serve(site, 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const home = await fetch(`${base}/`);
    assert.equal(home.status, 200);
    assert.match(home.headers.get("content-type") ?? "", /text\/html/);
    assert.equal(await home.text(), "<h1>home</h1>");
    assert.equal(await (await fetch(`${base}/prds/a.html#FR-1`)).text(), "<h1>a</h1>");
    assert.equal((await fetch(`${base}/%2e%2e/secret.txt`)).status, 404);
    assert.equal((await fetch(`${base}/missing.html`)).status, 404);
    for (const path of ["leak.txt", "outside/secret.txt", "broken.txt", "%00"]) {
      assert.equal((await fetch(`${base}/${path}`)).status, 404, path);
    }
    assert.equal((await fetch(base)).status, 200, "bad requests do not stop the server");
  } finally {
    server.close();
  }
});

test("serve on a missing directory is an input error", () => {
  const r = cli("serve", join(tmp(), "nope"), "--port", "0");
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not a directory/);
  assert.equal(cli("serve", "--port", "http").code, 2);
});
