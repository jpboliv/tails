// Render the README's sample feature with the real indexer, checks and report UI.
// Usage: node scripts/demo.mjs <output-folder> [path-to-playwright/index.mjs]
// The optional Playwright module captures the walkthrough. No GitHub access is used.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { renderFeature } from "../dist/src/feature-cli.js";

const out = process.argv[2];
if (!out) throw new Error("Pass an output folder for the sample report and screenshots.");
const home = resolve(out);
const example = fileURLToPath(new URL("../examples/feature-flags/", import.meta.url));
const paths = ["prds/FF-1-feature-flags.md", "tdds/FF-2-feature-flags.md", "test-case-specs/FF-1-feature-flags.md"];
const titles = ["Define feature flags", "Design the flag service", "Test workspace overrides"];
const states = ["merged", "open", "draft"];
const sha = "c7e4a920b1d8f63a40925e3b1c6d8f0a2b4e7c90";
mkdirSync(home, { recursive: true });
writeFileSync(join(home, "feature-flags.yml"), `name: Feature flags
prd: https://github.com/example/specs/pull/12
tdd: https://github.com/example/specs/pull/14
tests: https://github.com/example/specs/pull/16
`);
const report = renderFeature(home, "feature-flags", {
  pull: ({ number }) => ({ number, repo: "example/specs", url: `https://github.com/example/specs/pull/${number}`, title: titles[(number - 12) / 2], state: states[(number - 12) / 2], author: "alex", headSha: sha, baseRef: "main", updatedAt: "2026-11-03T14:05:00Z" }),
  pullFiles: ({ number }) => [{ path: paths[(number - 12) / 2], status: "added" }],
  file: (_owner, _repo, _ref, path) => readFileSync(join(example, path), "utf8"),
  commit: () => sha,
}, "3 Nov 2026, 14:05");
console.log(JSON.stringify(report));

if (process.argv[3]) {
  const { chromium } = await import(pathToFileURL(resolve(process.argv[3])).href);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, colorScheme: "light", reducedMotion: "reduce" });
    const frames = [];
    const capture = async (name, caption, duration = 3200) => {
      await page.screenshot({ path: join(home, `${name}.png`) });
      frames.push({ file: `${name}.png`, caption, duration });
    };
    await page.goto(pathToFileURL(join(report.dir, "site/index.html")).href);
    await capture("01-overview", "1. Open a feature: tails feature feature-flags", 4200);
    await page.locator("#sources").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await capture("02-sources", "2. Read the PRD, design and tests together.");
    await page.getByRole("navigation", { name: "Report" }).getByRole("link", { name: "Findings", exact: true }).click();
    await page.getByRole("button", { name: /^Blocking/ }).click();
    await capture("03-conflict", "3. See where the documents disagree.", 5200);
    await page.getByRole("button", { name: /^Warnings/ }).click();
    await page.getByRole("searchbox", { name: "Search findings" }).fill("FR-1.6");
    await capture("04-warning", "4. Find a requirement with no design or test.", 4200);
    await page.getByRole("navigation", { name: "Report" }).getByRole("link", { name: "Documents", exact: true }).click();
    await capture("05-documents", "5. Choose a document to read.");
    await page.locator(".doc-card.tdd").click();
    await page.locator('[id="31-create-a-flag"]').evaluate((el) => el.scrollIntoView({ block: "start" }));
    await capture("06-reader", "6. Read the design. Follow IDs to their evidence.", 4400);
    await page.getByRole("switch", { name: /Agent notes/ }).click();
    await page.locator('[id="31-create-a-flag"]').evaluate((el) => el.scrollIntoView({ block: "start" }));
    await capture("07-notes", "Open agent notes when you need the extra detail.", 3800);
    writeFileSync(join(home, "frames.json"), JSON.stringify(frames, null, 2) + "\n");
    console.log(`Captured ${frames.length} frames in ${home}`);
  } finally {
    await browser.close();
  }
}
