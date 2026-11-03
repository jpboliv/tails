// The static site opened from disk: every link is relative and lands on a file and anchor that exist.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";
import { cli, fixture, siteOf, snapshot, tmp } from "./helpers.js";

function brokenLinks(site: string): string[] {
  const pages = snapshot(site);
  const broken: string[] = [];
  for (const [page, html] of pages) {
    if (!page.endsWith(".html")) continue;
    for (const [tag = "", raw] of html.matchAll(/<a\b[^>]*\bhref="([^"]*)"[^>]*>/g)) {
      const href = (raw ?? "").replace(/&amp;/g, "&");
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        // Only a link written in a spec may leave the report, and only to the web or mail.
        if (!/^(https?|mailto):/.test(href) || !tag.includes('rel="noopener noreferrer nofollow"')) broken.push(`${page}: absolute link ${href}`);
        continue;
      }
      const [file = "", frag] = href.split("#");
      const target = file === "" ? page : normalize(join(dirname(page), decodeURIComponent(file)));
      if (target.startsWith("..") || !existsSync(join(site, target))) {
        broken.push(`${page}: ${href} (no file ${target})`);
        continue;
      }
      if (frag && !(pages.get(target) ?? "").includes(`id="${decodeURIComponent(frag)}"`)) broken.push(`${page}: ${href} (no anchor)`);
    }
  }
  return broken;
}

for (const name of ["catalog", "acme", "records"]) {
  test(`every link in the ${name} site resolves to a file and anchor on disk`, () => {
    const out = tmp();
    assert.notEqual(cli("report", "--repo", fixture(name), "--out", out).code, 2);
    const site = join(out, "site");
    assert.ok(snapshot(site).size >= 4);
    assert.deepEqual(brokenLinks(site), []);
  });
}

test("document filenames are encoded as URLs and cannot inject HTML attributes", () => {
  const repo = tmp();
  mkdirSync(join(repo, "prds"));
  const name = 'x" onmouseover="alert(1) #%.MD';
  writeFileSync(join(repo, "prds", name), "# Example\n\n- **FR-1.1** Read this.\n");
  const out = tmp();
  assert.equal(cli("report", "--repo", repo, "--out", out).code, 0);
  const site = join(out, "site");
  assert.deepEqual(brokenLinks(site), []);
  for (const html of snapshot(site).values()) assert.doesNotMatch(html, /<[^>]+ onmouseover="/);
  assert.match(snapshot(site).get("docs.html")!, /x%22%20onmouseover%3D%22alert\(1\)%20%23%25\.html/);
  assert.match(snapshot(site).get("index.html")!, /Not provided: TDD, Test cases/);
  assert.doesNotMatch(snapshot(site).get("index.html")!, /The specs agree/);
});

const row = (html: string, id: string) => (html.match(new RegExp(`<tr data-row>(?:(?!</tr>).)*>${id.replace(/\./g, "\\.")}</a>.*?</tr>`)) ?? [""])[0];
const text = (html: string) => html.replace(/<script>[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the report reads in full without JavaScript, and its script only adds controls", () => {
  for (const [path, html] of [...siteOf(fixture("catalog")), ...siteOf(fixture("records"))]) {
    if (!path.endsWith(".html")) continue;
    // The only scripts are inline: no file to fetch, nothing to break when the page is opened from disk.
    assert.doesNotMatch(html, /<script[^>]*\bsrc=/i, path);
    // Controls that need the script stay hidden until it runs. Folded notes open natively.
    for (const [tag] of html.matchAll(/<[^>]*data-(?:filter|theme-toggle|notes-toggle|browse-controls)[^>]*>/g)) assert.match(tag, /\bhidden\b/, `${path}: ${tag}`);
  }
  const home = text(siteOf(fixture("catalog")).get("index.html")!);
  assert.match(home, /1 contradiction between specs/);
  assert.match(home, /Archive migration/, "the PRD side is quoted");
  assert.match(home, /What to do: Decide which document is right/);
});

test("a document lists its sections as a tree beside the text, and each section links to its heading", () => {
  const site = siteOf(fixture("records"));
  const page = site.get("tdds/LIB-2-loans.html")!;
  const aside = /<aside class="docnav">([\s\S]*?)<\/aside>/.exec(page)?.[1] ?? "";
  assert.match(aside, /^<nav class="toc" aria-label="Sections"><a class="toc-root" href="#technical-design--tool-loans"/, "the title is the root");
  assert.match(aside, /<li><details open><summary><a href="#2-context-and-scope" data-toc="2-context-and-scope"[^>]*>2\. Context and scope<\/a><\/summary><ul><li><a href="#how-to-read-the-contracts"/, "subsections fold under their section");
  const targets = [...aside.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]!);
  assert.equal(targets.length, 10);
  for (const id of targets) assert.match(page, new RegExp(`<h\\d id="${id}"`), id);
  // Both layouts follow the same selected section, including the document title.
  const inline = /<details class="toc-inline"><summary>Contents<\/summary>([\s\S]*?)<\/nav><\/details>/.exec(page)?.[1] ?? "";
  assert.match(inline, /href="#4-required-contracts"/);
  assert.match(inline, /data-toc="4-required-contracts"/);
  assert.match(aside, /data-toc="technical-design--tool-loans"/);
  const source = site.get("tdds/LIB-2-loans.source.html")!;
  assert.match(source, /<aside class="docnav">.*<a href="#L10" data-toc="L10"[^>]*>2\. Context and scope<\/a>.*<a href="#L24" data-toc="L24"[^>]*>4\.1 Loans<\/a>/s, "the source view links each section to its line");
});

test("the ledger traces each PRD requirement to the TDD rows and test cases that cite it", () => {
  const epic = siteOf(fixture("acme")).get("epics/ACME-1.html")!;
  assert.match(text(row(epic, "FR-1.1")), /EX-API-1 TC-01 Designed and tested/);
  assert.match(text(row(epic, "FR-1.3")), /EX-API-2 none Designed, no test/);
  assert.match(text(row(epic, "FR-1.2")), /DR-1 none none Not traced/);
  // A TDD without PRD citations omits the design column and explains the missing links.
  const catalog = siteOf(fixture("catalog")).get("epics/CAT-1.html")!;
  assert.doesNotMatch(catalog, /<th scope="col">TDD<\/th>/);
  assert.match(text(catalog), /The TDD names no PRD requirement/);
  assert.match(text(row(catalog, "FR-9.1")), /TC-37 Tested/);
});

test("an ID page shows its text, what cites it, and the findings that name it", () => {
  const pages = siteOf(fixture("catalog"));
  const fr = text(pages.get("ids/prds/CAT-1-catalog/FR-9.1.html")!);
  assert.match(fr, /librarians and reviewers can approve/);
  assert.match(fr, /Cited by .*TC-37 covers/);
  const d9 = pages.get("ids/tdds/CAT-2-catalog/D9.html")!;
  assert.match(d9, /href="\.\.\/\.\.\/\.\.\/drift\.html#DR-2:[0-9a-f]+">Scope conflict<\/a>/);
});
