// Static HTML report (TDD §4.4.2 anchors; INV-11: published as a CI artifact only). Pure: returns
// file path to content, and the CLI writes the files. cli/README.md lists the pages.
import { adviceFor, citeLabel, QUOTES, ROLE_NAME, type Cite, type Finding } from "./drift.js";
import { canCheckCitation, DOC_KINDS, DOC_LABEL, hasKind } from "./availability.js";
import { familySpec } from "./families.js";
import { chip, esc, inlineMd, page, rel, type Crumb, type Tone } from "./html.js";
import type { SourceDoc } from "./indexer.js";
import { epics, TRACE_LABEL, type Epic, type Requirement, type Trace } from "./ledger.js";
import type { Citation, Definition, DocInfo, SpecIndex } from "./model.js";
import { blockAt, headingSlugs, isHeading, itemBody, outline, renderInline, renderMarkdown, toLines, type Line, type OutlineHeading } from "./render-md.js";
import { readerFor } from "./reader.js";
import { DOC_ROLES, ROLE_KIND, type Feature, type PullRequest } from "./feature.js";
import { browseControls, browseEmpty, icon } from "./workspace.js";
import { posix } from "node:path";
import { compareBy, gist, oneLine, plural } from "./util.js";

export const pageFor = (doc: string) => doc.replace(/\.md$/i, ".html");
export const sourcePageFor = (doc: string) => doc.replace(/\.md$/i, ".source.html");
export const idPage = (e: Pick<Definition, "doc" | "id">) => `ids/${e.doc.replace(/\.md$/i, "")}/${e.id.replace(/[^\w.-]/g, "_")}.html`;
export const epicPage = (group: string) => `epics/${group.replace(/[^\w.-]/g, "_")}.html`;

const KIND: Record<DocInfo["kind"], string> = { prd: "PRD", tdd: "TDD", tcs: "TC" };
const KIND_NAME: Record<DocInfo["kind"], string> = { prd: "Product requirements", tdd: "Technical design", tcs: "Test cases" };

const kindTag = (k: DocInfo["kind"] | Cite["role"]) => (k === "doc" ? "" : `<span class="kind ${k}">${KIND[k]}</span>`);
const pct = (n: number, of: number) => (of === 0 ? 0 : Math.round((100 * n) / of));

interface Ctx {
  readonly index: SpecIndex;
  readonly findings: readonly Finding[];
  readonly open: readonly Finding[];
  readonly byKey: ReadonlyMap<string, Definition>;
  readonly docOf: ReadonlyMap<string, DocInfo>;
  /** The best one-line text for a doc:line: a definition's gist or a scope row. */
  readonly textAt: ReadonlyMap<string, string>;
  /** The raw line, for citations that sit outside any definition. */
  readonly lineAt: (doc: string, line: number) => string;
  readonly epics: readonly Epic[];
  readonly source: string;
  readonly lines: ReadonlyMap<string, readonly Line[]>;
  /** IDs that link on a line of a document, as relative links from a page. */
  readonly idsAt: (doc: string, from: string) => (line: number) => ReadonlyMap<string, string> | undefined;
  /** IDs a line defines, which become #<ID> anchors. */
  readonly defsAt: (doc: string, line: number) => readonly Definition[];
  /** A relative link in a document, resolved to a report page, or undefined. */
  readonly resolve: (doc: string, from: string, url: string) => string | undefined;
  /** Set when the report shows one feature (`tails feature`). */
  readonly feature?: FeatureView;
}

export interface FeatureView {
  readonly feature: Feature;
  /** When Tails read the sources, as people read it: "3 Nov 2026, 14:05". */
  readonly readAt: string;
}

function sourceLabel(index: SpecIndex): string {
  if (index.refs?.length) return esc(index.refs.map((r) => `${r.ref}@${r.commit.slice(0, 7)}`).join(" + "));
  return index.commit ? `commit ${esc(index.commit.slice(0, 12))}` : "working tree";
}

/** Matched words a DR-2 message names, so the quotes can mark them. */
const matchedTerms = (f: Finding) => (/\(matched: ([^)]+)\)/.exec(f.message)?.[1] ?? "").split(/,\s*/).filter(Boolean);

/** A raw markdown line as a reader would see it: no list or heading marks, table cells joined. */
function plainLine(line: string): string {
  const t = line.trim();
  if (t.startsWith("|")) return oneLine(t.split("|").map((c) => c.trim()).filter(Boolean).join(" · "));
  return oneLine(t.replace(/^(#+|>|[-*]|\d+\.)\s+/, ""));
}

function quote(ctx: Ctx, from: string, c: Cite, mark: readonly string[]): string {
  const text = ctx.textAt.get(`${c.doc}:${c.line}`) ?? plainLine(ctx.lineAt(c.doc, c.line));
  return `<figure class="quote"><figcaption><b>${esc(citeLabel(c))}</b><a href="${rel(from, pageFor(c.doc))}#L${c.line}">${esc(c.doc)}:${c.line}</a></figcaption>${text ? `<blockquote>${inlineMd(text, mark)}</blockquote>` : ""}</figure>`;
}

function findingCard(ctx: Ctx, from: string, f: Finding, withId: boolean): string {
  const tone = f.status === "accepted" ? "accepted" : f.severity;
  const mark = matchedTerms(f);
  const roles = [...new Set(f.citations.map((c) => c.role))];
  const sides = roles
    .map((role) => {
      const cs = f.citations.filter((c) => c.role === role);
      const rest = cs.slice(QUOTES);
      return `<div class="side ${role}"><p class="eyebrow">${kindTag(role)} ${esc(role === "doc" ? ROLE_NAME[role] : KIND_NAME[role])}</p>${cs.slice(0, QUOTES).map((c) => quote(ctx, from, c, mark)).join("")}${rest.length ? `<p class="more">Also: ${rest.map((c) => `<a href="${rel(from, pageFor(c.doc))}#L${c.line}">${esc(citeLabel(c))}</a>`).join(", ")}</p>` : ""}</div>`;
    })
    .join("");
  const accept = `- fingerprint: ${f.fingerprint}\n  reason: "…"\n  by: you@example.com\n  date: YYYY-MM-DD`;
  const advice = ctx.feature
    ? adviceFor(f.rule).replace(/ If both are right, accept the finding with a reason\./, "")
    : adviceFor(f.rule);
  return `<article class="finding ${tone}"${withId ? ` id="${esc(f.fingerprint)}" data-item data-category="${tone}"` : ""} aria-labelledby="t-${esc(f.fingerprint)}">
<header>${chip(f.status === "accepted" ? "neutral" : f.severity, f.rule)}<h3 id="t-${esc(f.fingerprint)}">${esc(f.title)}</h3>${f.status === "accepted" ? chip("neutral", "Accepted") : f.severity === "fail" ? chip("fail", ctx.feature ? "Scope conflict" : "Blocks merge") : ""}${f.source !== "tails" ? chip("info", `from ${f.source}`) : ""}</header>
<p class="msg">${inlineMd(f.message)}</p>
${sides ? `<div class="sides">${sides}</div>` : ""}
${f.accepted ? `<p class="todo"><strong>Accepted</strong> by ${esc(f.accepted.by)} on ${esc(f.accepted.date)}: ${esc(f.accepted.reason)}</p>` : `<p class="todo"><strong>What to do:</strong> ${esc(advice)}</p>`}
<footer><span>Fingerprint <code>${esc(f.fingerprint)}</code></span>${f.status === "open" && !ctx.feature ? `<details><summary>Accept it with a reason</summary><p class="small">Add this to <code>.tails/accepted.yml</code>:</p><pre class="yaml">${esc(accept)}</pre></details>` : ""}</footer>
</article>`;
}

function scopeNotes(es: readonly Epic[]): string {
  return es.map((e) => {
    const missing = DOC_KINDS.filter((kind) => !hasKind(e.docs, kind));
    return missing.length ? `<p class="scope-note">${es.length > 1 ? `${esc(e.title)} · ` : ""}Not provided: ${missing.map((kind) => DOC_LABEL[kind]).join(", ")}. Checks requiring these documents were not run.</p>` : "";
  }).join("");
}

function verdict(open: readonly Finding[], index: SpecIndex, es: readonly Epic[], local: boolean): string {
  if (!index.docs.length) return `<section class="verdict info" aria-label="Verdict"><span class="verdict-icon">${icon("docs")}</span><div class="verdict-copy"><p class="eyebrow">Report scope</p><h2>No documents provided</h2><p>Add a document to read it and check its requirements.</p></div></section>`;
  const partial = es.some((e) => DOC_KINDS.some((kind) => !hasKind(e.docs, kind)));
  const fails = open.filter((f) => f.severity === "fail");
  const provided = DOC_KINDS.filter((kind) => hasKind(index.docs, kind));
  const scope = es.length === 1 ? provided.map((kind) => DOC_LABEL[kind]).join(" + ") + (provided.length === 1 ? " only" : "") : "Provided documents";
  const tone = fails.length ? "fail" : open.length ? "warn" : partial || index.entries.length === 0 ? "info" : "ok";
  const title = fails.length ? `${plural(fails.length, "contradiction")} between specs` : open.length ? plural(open.length, "warning") : partial ? scope : index.entries.length === 0 ? "No requirement IDs found" : "No conflicts found";
  const detail = fails.length
    ? local ? "The scope check found a possible disagreement. Review the quoted evidence and update the source documents."
      : "The documents disagree about what to build. Fix the spec that is wrong, or accept the finding with a reason. Until then, spec PRs fail the tails check."
    : index.entries.length === 0 ? "The documents can be read here. Requirement coverage is not assessed until they contain supported IDs."
      : open.length ? "Review the findings in the provided documents." : "No findings in the provided documents. The checks do not assess every statement.";
  return `<section class="verdict ${tone}" aria-label="Verdict"><span class="verdict-icon">${icon(open.length ? "findings" : partial ? "docs" : "check")}</span><div class="verdict-copy"><p class="eyebrow">${partial && !open.length ? "Report scope" : "Spec checks"}</p><h2>${title}</h2><p>${detail}</p>${scopeNotes(es)}</div><a class="action" href="drift.html">${open.length ? "Review findings" : "View findings"}${icon("arrow")}</a></section>`;
}

const ORDER: readonly Trace[] = ["designed_and_tested", "tested", "design_only", "designed", "untraced", "pending"];
const traceTone = (trace: Trace): Tone => trace === "pending" ? "neutral" : trace === "untraced" ? "fail" : trace === "designed" ? "warn" : "ok";
function meter(e: { counts: Readonly<Record<Trace, number>> }, total: number): string {
  return `<span class="meter" role="img" aria-label="${ORDER.filter((t) => e.counts[t]).map((t) => `${e.counts[t]} ${TRACE_LABEL[t].toLowerCase()}`).join(", ") || "no requirements"}">${ORDER.filter((t) => e.counts[t]).map((t) => `<i class="t-${t}" style="width:${(100 * e.counts[t]) / total}%"></i>`).join("")}</span>`;
}
const legend = (traces: readonly Trace[], counts?: Readonly<Record<Trace, number>>) => `<ul class="legend">${traces.filter((t) => !counts || counts[t]).map((t) => `<li><i class="t-${t}"></i>${TRACE_LABEL[t]}</li>`).join("")}</ul>`;

function sumCounts(es: readonly Epic[]): Record<Trace, number> {
  const c = { designed_and_tested: 0, tested: 0, designed: 0, untraced: 0, design_only: 0, pending: 0 };
  for (const e of es) for (const t of ORDER) c[t] += e.counts[t];
  return c;
}

function stats(items: readonly { n: string; l: string; label?: string; tone?: string; href?: string; meter?: string }[]): string {
  return `<div class="stats">${items.map((s) => `<${s.href ? `a href="${s.href}"` : "div"} class="stat${s.tone ? ` ${s.tone}` : ""}">${s.label ? `<span class="stat-label">${s.label}</span>` : ""}${s.href && s.label ? icon("arrow") : ""}<span class="n">${s.n}</span><span class="l">${s.l}</span>${s.meter ?? ""}</${s.href ? "a" : "div"}>`).join("")}</div>`;
}

function coverageStat(es: readonly Epic[], kind: "tdd" | "tcs") {
  const label = kind === "tdd" ? "Design coverage" : "Test coverage";
  const eligible = es.filter((e) => hasKind(e.docs, "prd") && hasKind(e.docs, kind));
  const docs = es.flatMap((e) => e.docs);
  if (!eligible.length) {
    const missing = !hasKind(docs, "prd") ? "PRD not provided" : !hasKind(docs, kind) ? `${DOC_LABEL[kind]} not provided` : "No matching document pair";
    return { n: "–", label, l: missing };
  }
  const reqs = eligible.flatMap((e) => e.requirements);
  if (!reqs.length) return { n: "–", label, l: "No requirements to trace" };
  if (kind === "tdd" && !eligible.some((e) => e.tddCitesPrd)) return { n: "–", label, l: "The TDD names no PRD IDs", tone: "warn" };
  const covered = reqs.filter((r) => kind === "tdd" ? r.design.length : r.tests.length).length;
  return {
    n: `${pct(covered, reqs.length)}<small>%</small>`, label,
    l: `${covered} of ${reqs.length} ${kind === "tdd" ? "cited by the TDD" : "have test cases"}${eligible.length < es.length ? " · provided sets only" : ""}`,
    meter: `<span class="meter"><i class="t-${kind === "tdd" ? "design_only" : "tested"}" style="width:${pct(covered, reqs.length)}%"></i></span>`,
  };
}

function workspaceHead(ctx: Ctx, label: string, summary: string, action = ""): string {
  const f = ctx.feature;
  const name = f?.feature.spec.name ?? (ctx.epics.length === 1 ? ctx.epics[0]!.title : undefined);
  return `<header class="workspace-head"><div class="workspace-meta">${f ? `<span class="local-label">Local report</span><span>Read ${esc(f.readAt)}</span>` : `<span class="local-label">Spec report</span><span class="mono">${ctx.source}</span>`}</div><div class="workspace-title"><div>${name ? '<p class="eyebrow">Feature</p>' : ""}<h1>${esc(name ?? label)}</h1><p class="lede">${name ? `${esc(label)} · ` : ""}${esc(summary)}</p></div>${action}</div></header>`;
}

const sectionHead = (id: string, title: string, detail: string, link = "") => `<div class="section-head"><div><h2 id="${id}">${title}</h2><p>${detail}</p></div>${link}</div>`;

function overview(ctx: Ctx): string {
  const path = "index.html";
  const reqs = ctx.epics.flatMap((e) => e.requirements);
  const fails = ctx.open.filter((f) => f.severity === "fail");
  const accepted = ctx.findings.filter((f) => f.status === "accepted").length;
  const rules = [...new Set(ctx.open.map((f) => f.rule))].sort();

  const epicRows = ctx.epics
    .map((e) => {
      const n = e.requirements.length;
      const open = e.findings.filter((f) => f.status === "open");
      const fail = open.filter((f) => f.severity === "fail").length;
      const tests = n && hasKind(e.docs, "tcs") ? ` · ${pct(e.requirements.filter((r) => r.tests.length).length, n)}% test coverage` : "";
      return `<li><a class="row epic" href="${rel(path, epicPage(e.group))}"><span class="t">${esc(e.title)}</span><span class="m">${e.docs.map((d) => kindTag(d.kind)).join("")}${fail ? chip("fail", plural(fail, "contradiction")) : ""}${open.length - fail ? chip("warn", plural(open.length - fail, "warning")) : ""}</span><span class="sub"><span class="mono">${esc(e.group)}</span> · ${hasKind(e.docs, "prd") ? plural(n, "requirement") : "PRD not provided"}${tests}${e.tddCitesPrd ? ` · ${pct(e.requirements.filter((r) => r.design.length).length, n)}% in design` : ""}</span>${n ? meter(e, n) : ""}</a></li>`;
    })
    .join("");
  const ruleRows = rules
    .map((rule) => {
      const fs = ctx.open.filter((f) => f.rule === rule);
      return `<li><a class="row" href="drift.html#rule-${esc(rule)}"><span class="t">${esc(rule)} ${esc(fs[0]!.title)}</span><span class="m">${chip(fs[0]!.severity === "fail" ? "fail" : "warn", String(fs.length))}</span><span class="sub">${esc(adviceFor(rule))}</span></a></li>`;
    })
    .join("");

  const f = ctx.feature;
  const body = `${workspaceHead(ctx, "Overview", `${plural(ctx.index.docs.length, "document")} · ${plural(ctx.index.entries.length, "ID")}`, '<a class="action primary-action" href="docs.html">Read documents' + icon("arrow") + '</a>')}
${verdict(ctx.open, ctx.index, ctx.epics, !!f)}
${stats([
  { n: hasKind(ctx.index.docs, "prd") ? String(reqs.length) : "–", label: "Requirements", l: !hasKind(ctx.index.docs, "prd") ? "PRD not provided" : f ? "defined in the PRD" : `across ${plural(ctx.epics.length, "epic")}` },
  coverageStat(ctx.epics, "tcs"),
  coverageStat(ctx.epics, "tdd"),
  { n: String(ctx.open.length), label: "Open findings", l: `${fails.length} blocking · ${ctx.open.length - fails.length} warnings${accepted ? ` · ${accepted} accepted` : ""}`, tone: fails.length ? "fail" : ctx.open.length ? "warn" : "", href: "drift.html" },
])}
${f ? sourcesHtml(f.feature, path) : ""}
<div class="overview-bottom"><section>${sectionHead("epics", f ? "Requirement coverage" : "Epics", "Follow each requirement into the design and test cases.")}
${epicRows ? `<ul class="list">${epicRows}</ul>${legend(ORDER, sumCounts(ctx.epics))}` : '<p class="empty">No documents to trace yet.</p>'}</section>
<section>${sectionHead("rules", "Open findings", "Grouped by check.", '<a href="drift.html">All findings' + icon("arrow") + '</a>')}${rules.length ? `<ul class="list">${ruleRows}</ul>` : '<p class="empty">No findings in the provided documents.</p>'}</section></div>
${fails.length ? `${sectionHead("contradictions", "Contradictions", "Read the evidence from each document side by side.")}${fails.map((f) => findingCard(ctx, path, f, false)).join("\n")}` : ""}`;
  return page({ path, title: f?.feature.spec.name ?? "Overview", section: "overview", body, source: ctx.source, workspace: true });
}

const OUT = ' rel="noopener noreferrer nofollow"';
const STATE_TONE: Record<PullRequest["state"], Tone> = { open: "info", draft: "neutral", merged: "ok", closed: "warn" };
const prState = (p: PullRequest) => chip(STATE_TONE[p.state], p.state[0]!.toUpperCase() + p.state.slice(1));

/** What a feature is made of: each linked pull request or file, the Linear ticket, and the implementation. */
function sourcesHtml(f: Feature, path: string): string {
  const roles = DOC_ROLES.filter((role) => f.sources.some((s) => s.role === role));
  const stages = roles.map((role, i) => {
    const sources = f.sources.filter((s) => s.role === role);
    const kind = ROLE_KIND[role];
    const cards = sources.map((s) => {
      const title = s.pull ? esc(s.pull.title) : esc(s.docs[0]?.split("/").slice(2).join("/") ?? s.link);
      const where = s.pull
        ? `${esc(s.pull.repo)}#${s.pull.number} · ${s.pull.state === "merged" ? `read from ${esc(s.pull.baseRef)}` : "read at its head"} <span class="mono">${esc(s.readFrom.commit.slice(0, 7))}</span>`
        : `${esc(s.readFrom.ref)} <span class="mono">${esc(s.readFrom.commit.slice(0, 7))}</span>`;
      const docs = s.docs.map((d) => `<a href="${rel(path, pageFor(d))}">${icon("docs")}<span>${esc(d.split("/").slice(2).join("/"))}</span></a>`).join("");
      return `<div class="stage-source"><header>${kindTag(kind)}${s.pull ? prState(s.pull) : chip("neutral", "File")}</header><h4><a href="${esc(s.link)}"${OUT}>${title}</a></h4><p class="provenance">${where}</p>${docs ? `<div class="stage-docs">${docs}</div>` : ""}</div>`;
    }).join("");
    return `<li class="source-stage ${kind}"><header class="stage-head"><span class="step">0${i + 1}</span><h3>${KIND_NAME[kind]}</h3>${i < roles.length - 1 ? icon("arrow") : icon("docs")}</header>${cards}</li>`;
  }).join("");
  const linear = f.linear
    ? [`<li class="row src"><span class="t"><span class="kind lin">LIN</span> ${f.linear.url ? `<a href="${esc(f.linear.url)}"${OUT}>${esc(f.linear.key)}</a>` : esc(f.linear.key)}</span><span class="m">${chip("neutral", "Link only")}</span><span class="sub">Linear ticket · Ticket content is not included in this report.</span></li>`]
    : [];
  const impl = f.implementation.map(
    (p) => `<li class="row src"><span class="t"><span class="kind pr">PR</span> <a href="${esc(p.url)}"${OUT}>${esc(p.title)}</a></span><span class="m">${prState(p)}</span><span class="sub">Implementation · ${esc(p.repo)}#${p.number}${p.author ? ` · ${esc(p.author)}` : ""}</span></li>`,
  );
  const notes = f.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("");
  return `${sectionHead("sources", "Sources", "Linked documents and pull requests.", '<a href="docs.html">Browse documents' + icon("arrow") + '</a>')}${notes}<ol class="source-stages">${stages}</ol>${linear.length || impl.length ? `${sectionHead("linked-work", "Linked work", "The ticket and implementation pull requests for this feature.")}<ul class="list">${[...linear, ...impl].join("")}</ul>` : ""}`;
}

function refLink(from: string, e: Definition): string {
  return `<a class="ref" href="${rel(from, idPage(e))}" title="${esc(gist(e))}">${esc(e.id)}</a>`;
}

function ledgerRow(path: string, r: Requirement, withDesign: boolean, withTests: boolean): string {
  const tone: Tone = r.trace === "tested" && withDesign ? "info" : traceTone(r.trace);
  const label = !withDesign && r.trace === "tested" ? "Tested" : TRACE_LABEL[r.trace];
  const refs = (es: readonly Definition[], none: string) => (es.length ? `<span class="refs">${es.map((e) => refLink(path, e)).join("")}</span>` : `<span class="none">${none}</span>`);
  const flags = r.findings.map((f) => `<a href="${rel(path, "drift.html")}#${esc(f.fingerprint)}">${chip(f.severity, f.rule, f.title)}</a>`).join(" ");
  return `<tr data-row><td class="id"><a href="${rel(path, idPage(r.entry))}">${esc(r.entry.id)}</a></td><td class="req">${inlineMd(gist(r.entry))}${flags ? ` ${flags}` : ""}</td>${withDesign ? `<td data-label="TDD">${refs(r.design, "none")}</td>` : ""}${withTests ? `<td data-label="Test cases">${refs(r.tests, "none")}</td>` : ""}<td data-label="Status">${chip(tone, label)}</td></tr>`;
}

function epicHtml(ctx: Ctx, e: Epic): string {
  const path = epicPage(e.group);
  const n = e.requirements.length;
  const withTests = hasKind(e.docs, "tcs");
  const open = e.findings.filter((f) => f.status === "open");
  const parents = [...new Map(e.requirements.map((r) => [r.parent?.key ?? "", r.parent])).values()];
  const cols = 3 + Number(e.tddCitesPrd) + Number(withTests);
  const rows = parents
    .map((p) => {
      const rs = e.requirements.filter((r) => (r.parent?.key ?? "") === (p?.key ?? ""));
      return `<tbody>${p ? `<tr class="group"><th colspan="${cols}" scope="colgroup"><a href="${rel(path, idPage(p))}">${esc(p.id)}</a> ${inlineMd(gist(p).replace(new RegExp(`^${p.id.replace(/\./g, "\\.")}\\s*[—–:-]?\\s*`), ""))}</th></tr>` : ""}${rs.map((r) => ledgerRow(path, r, e.tddCitesPrd, withTests)).join("")}</tbody>`;
    })
    .join("");
  const body = `<p class="eyebrow">Epic · <span class="mono">${esc(e.group)}</span></p>
<h1>${esc(e.title)}</h1>
<p class="lede">Requirements and their links in the provided documents. This does not measure implementation progress.</p>
${scopeNotes([e])}
<div class="idchips">${e.docs.map((d) => `<a class="ref" href="${rel(path, pageFor(d.path))}">${kindTag(d.kind)} ${esc(d.path)}</a>`).join("")}</div>
${stats([
  { n: hasKind(e.docs, "prd") ? String(n) : "–", l: hasKind(e.docs, "prd") ? "requirements" : "PRD not provided" },
  coverageStat([e], "tcs"),
  coverageStat([e], "tdd"),
  { n: String(open.length), l: "open findings", tone: open.some((f) => f.severity === "fail") ? "fail" : open.length ? "warn" : "", href: rel(path, "drift.html") },
])}
${n && hasKind(e.docs, "tdd") && !e.tddCitesPrd ? `<p class="note"><strong>The TDD names no PRD requirement.</strong> Link design entries to FR IDs so Tails can trace their requirements.</p>` : ""}
${n ? `${meter(e, n)}${legend(ORDER, e.counts)}` : ""}
<h2 id="ledger">Requirement ledger</h2>
<div class="filter" data-filter=".ledger tr[data-row]" hidden><label for="q">Filter</label><input id="q" type="search" placeholder="ID, word, or status" autocomplete="off"><output for="q" aria-live="polite"></output></div>
${n ? `<div class="tablewrap"><table class="ledger"><caption class="skip">Requirement ledger for ${esc(e.title)}</caption><thead><tr><th scope="col">ID</th><th scope="col">Requirement</th>${e.tddCitesPrd ? `<th scope="col">TDD</th>` : ""}${withTests ? '<th scope="col">Test cases</th>' : ""}<th scope="col">Status</th></tr></thead>${rows}</table></div>` : `<p class="empty">${hasKind(e.docs, "prd") ? "This epic's PRD defines no numbered requirements (FR-n.n)." : "PRD not provided. Requirement coverage is not assessed."}</p>`}`;
  return page({ path, title: e.title, section: null, crumbs: [{ label: "Overview", href: "index.html" }, { label: e.group }], body, source: ctx.source });
}

function traceList(from: string, ctx: Ctx, items: readonly { def?: Definition; c: Citation }[], empty: string): string {
  if (!items.length) return `<p class="empty">${empty}</p>`;
  return `<ul class="trace">${items
    .map(({ def, c }) => {
      const doc = ctx.docOf.get(def?.doc ?? c.doc);
      return def
        ? `<li>${doc ? kindTag(doc.kind) : ""}<span><a href="${rel(from, idPage(def))}"><strong>${esc(def.id)}</strong></a> <span class="muted small">${esc(c.kind)}</span></span><span class="g">${inlineMd(gist(def))}</span></li>`
        : `<li>${doc ? kindTag(doc.kind) : ""}<span><a href="${rel(from, pageFor(c.doc))}#L${c.line}" class="mono">${esc(c.doc)}:${c.line}</a> <span class="muted small">${esc(c.kind)}</span></span><span class="g">${inlineMd(ctx.textAt.get(`${c.doc}:${c.line}`) ?? plainLine(ctx.lineAt(c.doc, c.line)))}</span></li>`;
    })
    .join("")}</ul>`;
}

function idHtml(ctx: Ctx, e: Definition, req: Requirement | undefined): string {
  const path = idPage(e);
  const doc = ctx.docOf.get(e.doc)!;
  const out = [...new Map(ctx.index.citations.filter((c) => c.from === e.key && c.to && c.to !== e.key).map((c) => [c.to!, { def: ctx.byKey.get(c.to!), c }])).values()];
  const unresolved = ctx.index.citations.filter((c) => c.from === e.key && !c.to);
  const dangling = unresolved.filter((c) => canCheckCitation(ctx.index, c));
  const deferred = unresolved.filter((c) => !canCheckCitation(ctx.index, c));
  const into = [...new Map(ctx.index.citations.filter((c) => c.to === e.key).map((c) => [c.from ?? `${c.doc}:${c.line}`, { def: c.from ? ctx.byKey.get(c.from) : undefined, c }])).values()].sort(
    compareBy((x) => ["prd", "tdd", "tcs"].indexOf(ctx.docOf.get(x.c.doc)?.kind ?? "tcs"), (x) => x.c.doc, (x) => x.c.line),
  );
  const fs = ctx.findings.filter((f) => f.ids.includes(e.key) || f.citations.some((c) => c.doc === e.doc && c.line === e.line));
  const trace = req ? chip(traceTone(req.trace), TRACE_LABEL[req.trace]) : "";
  const body = `<p class="eyebrow">${esc(e.section)}</p>
<div class="head">${kindTag(doc.kind)}<h1>${esc(e.id)}</h1>${chip("neutral", familySpec(e.family).name.replace(/^./, (c) => c.toUpperCase()))}${trace}</div>
${definitionHtml(ctx, e, path)}
<p class="small muted">Defined in <a href="${rel(path, pageFor(e.doc))}#L${e.line}" class="mono">${esc(e.doc)}:${e.line}</a>${doc.source ? `, read from <span class="mono">${esc(doc.source.ref)}</span>` : ""}.</p>
${fs.length ? `<h2>Findings</h2>${fs.map((f) => `<p>${chip(f.status === "accepted" ? "neutral" : f.severity, f.rule)} <a href="${rel(path, "drift.html")}#${esc(f.fingerprint)}">${esc(f.title)}</a>: ${inlineMd(f.message)}</p>`).join("")}` : ""}
<div class="cols"><section><h2>Cited by</h2>${traceList(path, ctx, into, "Nothing cites this ID in the provided documents.")}</section><section><h2>Cites</h2>${traceList(path, ctx, out, unresolved.length ? "No resolved citations." : "This ID cites no other ID.")}${dangling.length ? `<p class="small muted">Also names ${dangling.map((c) => `<code>${esc(c.id)}</code>`).join(", ")}, which nothing defines.</p>` : ""}${deferred.length ? `<p class="small muted">References to ${[...new Set(deferred.map((c) => c.id))].map((id) => `<code>${esc(id)}</code>`).join(", ")} were not checked because their target documents were not provided.</p>` : ""}</section></div>`;
  const epic = ctx.epics.find((x) => x.group === doc.group)!;
  return page({
    path,
    title: `${e.id} · ${doc.title}`,
    section: null,
    crumbs: [{ label: "Overview", href: "index.html" }, { label: epic.group, href: epicPage(epic.group) }, { label: `${KIND[doc.kind]} · ${e.doc.split("/").pop()}`, href: pageFor(e.doc) }, { label: e.id }],
    body,
    source: ctx.source,
  });
}

const EXCERPT = 40;

/** A definition as the document shows it: table cells as a list, a heading with its section, an item with its sub-items. */
function definitionHtml(ctx: Ctx, e: Definition, path: string): string {
  const ids = ctx.idsAt(e.doc, path);
  const cells = e.cells ? Object.entries(e.cells) : [];
  if (cells.length > 1) return `<div class="def"><dl>${cells.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${inlineMd(v, [], ids(e.line))}</dd>`).join("")}</dl></div>`;
  const lines = ctx.lines.get(e.doc) ?? [];
  const block = blockAt(lines, e.line);
  const kind = ctx.docOf.get(e.doc)?.kind;
  const opts = { idsAt: ids, href: (u: string) => ctx.resolve(e.doc, path, u), lineAnchors: false, ...(kind ? { reader: readerFor(kind) } : {}) };
  const more = (shown: readonly Line[]) =>
    shown.length < block.length - 1 ? `<p class="cont muted"><a href="${rel(path, pageFor(e.doc))}#L${shown.at(-1)!.n + 1}">Continues in the document</a></p>` : "";
  if (block.length && isHeading(block[0]!.text)) {
    const body = block.slice(1, 1 + EXCERPT);
    return `<div class="def md"><p class="lead">${inlineMd(gist(e), [], ids(e.line))}</p>${renderMarkdown(body, opts)}${more(body)}</div>`;
  }
  if (block.length > 1) return `<div class="def md">${renderMarkdown(itemBody(block.slice(0, EXCERPT + 1)), opts)}${more(block.slice(1, EXCERPT + 1))}</div>`;
  return `<div class="def md"><p>${inlineMd(e.text.replace(/\s+/g, " ").trim(), [], ids(e.line))}</p></div>`;
}

function findingsHtml(ctx: Ctx): string {
  const path = "drift.html";
  const fails = ctx.open.filter((f) => f.severity === "fail");
  const warnRules = [...new Set(ctx.open.filter((f) => f.severity === "warn").map((f) => f.rule))].sort();
  const accepted = ctx.findings.filter((f) => f.status === "accepted");
  const failRules = [...new Set(fails.map((f) => f.rule))].sort();
  const section = (rule: string, fs: readonly Finding[]) =>
    `<section data-browse-group><div class="browse-group-head"><h2 id="rule-${esc(rule)}">${chip(fs[0]!.severity, rule)} ${esc(fs[0]!.title)}</h2><span data-group-count>${fs.length}</span></div>${fs.map((f) => findingCard(ctx, path, f, true)).join("\n")}</section>`;
  const body = `${workspaceHead(ctx, "Findings", `${plural(ctx.open.length, "open finding")} · ${fails.length} blocking · ${ctx.open.length - fails.length} warnings`)}
${scopeNotes(ctx.epics)}
${ctx.open.length === 0 ? `<div class="workspace-empty">${icon("check")}<h2>No open findings.</h2><p>${accepted.length ? "Accepted findings are below, with their reasons." : "No findings in the provided documents."}</p></div>` : ""}
${ctx.findings.length ? `<div data-browser="findings">${browseControls("findings", [
  { key: "all", label: "All", count: ctx.findings.length },
  { key: "fail", label: "Blocking", count: fails.length },
  { key: "warn", label: "Warnings", count: ctx.open.length - fails.length },
  { key: "accepted", label: "Accepted", count: accepted.length },
])}<div id="browse-results">
${failRules.map((r) => section(r, fails.filter((f) => f.rule === r))).join("\n")}
${warnRules.map((r) => section(r, ctx.open.filter((f) => f.rule === r))).join("\n")}
${accepted.length ? `<section data-browse-group><div class="browse-group-head"><h2 id="accepted">Accepted with a reason</h2><span data-group-count>${accepted.length}</span></div>${accepted.map((f) => findingCard(ctx, path, f, true)).join("\n")}</section>` : ""}</div>${browseEmpty}</div>` : ""}`;
  return page({ path, title: "Findings", section: "findings", body, source: ctx.source, workspace: true });
}

function docsHtml(ctx: Ctx): string {
  const path = "docs.html";
  const body = `${workspaceHead(ctx, "Documents", `${plural(ctx.index.docs.length, "document")} · ${plural(ctx.index.entries.length, "ID")}`)}
${ctx.index.docs.length ? `<div data-browser="documents">${browseControls("documents", [
  { key: "all", label: "All", count: ctx.index.docs.length },
  ...DOC_KINDS.filter((kind) => hasKind(ctx.index.docs, kind)).map((kind) => ({ key: kind, label: kind === "tcs" ? "Tests" : KIND[kind], count: ctx.index.docs.filter((d) => d.kind === kind).length })),
])}<div id="browse-results">
${ctx.epics
  .map(
    (e) => `<section data-browse-group><div class="browse-group-head"><h2><a href="${rel(path, epicPage(e.group))}">${esc(e.title)}</a></h2><span class="mono muted">${esc(e.group)}</span><span data-group-count>${e.docs.length}</span></div><ul class="doc-grid">${e.docs
      .map((d) => {
        const ids = ctx.index.entries.filter((x) => x.doc === d.path).length;
        const open = ctx.open.filter((f) => f.citations.some((c) => c.doc === d.path));
        const source = ctx.feature?.feature.sources.find((s) => s.docs.includes(d.path));
        return `<li data-item data-category="${d.kind}"><a class="doc-card ${d.kind}" href="${rel(path, pageFor(d.path))}"><header><span class="doc-symbol">${icon("docs")}</span>${kindTag(d.kind)}</header><p class="eyebrow">${KIND_NAME[d.kind]}</p><h3>${esc(d.title)}</h3><p class="doc-path">${esc(d.path)}</p><p class="doc-revision">${source?.pull ? `${esc(source.pull.repo)}#${source.pull.number} · ${esc(source.pull.state)}<br>` : ""}${d.source ? `${esc(d.source.ref)} · <span class="mono">${esc(d.source.commit.slice(0, 7))}</span>` : ctx.source}</p><footer><span>${plural(ids, "ID")}</span>${open.length ? chip(open.some((f) => f.severity === "fail") ? "fail" : "warn", plural(open.length, "finding")) : '<span>No open findings</span>'}${icon("arrow")}</footer></a></li>`;
      })
      .join("")}</ul></section>`,
  )
  .join("\n")}</div>${browseEmpty}</div>` : `<div class="workspace-empty">${icon("docs")}<h2>No documents yet</h2><p>Add a PRD, technical design or test case file to the report.</p></div>`}`;
  return page({ path, title: "Documents", section: "docs", body, source: ctx.source, workspace: true });
}

/** The agent-note switch: shows or hides every folded note on the page, and remembers the choice. */
const notesSwitch = (n: number) =>
  `<button class="switch" type="button" role="switch" aria-checked="false" hidden data-notes-toggle title="Tests, free choices and the reading guide, written for the agent. ${plural(n, "note")} folded on this page."><span class="track" aria-hidden="true"><span class="knob"></span></span>Agent notes <span class="n">${n}</span></button>`;

/** The heading shared by both views of a document, with the Rendered | Source switch. */
function docHead(ctx: Ctx, src: SourceDoc, view: "rendered" | "source", path: string, notes = 0): string {
  const doc = ctx.docOf.get(src.path);
  const mine = ctx.index.entries.filter((x) => x.doc === src.path);
  const seg = (label: string, to: string, on: boolean) => `<a href="${rel(path, to)}" data-keep-hash${on ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<div class="dochead">${doc ? kindTag(doc.kind) : ""}<p class="eyebrow mono">${esc(src.path)}${doc?.source ? ` · ${esc(doc.source.ref)}@${esc(doc.source.commit.slice(0, 7))}` : ""}</p>
${notes ? notesSwitch(notes) : ""}<nav class="seg" aria-label="View">${seg("Rendered", pageFor(src.path), view === "rendered")}${seg("Source", sourcePageFor(src.path), view === "source")}</nav></div>
<details><summary class="small">${plural(mine.length, "ID")} defined here</summary><div class="idchips">${mine.map((e) => refLink(path, e)).join("")}</div></details>`;
}

interface TocNode {
  readonly h: OutlineHeading;
  readonly kids: TocNode[];
}

/** The deepest heading level the section tree shows. */
const TOC_DEPTH = 4;

/**
 * A document's sections as a tree, like a file tree: a section with subsections folds. The title
 * heading is the root. `target` is the anchor a section links to on this view.
 */
function toc(headings: readonly OutlineHeading[], target: (h: OutlineHeading) => string): string {
  const [first] = headings;
  const title = first?.level === 1 ? first : undefined;
  const roots: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const h of headings) {
    if (h === title || h.level > TOC_DEPTH) continue;
    const node = { h, kids: [] };
    while (stack.length && stack.at(-1)!.h.level >= h.level) stack.pop();
    (stack.at(-1)?.kids ?? roots).push(node);
    stack.push(node);
  }
  if (!roots.length) return "";
  const plain = (s: string) => s.replace(/[`*_]|\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
  // A heading's own links would nest inside the tree's link, so the label keeps only their text.
  const label = (h: OutlineHeading) => renderInline(h.text).replace(/<\/?a\b[^>]*>/g, "");
  const link = (h: OutlineHeading) => `<a href="#${esc(target(h))}" data-toc="${esc(target(h))}" title="${esc(plain(h.text))}">${label(h)}</a>`;
  const item = (n: TocNode): string =>
    n.kids.length ? `<li><details open><summary>${link(n.h)}</summary><ul>${n.kids.map(item).join("")}</ul></details></li>` : `<li>${link(n.h)}</li>`;
  const root = title ? `<a class="toc-root" href="#${esc(target(title))}" data-toc="${esc(target(title))}" title="${esc(plain(title.text))}">${label(title)}</a>` : "";
  return `<nav class="toc" aria-label="Sections">${root}<ul class="tree">${roots.map(item).join("")}</ul></nav>`;
}

function docPage(ctx: Ctx, src: SourceDoc, path: string, body: string, sections = ""): string {
  const doc = ctx.docOf.get(src.path);
  return page({
    path,
    title: doc?.title ?? src.path,
    section: "docs",
    crumbs: [{ label: "Documents", href: "docs.html" }, ...(doc ? [{ label: doc.group, href: epicPage(doc.group) } as Crumb] : []), { label: src.path.split("/").pop()! }],
    body,
    source: ctx.source,
    ...(sections ? { aside: sections } : {}),
  });
}

/** The section tree for both views: in the sidebar on wide screens, folded above the document on narrow ones. */
function sectionsOf(headings: readonly OutlineHeading[], target: (h: OutlineHeading) => string): { aside: string; inline: string } {
  const aside = toc(headings, target);
  if (!aside) return { aside: "", inline: "" };
  return { aside, inline: `<details class="toc-inline"><summary>Contents</summary>${aside}</details>` };
}

function renderedHtml(ctx: Ctx, src: SourceDoc): string {
  const path = pageFor(src.path);
  const doc = ctx.docOf.get(src.path);
  const lines = ctx.lines.get(src.path)!;
  const article = renderMarkdown(lines, {
    idsAt: ctx.idsAt(src.path, path),
    anchorsAt: (n) => ctx.defsAt(src.path, n).map((e) => e.id),
    href: (u) => ctx.resolve(src.path, path, u),
    ...(doc ? { reader: readerFor(doc.kind) } : {}),
  });
  const notes = (article.match(/<div class="an(?: solo)?">/g) ?? []).length + (article.match(/<details class="agent guide"/g) ?? []).length;
  const h1 = lines.some((l) => /^ {0,3}#\s/.test(l.text)) ? "" : `<h1>${esc(doc?.title ?? src.path)}</h1>`;
  const sections = sectionsOf(outline(lines, doc ? { reader: readerFor(doc.kind) } : {}), (h) => h.slug);
  return docPage(ctx, src, path, `${docHead(ctx, src, "rendered", path, notes)}\n${sections.inline}<article class="md">${h1}\n${article}\n</article>`, sections.aside);
}

function sourceHtml(ctx: Ctx, src: SourceDoc): string {
  const path = sourcePageFor(src.path);
  const doc = ctx.docOf.get(src.path);
  const ids = ctx.idsAt(src.path, path);
  const lines = ctx.lines.get(src.path)!.map(({ n, text }) => {
    let html = esc(text);
    // Link each cited or defined ID to its ID page. IDs survive escaping unchanged.
    for (const [id, href] of ids(n) ?? []) {
      html = html.replace(new RegExp(`(?<![\\w#/-])${id.replace(/\./g, "\\.")}(?![\\w-]|\\.\\d)`, "g"), `<a href="${href}">${id}</a>`);
    }
    const d = ctx.defsAt(src.path, n);
    const anchors = d.map((e) => `<span id="${esc(e.id)}"></span>`).join("");
    return `<div class="ln${d.length ? " d" : ""}" id="L${n}"><a class="n" href="#L${n}" aria-label="Line ${n}">${n}</a><span>${anchors}${html || " "}</span></div>`;
  });
  const sections = sectionsOf(outline(ctx.lines.get(src.path)!), (h) => `L${h.n}`);
  const body = `${docHead(ctx, src, "source", path)}
<h1>${esc(doc?.title ?? src.path)} <span class="muted small">source</span></h1>
${sections.inline}<div class="source-view">\n${lines.join("\n")}\n</div>`;
  return docPage(ctx, src, path, body, sections.aside);
}

export function renderSite(index: SpecIndex, sources: readonly SourceDoc[], findings: readonly Finding[], feature?: FeatureView): Map<string, string> {
  const textAt = new Map<string, string>();
  for (const e of index.entries) textAt.set(`${e.doc}:${e.line}`, gist(e));
  for (const s of index.scope_rows) textAt.set(`${s.doc}:${s.line}`, oneLine(s.text));
  const lines = new Map(sources.map((s) => [s.path as string, toLines(s.text)]));
  const byKey = new Map(index.entries.map((e) => [e.key as string, e]));
  // Per document and line: the IDs to link (citations that resolve, and definitions) and the definitions.
  const linkAt = new Map<string, Map<number, Map<string, Definition>>>();
  const defs = new Map<string, Map<number, Definition[]>>();
  const at = <T>(m: Map<string, Map<number, T>>, doc: string, n: number, make: () => T): T => {
    const d = m.get(doc) ?? m.set(doc, new Map()).get(doc)!;
    return d.get(n) ?? d.set(n, make()).get(n)!;
  };
  for (const c of index.citations) if (c.to && byKey.has(c.to)) at(linkAt, c.doc, c.line, () => new Map()).set(c.id, byKey.get(c.to)!);
  for (const e of index.entries) {
    at(linkAt, e.doc, e.line, () => new Map()).set(e.id, e);
    at(defs, e.doc, e.line, () => []).push(e);
  }
  const slugs = new Map([...lines].map(([doc, ls]) => [doc, headingSlugs(ls)]));
  const ctx: Ctx = {
    index,
    findings,
    open: findings.filter((f) => f.status === "open"),
    byKey,
    docOf: new Map(index.docs.map((d) => [d.path as string, d])),
    textAt,
    lineAt: (doc, line) => lines.get(doc)?.[line - 1]?.text ?? "",
    lines,
    idsAt: (doc, from) => (n) => {
      const m = linkAt.get(doc)?.get(n);
      return m && new Map([...m].map(([id, def]) => [id, rel(from, idPage(def))]));
    },
    defsAt: (doc, n) => defs.get(doc)?.get(n) ?? [],
    resolve: (doc, from, url) => {
      const [p = "", frag = ""] = url.split("#");
      let target = doc;
      try {
        target = p ? posix.normalize(posix.join(posix.dirname(doc), decodeURI(p))) : doc;
      } catch {
        return undefined;
      }
      const known = slugs.get(target);
      if (!known) return undefined;
      const f = frag && (known.has(frag) || /^L\d+$/.test(frag)) ? `#${frag}` : "";
      return p ? rel(from, pageFor(target)) + f : f || undefined;
    },
    epics: epics(index, findings),
    source: feature ? esc(feature.feature.spec.name) : sourceLabel(index),
    ...(feature ? { feature } : {}),
  };
  const reqOf = new Map(ctx.epics.flatMap((e) => e.requirements.map((r) => [r.entry.key as string, r])));

  const files = new Map<string, string>();
  files.set("index.html", overview(ctx));
  files.set("drift.html", findingsHtml(ctx));
  files.set("docs.html", docsHtml(ctx));
  for (const e of ctx.epics) files.set(epicPage(e.group), epicHtml(ctx, e));
  for (const e of index.entries) files.set(idPage(e), idHtml(ctx, e, reqOf.get(e.key)));
  for (const src of sources) {
    files.set(pageFor(src.path), renderedHtml(ctx, src));
    files.set(sourcePageFor(src.path), sourceHtml(ctx, src));
  }
  return new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
