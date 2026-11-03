// Exercise the generated report in a real browser: layout and native anchor scrolling matter.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { DEFAULT_CONFIG } from "../dist/src/config.js";
import { buildIndex } from "../dist/src/indexer.js";
import { renderSite } from "../dist/src/site.js";

const pages = new Map();
function addSite(name, docs) {
  for (const [path, html] of renderSite(buildIndex(docs, DEFAULT_CONFIG), docs, [])) pages.set(`/${name}/${path}`, html);
}
const docs = Object.entries({ prds: "prd", tdds: "tdd", "test-case-specs": "tcs" }).flatMap(([dir, kind]) =>
  readdirSync(new URL(`../examples/feature-flags/${dir}/`, import.meta.url)).map((file) => ({
    path: `${dir}/${file}`, kind, text: readFileSync(new URL(`../examples/feature-flags/${dir}/${file}`, import.meta.url), "utf8"),
  })),
);
addSite("flags", docs);
addSite("folded", [{ path: "tdds/guide.md", kind: "tdd", text: `# Reading guide

## Before the guide

${"An introductory paragraph.\n\n".repeat(25)}
## How to read the contracts

### Folded explanation

Notes for the agent.

## After the guide

${"An explanatory paragraph.\n\n".repeat(25)}
` }]);

let browser, server, base;
before(async () => {
  browser = await chromium.launch();
  server = createServer((req, res) => {
    const html = pages.get(new URL(req.url, "http://localhost").pathname);
    res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" }).end(html ?? "Not found");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
});

const tdd = "/flags/tdds/FF-2-feature-flags.html";
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const active = (page, nav = ".docnav") => page.locator(`${nav} a[aria-current="location"]`).evaluateAll((links) => links.map((a) => a.getAttribute("href")));
async function withPage(run, viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try { await run(page); assert.deepEqual(errors, []); } finally { await page.close(); }
}
async function clickSection(page, id, nav = ".docnav") {
  await page.locator(`${nav} a[href="#${id}"]`).click();
  await settle(page);
  assert.deepEqual(await active(page, nav), [`#${id}`]);
}

test("every document section stays selected after clicking, in both views and viewport heights", async () => {
  await withPage(async (page) => {
    const failures = [];
    for (const height of [1000, 720]) {
      await page.setViewportSize({ width: 1440, height });
      for (const doc of docs) for (const view of ["html", "source.html"]) {
        const path = `/flags/${doc.path.replace(/\.md$/, `.${view}`)}`;
        await page.goto(base + path);
        const links = await page.locator(".docnav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
        for (const href of links) {
          await page.locator(`.docnav a[href="${href}"]`).click();
          await settle(page);
          const selected = await active(page);
          if (selected.length !== 1 || selected[0] !== href) failures.push({ path, height, clicked: href, selected });
        }
      }
    }
    assert.deepEqual(failures, []);
  });
});

test("repeated clicks, direct links and Back/Forward update selection without a scroll", async () => {
  await withPage(async (page) => {
    await page.goto(base + tdd + "#31-create-a-flag");
    await settle(page);
    assert.deepEqual(await active(page), ["#31-create-a-flag"]);
    const y = await page.evaluate(() => scrollY);
    await clickSection(page, "32-read-a-flag");
    assert.equal(await page.evaluate(() => scrollY), y);
    await clickSection(page, "32-read-a-flag");
    await page.goBack();
    await settle(page);
    assert.deepEqual(await active(page), ["#31-create-a-flag"]);
    await page.goForward();
    await settle(page);
    assert.deepEqual(await active(page), ["#32-read-a-flag"]);
  });
});

test("a short document starts at its title rather than highlighting its last section", async () => {
  await withPage(async (page) => {
    await page.goto(base + "/flags/prds/FF-1-feature-flags.source.html");
    await settle(page);
    assert.deepEqual(await active(page), ["#L1"]);
  });
});

test("scrolling resumes section tracking, and clicking the same hash selects it again", async () => {
  await withPage(async (page) => {
    await page.goto(base + tdd);
    await clickSection(page, "33-record-changes");
    await page.evaluate(() => document.getElementById("1-overview").scrollIntoView());
    await settle(page);
    assert.deepEqual(await active(page), ["#1-overview"]);
    await clickSection(page, "33-record-changes");
  });
});

test("Rendered/Source switches preserve the selected section and source-line links", async () => {
  await withPage(async (page) => {
    await page.goto(base + tdd + "#31-create-a-flag");
    await settle(page);
    await page.getByRole("navigation", { name: "View", exact: true }).getByRole("link", { name: "Source", exact: true }).click();
    await settle(page);
    assert.deepEqual(await active(page), ["#L19"]);
    assert.equal(await page.evaluate(() => !!document.getElementById(decodeURIComponent(location.hash.slice(1)))), true);
    await page.getByRole("navigation", { name: "View", exact: true }).getByRole("link", { name: "Rendered", exact: true }).click();
    await settle(page);
    assert.deepEqual(await active(page), ["#31-create-a-flag"]);
    assert.equal(await page.evaluate(() => !!document.getElementById(decodeURIComponent(location.hash.slice(1)))), true);
  });
});

test("keyboard activation selects the section", async () => {
  await withPage(async (page) => {
    await page.goto(base + tdd);
    await page.locator('.docnav a[href="#32-read-a-flag"]').focus();
    await page.keyboard.press("Enter");
    await settle(page);
    assert.deepEqual(await active(page), ["#32-read-a-flag"]);
  });
});

test("folded headings do not steal selection, and navigating into a note reveals it", async () => {
  await withPage(async (page) => {
    await page.goto(base + "/folded/tdds/guide.html");
    await clickSection(page, "how-to-read-the-contracts");
    await page.locator(".md details.guide > summary").click();
    await page.evaluate(() => scrollBy(0, 2));
    await settle(page);
    assert.deepEqual(await active(page), ["#how-to-read-the-contracts"]);
    await clickSection(page, "folded-explanation");
    assert.equal(await page.locator(".md details.guide").evaluate((d) => d.open), true);
    await page.locator(".md details.guide > summary").click();
    await settle(page);
    assert.notDeepEqual(await active(page), ["#folded-explanation"], "a hidden subsection cannot remain current");
    assert.equal(await page.locator('.docnav a[aria-current="location"]').evaluate((a) => document.getElementById(a.dataset.toc).getClientRects().length > 0), true);
  });
});

test("mobile contents and the desktop sidebar retain the same selected section", async () => {
  await withPage(async (page) => {
    await page.goto(base + tdd);
    assert.equal(await page.locator(".toc-inline").evaluate((d) => d.open), false);
    await page.locator(".toc-inline > summary").click();
    await clickSection(page, "32-read-a-flag", ".toc-inline");
    await page.setViewportSize({ width: 1440, height: 1000 });
    await settle(page);
    assert.deepEqual(await active(page), ["#32-read-a-flag"]);
  }, { width: 390, height: 844 });
});
