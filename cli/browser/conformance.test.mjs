import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { conformancePage } from "../dist/src/assessment-site.js";
import { DEFAULT_CONFIG } from "../dist/src/config.js";
import { buildIndex } from "../dist/src/indexer.js";
import { deviating, LOCATION } from "../dist/test/assessment-fixture.js";

let browser;
before(async () => { browser = await chromium.launch(); });
after(async () => { await browser?.close(); });

test("implementation evidence and both decision options remain readable on desktop and mobile", async () => {
  const index = buildIndex([{ path: LOCATION, kind: "tdd", text: "# Design\n\n- **WL-01** Join returns 201.\n" }], DEFAULT_CONFIG);
  const html = conformancePage(index, [{ id: "d".repeat(64), assessment: deviating(), report: "# Full review", freshness: "current", reasons: [], superseded: false }], "Queue", ["acme/api#9"]);
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    try {
      await page.setContent(html);
      assert.equal(await page.getByText("Does not conform — 1 decisions needed", { exact: true }).isVisible(), true);
      await page.locator("details").filter({ has: page.locator("summary", { hasText: "WL-01" }) }).locator("summary").click();
      assert.equal(await page.getByRole("link", { name: "src/queue.ts:8" }).isVisible(), true);
      assert.equal(await page.getByText("Option A — change the PR:", { exact: true }).isVisible(), true);
      assert.equal(await page.getByText("Option B — update the specs:", { exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `no horizontal page overflow at ${width}px`);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
});
