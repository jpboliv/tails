import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { conformancePage } from "../dist/src/assessment-site.js";
import { DEFAULT_CONFIG } from "../dist/src/config.js";
import { buildIndex } from "../dist/src/indexer.js";
import { assessment, deviating, LOCATION } from "../dist/test/assessment-fixture.js";

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("implementation evidence and both decision options remain readable on desktop and mobile", async () => {
  const index = buildIndex([{ path: LOCATION, kind: "tdd", text: "# Design\n\nRecord IDs: `WL-<n>`.\n\n- **WL-01** Join returns 201.\n" }], DEFAULT_CONFIG);
  const html = conformancePage(index, [{ id: "d".repeat(64), assessment: deviating(), report: "# Full review", freshness: "current", codeSpecFreshness: "current", reasons: [], superseded: false }], "Queue", ["acme/api#9"]);
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.setContent(html);
      assert.equal(await page.getByText("Does not conform — 1 decision needed", { exact: true }).isVisible(), true);
      await page.locator("details").filter({ has: page.locator("summary", { hasText: "WL-01" }) }).locator("summary").click();
      assert.equal(await page.getByRole("link", { name: "src/queue.ts:8" }).isVisible(), true);
      assert.equal(await page.getByText("Option A — change the PR:", { exact: true }).isVisible(), true);
      assert.equal(await page.getByText("Option B — update the specs:", { exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `no horizontal page overflow at ${width}px`);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});

test("unverified ticket evidence and unreadable assessments stay visible without green outcomes", async () => {
  const a = assessment();
  a.scope = { basis: "ticket", tickets: ["APP-1"], description: "Queue endpoint" };
  a.sources.push({ key: "ticket", kind: "ticket", location: "https://linear.app/acme/issue/APP-1", revision: "2026-11-04", purpose: "baseline" });
  const html = conformancePage(buildIndex([], DEFAULT_CONFIG), [{
    id: "d".repeat(64), assessment: a, report: null, freshness: "unverified", codeSpecFreshness: "current",
    reasons: ["Ticket scope is unverified."], superseded: false,
  }], "Queue", ["acme/api#9"], [{ id: "e".repeat(64), error: "Stored assessment has an incompatible schema." }]);
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.setContent(html);
      assert.equal(await page.getByText("Met · unverified inputs", { exact: true }).isVisible(), true);
      assert.equal(await page.getByText("Code/spec revisions: current. Overall input verification: unverified.", { exact: true }).isVisible(), true);
      assert.equal(await page.getByRole("heading", { name: "1 unreadable assessment", exact: true }).isVisible(), true);
      assert.equal(await page.locator(".chip.ok").count(), 0);
      assert.equal(await page.getByText("No readable assessment imported.", { exact: false }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `no horizontal page overflow at ${width}px`);
    } finally { await page.close(); }
  }
});
