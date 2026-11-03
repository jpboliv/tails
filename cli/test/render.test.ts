// Spec pages render the markdown the way GitHub shows it, keep every line linkable, and treat
// the spec as untrusted text.
import assert from "node:assert/strict";
import { appendFileSync, cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { renderMarkdown, toLines } from "../src/render-md.js";
import { oneLine } from "../src/util.js";
import { fixture, siteOf, tmp } from "./helpers.js";

const TDD = "tdds/CAT-2-catalog";

test("a GFM table renders as a table with a header row and body cells", () => {
  const html = renderMarkdown(toLines("| ID | Rule |\n| :-- | --: |\n| INV-1 | Uses `a \\| b` and **bold** |"));
  assert.match(html, /<table>/);
  assert.match(html, /<thead id="L2"><tr id="L1"><th>ID<\/th><th class="a-r">Rule<\/th><\/tr><\/thead>/);
  assert.match(html, /<tr id="L3"><td[^>]*>INV-1<\/td><td[^>]*>Uses <code>a \| b<\/code> and <strong>bold<\/strong><\/td><\/tr>/);
});

test("lists, code, quotes and headings render as their HTML elements", () => {
  const html = renderMarkdown(toLines("## Scope\n\n- [x] done\n- [ ] open\n\n1. one\n2. two\n\n```ts\nconst a = 1 < 2;\n```\n\n> [!NOTE]\n> Read this.\n\n---"));
  assert.match(html, /<h2 id="scope">/);
  assert.match(html, /<input type="checkbox" disabled checked aria-label="Done">/);
  assert.match(html, /<ol>/);
  assert.match(html, /<span class="cl" id="L10">const a = 1 &lt; 2;\n<\/span>/);
  assert.match(html, /class="alert note"/);
  assert.match(html, /<hr>/);
});

test("script, raw HTML and script links in a spec show as text and never run", () => {
  const html = renderMarkdown(toLines('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[click](javascript:alert(1)) [data](data:text/html,x) [proto](//evil.example)\n\n| a |\n| - |\n| <b>x</b><br>y |\n\nstash \u00010\u0001 marker'));
  assert.doesNotMatch(html, /<script|<img|<b>|javascript:|data:text|\/\/evil/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;<br>y/);
  assert.match(html, /click data proto/);
  assert.match(html, /stash \uFFFD0\uFFFD marker/);
});

test("web links in a spec open as plain outbound links", () => {
  const html = renderMarkdown(toLines("See [docs](https://example.com/a?b=1&c=2) or https://x.example."));
  assert.match(html, /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" rel="noopener noreferrer nofollow">docs<\/a>/);
  assert.match(html, /<a href="https:\/\/x\.example"[^>]*>https:\/\/x\.example<\/a>\./);
});

test("every source line keeps its #L anchor on the rendered page and the source page", () => {
  const site = siteOf(fixture("catalog"));
  for (const doc of ["prds/CAT-1-catalog", TDD, "test-case-specs/CAT-1-catalog"]) {
    const lines = readFileSync(join(fixture("catalog"), `${doc}.md`), "utf8").split("\n").length;
    for (const page of [`${doc}.html`, `${doc}.source.html`]) {
      const html = site.get(page)!;
      const missing = Array.from({ length: lines }, (_, k) => k + 1).filter((n) => !html.includes(`id="L${n}"`));
      assert.deepEqual(missing, [], page);
    }
  }
});

test("a rendered spec shows tables, links its IDs, and switches to the source view", () => {
  const site = siteOf(fixture("catalog"));
  const html = site.get(`${TDD}.html`)!;
  assert.match(html, /<article class="md">/);
  assert.match(html, /<table>/);
  assert.doesNotMatch(html, /\| --- \|/);
  // An ID in the text links to its ID page.
  assert.match(html, /<a class="idref" href="\.\.\/ids\/tdds\/CAT-2-catalog\/INV-8\.html">INV-8<\/a>/);
  assert.match(html, /id="INV-14"/);
  // Rendered is the default, and the source view is one link away, without JavaScript.
  assert.match(html, /<a href="CAT-2-catalog\.html" data-keep-hash aria-current="page">Rendered<\/a><a href="CAT-2-catalog\.source\.html" data-keep-hash>Source<\/a>/);
  assert.match(site.get(`${TDD}.source.html`)!, /<a href="CAT-2-catalog\.html" data-keep-hash>Rendered<\/a><a href="CAT-2-catalog\.source\.html" data-keep-hash aria-current="page">Source<\/a>/);
});

test("a hostile spec cannot inject markup into the report", () => {
  const repo = tmp();
  cpSync(fixture("catalog"), repo, { recursive: true });
  appendFileSync(join(repo, `${TDD}.md`), '\n<script>alert(1)</script>\n\n| D | Note |\n| - | - |\n| INV-8 | <iframe src="https://evil.example"></iframe> [x](javascript:alert(1)) |\n');
  const site = siteOf(repo);
  for (const [path, html] of site) {
    if (!path.endsWith(".html")) continue;
    assert.doesNotMatch(html, /<script>alert|<iframe|href="javascript:/, path);
  }
  assert.match(site.get(`${TDD}.html`)!, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("an excerpt cut inside a code span or bold run still renders as markdown", () => {
  const cut = oneLine(`Behind \`${"x".repeat(20)} y\` and **bold ${"z ".repeat(10)}** end`, 16);
  assert.equal(cut, "Behind `xxxxxxx`…");
  assert.equal(oneLine(`**Lead** then **bold ${"z ".repeat(10)}** end`, 14), "then **bold z**…");
});

test("a wide table's cell labels show the header text once escaped", () => {
  const html = renderMarkdown(toLines("| ID | R&D | A <b> | Note |\n| --- | --- | --- | --- |\n| INV-1 | x | y | z |"));
  assert.match(html, /data-label="R&amp;D"/);
  assert.match(html, /data-label="A &lt;b&gt;"/);
});
