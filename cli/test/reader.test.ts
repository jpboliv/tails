// The reader view folds the notes written for the agent, keeps every word reachable, and decides
// only from the format's fixed markers.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { matchNote, matchRecord, readerFor, stripComments } from "../src/reader.js";
import { renderMarkdown, toLines } from "../src/render-md.js";
import { fixture, siteOf } from "./helpers.js";

const TDD = "tdds/LIB-2-loans";
const PRD = "prds/LIB-1-loans";
const tdd = (md: string) => renderMarkdown(toLines(md), { reader: readerFor("tdd") });
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const details = (html: string) => [...html.matchAll(/<details class="agent[^"]*" data-agent>[\s\S]*?<\/details>/g)].map((m) => m[0]);

test("the markers are matched exactly, never by wording", () => {
  assert.deepEqual(matchNote("_Verify (FF-API-62, FF-API-63):_ request specs"), { kind: "verify", ids: ["FF-API-62", "FF-API-63"], rest: "request specs" });
  assert.deepEqual(matchNote("  _Free:_ the serializer"), { kind: "free", ids: [], rest: "the serializer" });
  for (const prose of ["Verify (FF-API-1): specs", "_Verify_ the specs", "We verify (FF-API-1) here.", "_Free_ to choose", "**Free:** the serializer"]) assert.equal(matchNote(prose), null, prose);
  const tddReader = readerFor("tdd");
  assert.deepEqual(matchRecord("**FF-API-05** `config/x.rb` exists.", tddReader), { id: "FF-API-05", ids: ["FF-API-05"], rest: "`config/x.rb` exists." });
  assert.deepEqual(matchRecord("**FF-WEB-13**, **FF-MOB-16** Web", tddReader)?.ids, ["FF-WEB-13", "FF-MOB-16"]);
  assert.equal(matchRecord("**WL-01** A migration", tddReader)?.id, "WL-01");
  assert.equal(matchRecord("**Note:** a bold label", tddReader), null);
  assert.equal(matchRecord("**FR-1.3** _Retired in rev 2._", readerFor("prd"))?.retired, "2");
  assert.equal(matchRecord("**TC-01** Steps", readerFor("tcs")), null, "test case specs keep their own layout");
});

test("HTML comments go, line numbers stay, and code keeps its comments", () => {
  const lines = toLines("a <!-- x --> b\n<!-- one\ntwo -->\nkeep\n```html\n<!-- in code -->\n```\n`<!-- inline -->` stays");
  const out = stripComments(lines);
  assert.deepEqual(out.map((l) => l.n), lines.map((l) => l.n));
  assert.deepEqual(out.map((l) => l.text), ["a  b", "", "", "keep", "```html", "<!-- in code -->", "```", "`<!-- inline -->` stays"]);
});

test("a record's tests and free choices fold into one disclosure under its rule", () => {
  const html = tdd("- **LN-API-1** `POST /loans` returns `201`.\n\n  _Verify (LN-API-1):_ a request spec.\n\n  _Free:_ the serializer.\n");
  assert.match(html, /<ul class="records"><li class="rec"><span class="la" id="LN-API-1"><\/span><span class="rid"><a href="#LN-API-1">LN-API-1<\/a><\/span>/);
  const [d, ...rest] = details(html);
  assert.equal(rest.length, 0, "one disclosure for the run of notes");
  assert.match(d!, /<summary><span class="an-sum">Tests · Free choice<\/span><\/summary>/);
  assert.doesNotMatch(d!, /an-ids/, "the record's own ID is not repeated");
  assert.doesNotMatch(html, /_Verify|_Free:_/, "the markers themselves are not shown");
  assert.match(text(d!), /a request spec\. .*the serializer\./, "every word is still on the page");
  assert.match(html, /<span class="la" id="L3"><\/span>/, "the note's line keeps its anchor");
});

test("notes outside a record say which records they test, and link them", () => {
  const html = tdd("- **LN-API-2** Returns `409`.\n\n_Verify (LN-API-2, LN-API-9):_ request specs.\n");
  const [d] = details(html);
  assert.match(d!, /<span class="an-about">LN-API-2, LN-API-9<\/span>/);
  assert.match(d!, /<span class="an-ids"><a href="#LN-API-2">LN-API-2<\/a> <span>LN-API-9<\/span><\/span>/, "only defined records link");
});

test("an item that defines several records together labels and anchors each one", () => {
  const html = tdd("- **LN-WEB-1**, **LN-APP-2** Web and app helpers.\n\n  _Verify (LN-WEB-1, LN-APP-2):_ helper tests.\n");
  assert.match(html, /<span class="la" id="LN-WEB-1"><\/span><span class="la" id="LN-APP-2"><\/span><span class="rid"><a href="#LN-WEB-1">LN-WEB-1<\/a><a href="#LN-APP-2">LN-APP-2<\/a><\/span><div class="rb">(?:<p>)?<span class="la" id="L1"><\/span>Web and app helpers\./);
  assert.doesNotMatch(details(html)[0]!, /an-ids/, "notes about the item's own records name none");
});

test("Blocked is highlighted, existing is tagged, and the reading guide folds with its heading", () => {
  const html = tdd("## 2. Context\n\n### How to read the contracts\n\nRecords start with a bold ID.\n\n## 3. Architecture\n\n**Blocked (the sender):** not chosen. _(existing)_ Envelope.\n");
  const [guide] = details(html);
  assert.match(guide!, /^<details class="agent guide" data-agent><summary><h3 id="how-to-read-the-contracts">/);
  assert.match(guide!, /Records start with a bold ID\./);
  assert.doesNotMatch(guide!, /Architecture/, "the fold ends at the next section");
  assert.match(html, /<p class="blocked"><span class="la" id="L9"><\/span><strong>Blocked \(the sender\):<\/strong>/);
  assert.match(html, /<span class="tag"[^>]*>Existing<\/span> Envelope\./);
});

test("the rules apply only to the document kinds the format defines them for", () => {
  const md = "- **FR-1.1** Given a tool.\n\n_Verify (FR-1.1):_ not a TDD note.\n\n_(existing)_ text";
  const prd = renderMarkdown(toLines(md), { reader: readerFor("prd") });
  assert.match(prd, /class="rec"/, "PRD criteria take the margin layout");
  assert.equal(details(prd).length, 0, "a PRD has no agent notes to fold");
  assert.match(prd, /<em>\(existing\)<\/em>/);
  const plain = renderMarkdown(toLines(md));
  assert.doesNotMatch(plain, /class="rec"|data-agent/, "without a reader the page renders as before");
});

test("the TDD page reads clean, keeps every line, and the source page shows the file as written", () => {
  const site = siteOf(fixture("records"));
  const page = site.get(`${TDD}.html`)!;
  const src = readFileSync(join(fixture("records"), `${TDD}.md`), "utf8");
  const n = src.split("\n").length;
  for (const view of [page, site.get(`${TDD}.source.html`)!]) {
    const missing = Array.from({ length: n }, (_, k) => k + 1).filter((k) => !view.includes(`id="L${k}"`));
    assert.deepEqual(missing, []);
  }
  const article = page.slice(page.indexOf('<article class="md">'));
  const folds = details(article);
  assert.equal(folds.length, 4, "the guide, LN-API-1's notes, the run after LN-API-3, and LN-APP-1's notes");
  assert.match(page, /<button class="switch" type="button" role="switch" aria-checked="false" hidden data-notes-toggle[^>]*>.*Agent notes <span class="n">6<\/span>/);
  // Outside the folds, nothing written for the agent remains.
  const outside = folds.reduce((html, d) => html.replace(d, ""), article);
  assert.doesNotMatch(outside, /a request spec|the serializer|mailer spec|component tests|Every checkable rule/);
  for (const phrase of ["a request spec of a borrow", "the serializer, as long as", "a mailer spec of the receipt", "component tests of the tool screen"]) assert.match(text(page), new RegExp(phrase));
  assert.match(site.get(`${TDD}.source.html`)!, /_Verify \(<a href="[^"]*LN-API-1\.html">LN-API-1<\/a>\):_ a request spec/, "as written, with the ID linked");
});

test("the PRD page drops template comments and mutes a retired criterion", () => {
  const page = siteOf(fixture("records")).get(`${PRD}.html`)!;
  assert.doesNotMatch(page, /Template guidance|&lt;!--/);
  assert.match(page, /<li class="rec retired">/);
  assert.match(page, /<span class="rid"><a href="[^"]*FR-1\.1\.html">FR-1\.1<\/a><\/span>/, "an indexed criterion links to its ID page");
  assert.doesNotMatch(page, /<button class="switch"/, "no switch when nothing is folded");
});
