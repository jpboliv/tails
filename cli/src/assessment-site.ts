// Evidence-first implementation report. A conformance verdict is separate from verification status.
import { OUTCOME_LABEL, prKey, type Assessment, type SpecEvidence } from "./assessment.js";
import { assessedRequirements, type AssessmentRun } from "./feature-assessments.js";
import { chip, esc, page, type Tone } from "./html.js";
import type { SpecIndex } from "./model.js";
import { shortHash } from "./util.js";

const anchor = (key: string) => `r-${shortHash([key])}`;
const tone = (outcome: string): Tone => outcome === "met" ? "ok" : ["missing", "deviates", "mixed"].includes(outcome) ? "warn" : "neutral";
const label = (outcome: string) => OUTCOME_LABEL[outcome as keyof typeof OUTCOME_LABEL] ?? (outcome === "mixed" ? "Mixed PR outcomes" : "Not assessed at current revisions");
const list = (items: readonly string[]) => items.length ? `<ul>${items.map((s) => `<li>${s}</li>`).join("")}</ul>` : "<p>None.</p>";
const outbound = (url: string, text: string) => `<a href="${esc(url)}" rel="noopener noreferrer nofollow">${esc(text)}</a>`;
const encodedPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

function specEvidence(a: Assessment, e: SpecEvidence): string {
  const s = a.sources.find((s) => s.key === e.source)!;
  const location = `${s.location}${e.line ? `:${e.line}` : ""} @ ${s.revision}`;
  const url = /^https?:\/\//.test(s.location) ? s.location
    : /^[\w.-]+\/[\w.-]+\/.+/.test(s.location) && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(s.revision)
      ? `https://github.com/${s.location.split("/").slice(0, 2).join("/")}/blob/${s.revision}/${encodedPath(s.location.split("/").slice(2).join("/"))}${e.line ? `#L${e.line}` : ""}` : null;
  return `<p>${url ? outbound(url, location) : esc(location)}</p><blockquote>${esc(e.quote)}</blockquote>`;
}

export function assessmentSummary(runs: readonly AssessmentRun[]): string {
  const latest = runs.filter((r) => !r.superseded);
  return `<section><h2>Implementation assessments</h2><p>${latest.length} latest assessments · ${latest.filter((r) => r.freshness === "current").length} at current revisions · ${latest.filter((r) => r.freshness === "outdated").length} outdated · ${latest.filter((r) => r.freshness === "unverified").length} with unverified inputs.</p><a class="action" href="conformance.html">Review implementation evidence</a></section>`;
}

export function conformancePage(index: SpecIndex, runs: readonly AssessmentRun[], name: string, linkedPrs: readonly string[]): string {
  const rows = assessedRequirements(index, runs);
  const summaries = rows.map((row) => `<tr><td>${esc(row.id)}</td><td class="req">${esc(row.text)}<br><small>${esc(row.source)}</small></td><td>${chip(tone(row.outcome), label(row.outcome))}</td><td>${row.evidence.map((e) => `<a href="#${e.run}-${anchor(e.result.key)}">${esc(e.pr)}</a>`).join(" · ") || "—"}</td></tr>`).join("");
  const assessedPrs = new Set(runs.filter((r) => !r.superseded && r.freshness === "current" && r.assessment.overall !== "cannot_check").map((r) => prKey(r.assessment.pr)));
  const pendingPrs = linkedPrs.filter((p) => !assessedPrs.has(p));
  const runHtml = runs.map((run) => {
    const a = run.assessment;
    const verdict = { conforms: "Conforms — no decisions needed", does_not_conform: `Does not conform — ${a.decisions.length} decisions needed`, cannot_check: "Cannot check" }[a.overall];
    const resultRows = a.results.map((r) => `<details id="${run.id}-${anchor(r.key)}"><summary>${esc(r.id)} · ${esc(r.requirement)} · ${chip(tone(r.verdict), label(r.verdict))}</summary>
      ${specEvidence(a, r.spec)}
      ${list(r.code.map((c) => `${outbound(`https://github.com/${a.pr.repo}/blob/${a.pr.head_sha}/${encodedPath(c.path)}#L${c.line}`, `${c.path}:${c.line}`)}<pre>${esc(c.quote)}</pre>`))}
      <p>${esc(r.note)}${r.moved_to ? ` Moved to ${esc(r.moved_to)}.` : ""}</p>
      ${list([...r.decision_ids.map((id) => `<a href="#${run.id}-${anchor(id)}">Decision ${esc(id)}</a>`), ...r.defect_ids.map((id) => `<a href="#${run.id}-${anchor(id)}">Spec defect ${esc(id)}</a>`)])}</details>`).join("");
    const decisions = a.decisions.map((d) => `<article class="finding warn" id="${run.id}-${anchor(d.id)}"><h4>${esc(d.id)} · ${esc(d.kind)} · ${d.declared ? "Declared" : "Not declared"}</h4>
      <p><strong>Spec says:</strong> ${esc(d.spec_says)}</p><p><strong>PR does:</strong> ${esc(d.pr_does)}</p><p><strong>Impact:</strong> ${esc(d.impact)}</p>
      <p><strong>Option A — change the PR:</strong> ${esc(d.change_pr)}</p><p><strong>Option B — update the specs:</strong></p>${list(d.update_specs.map((u) => `${esc(u.source)}: ${esc(u.change)}`))}
      <p><strong>Who decides:</strong> ${esc(d.who_decides)}</p>${list(d.documentation_prs.map((u) => /^https?:\/\//.test(u) ? outbound(u, u) : esc(u)))}</article>`);
    const defects = a.spec_defects.map((d) => `<article class="finding info" id="${run.id}-${anchor(d.id)}"><h4>${esc(d.id)} · ${esc(d.kind)}</h4><p>${esc(d.message)}</p>${d.evidence.map((e) => specEvidence(a, e)).join("")}<p>${esc(d.suggested_change)}</p></article>`);
    return `<section id="run-${run.id}"><h2>${esc(prKey(a.pr))} · ${esc(a.checked_at)}</h2>
      <p>${chip(run.freshness === "current" ? "info" : "warn", run.freshness)} ${run.superseded ? chip("neutral", "Superseded") : ""} ${esc(a.checker.name)} @ ${esc(a.checker.version)}</p>
      ${list(run.reasons.map(esc))}<h3>${esc(verdict)}</h3><p>${esc(a.summary)}</p>
      <p><strong>Scope (${esc(a.scope.basis)}):</strong> ${esc(a.scope.description)} · ${esc(a.scope.tickets.join(", ") || "No ticket")}</p>
      <p><strong>Reviewed code:</strong> ${esc(a.pr.head_sha)}</p>
      <h3>Sources</h3>${list(a.sources.map((s) => `${esc(s.purpose)} · ${esc(s.kind)} · ${esc(s.location)} @ ${esc(s.revision)}`))}
      <h3>Requirements</h3>${resultRows || "<p>No requirement verdicts.</p>"}
      <h3>Decisions needed</h3>${decisions.join("") || "<p>None.</p>"}
      <h3>Spec defects</h3>${defects.join("") || "<p>None.</p>"}
      <h3>Manual checks</h3>${list(a.manual_checks.map((m) => `${esc(m.result)} — ${esc(m.check)} · Where: ${esc(m.where)} · Expected: ${esc(m.expected)}`))}
      <h3>Not checked</h3>${list(a.not_checked.map((n) => `${esc(n.source)}: ${esc(n.reason)}`))}
      ${run.report === null ? "" : `<details><summary>Original review (Markdown)</summary><pre>${esc(run.report)}</pre></details>`}</section>`;
  }).join("");
  return page({ path: "conformance.html", title: "Implementation assessments", section: null, source: esc(name), crumbs: [{ label: "Overview", href: "index.html" }, { label: "Implementation assessments" }], body:
    `<h1>Implementation assessments</h1><p>Conforms means no decisions are needed. Manual checks, blocked requirements and spec defects remain visible. Evidence describes reviewed PR scopes, not deployment or whole-feature completion.</p>
    <p>${rows.filter((r) => r.outcome === "met").length} of ${rows.length} indexed or reviewed requirements have Met outcomes in current assessments. ${pendingPrs.length} linked PRs need a current, checkable assessment.</p>
    ${list(pendingPrs.map(esc))}
    <p>Only current, latest assessments contribute to the breakdown. Unknown source revisions remain unverified; mixed PR outcomes retain every assessment.</p>
    <div class="tablewrap"><table class="ledger"><thead><tr><th>ID</th><th>Requirement</th><th>Current evidence</th><th>PR scope</th></tr></thead><tbody>${summaries}</tbody></table></div>
    ${runs.length ? runHtml : "<p>No assessments imported. Prepare a conformance task with <code>tails feature prepare</code>, run it in your agent, then use <code>tails feature import</code>.</p>"}` });
}
