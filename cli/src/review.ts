// Spec PR review: what a spec PR changes between two commits, written for the person who
// approves it. The markdown is a PR check summary: blockers first, with the lines that
// disagree quoted, then the in-flight work a change reaches, then the full ID diff.
import { adviceFor, citeLabel, QUOTES, ROLE_NAME, type Finding } from "./drift.js";
import type { Definition, SpecIndex } from "./model.js";
import { closeSpans, compareBy, gist, oneLine, openSpans, plural, wordDiff } from "./util.js";

/** Something that stops the PR merging. */
export type Blocker =
  | { readonly kind: "renumbered"; readonly was: Definition; readonly now: Definition }
  | { readonly kind: "reused"; readonly id: Definition; readonly oldTextNow: Definition }
  | { readonly kind: "finding"; readonly finding: Finding };

/** A changed or removed ID, and the places in the head spec that still cite it. */
export interface Impact {
  readonly entry: Definition;
  readonly change: "changed" | "removed";
  readonly citedBy: readonly { readonly id: string; readonly doc: string; readonly line: number }[];
}

export interface Review {
  readonly added: readonly Definition[];
  readonly changed: readonly Definition[];
  /** The base version of each changed ID, by key. */
  readonly before: ReadonlyMap<string, Definition>;
  readonly removed: readonly Definition[];
  readonly opened: readonly Finding[];
  readonly resolved: readonly Finding[];
  /** Findings this change marks accepted in `.tails/accepted.yml`: waived, not fixed. */
  readonly accepted: readonly Finding[];
  readonly newQuestions: readonly Definition[];
  readonly impact: readonly Impact[];
  readonly blockers: readonly Blocker[];
  /** One line per blocker. Empty means the review passes. */
  readonly failures: readonly string[];
}

/** Base documents the head renamed: each to the new document of its kind that keeps most of its IDs unchanged. */
function renames(base: SpecIndex, head: SpecIndex): Map<string, string> {
  const inBase = new Set(base.docs.map((d) => d.path as string));
  const inHead = new Set(head.docs.map((d) => d.path as string));
  const sig = (e: Definition) => `${e.id}\t${e.text_hash}`;
  const out = new Map<string, string>();
  for (const old of base.docs.filter((d) => !inHead.has(d.path))) {
    const was = new Set(base.entries.filter((e) => e.doc === old.path).map(sig));
    const score = (doc: string) => head.entries.filter((e) => e.doc === doc && was.has(sig(e))).length;
    const [best] = head.docs
      .filter((d) => d.kind === old.kind && !inBase.has(d.path) && ![...out.values()].includes(d.path) && score(d.path) > 0)
      .sort(compareBy((d) => -score(d.path), (d) => d.path));
    if (best) out.set(old.path, best.path);
  }
  return out;
}

export function review(base: SpecIndex, head: SpecIndex, baseFindings: readonly Finding[], headFindings: readonly Finding[]): Review {
  const moved = renames(base, head);
  const keyOf = (e: Definition) => (moved.has(e.doc) && e.key.startsWith(`${e.doc}#`) ? `${moved.get(e.doc)}#${e.id}` : (e.key as string));
  const b = new Map(base.entries.map((e) => [keyOf(e), e]));
  const h = new Map(head.entries.map((e) => [e.key as string, e]));
  const order = compareBy<Definition>((e) => e.doc, (e) => e.line);
  const added = head.entries.filter((e) => !b.has(e.key)).sort(order);
  const removed = base.entries.filter((e) => !h.has(keyOf(e))).sort(order);
  const changed = head.entries.filter((e) => b.has(e.key) && b.get(e.key)!.text_hash !== e.text_hash).sort(order);
  // Text moves only to an ID this change adds. An ID that was already there with the same words
  // (two "TBD." placeholders) is a coincidence, not a renumber.
  const addedByHash = new Map(added.map((e) => [e.text_hash as string, e]));

  const blockers: Blocker[] = [];
  for (const r of removed) {
    const now = addedByHash.get(r.text_hash);
    // The same ID with the same text in another document is a move, not a renumber.
    if (now && now.id !== r.id) blockers.push({ kind: "renumbered", was: r, now });
  }
  for (const c of changed) {
    const oldTextNow = addedByHash.get(b.get(c.key)!.text_hash);
    if (oldTextNow && oldTextNow.key !== c.key) blockers.push({ kind: "reused", id: c, oldTextNow });
  }
  const baseFp = new Set(baseFindings.filter((f) => f.status === "open").map((f) => f.fingerprint));
  const headFp = new Set(headFindings.filter((f) => f.status === "open").map((f) => f.fingerprint));
  const baseAccepted = new Set(baseFindings.filter((f) => f.status === "accepted").map((f) => f.fingerprint));
  const accepted = headFindings.filter((f) => f.status === "accepted" && !baseAccepted.has(f.fingerprint));
  const acceptedFp = new Set(accepted.map((f) => f.fingerprint));
  const opened = headFindings.filter((f) => f.status === "open" && !baseFp.has(f.fingerprint));
  const resolved = baseFindings.filter((f) => f.status === "open" && !headFp.has(f.fingerprint) && !acceptedFp.has(f.fingerprint));
  for (const f of opened.filter((x) => x.severity === "fail")) blockers.push({ kind: "finding", finding: f });

  // A requirement that changes under work that cites it is the cross-PR signal: that work may be stale.
  const citers = (entry: Definition, removed = false) =>
    head.citations
      .filter((c) => c.from && c.from !== entry.key && (c.to === keyOf(entry) || (
        removed && c.to === null && c.id === entry.id &&
        base.docs.find((d) => d.path === entry.doc)?.group === head.docs.find((d) => d.path === c.doc)?.group
      )))
      .map((c) => ({ id: h.get(c.from as string)?.id ?? c.from!.split("#").pop()!, doc: c.doc, line: c.line }))
      .filter((c, i, all) => all.findIndex((x) => x.id === c.id && x.doc === c.doc) === i);
  const impact: Impact[] = [
    ...changed.map((entry) => ({ entry, change: "changed" as const, citedBy: citers(entry) })),
    ...removed.filter((r) => !addedByHash.has(r.text_hash)).map((entry) => ({ entry, change: "removed" as const, citedBy: citers(entry, true) })),
  ].filter((i) => i.citedBy.length > 0);

  return {
    added,
    changed,
    before: new Map(changed.map((c) => [c.key as string, b.get(c.key)!])),
    removed,
    opened,
    resolved,
    accepted,
    newQuestions: added.filter((e) => e.family === "Q"),
    impact,
    blockers,
    failures: blockers.map(blockerLine),
  };
}

function blockerLine(x: Blocker): string {
  switch (x.kind) {
    case "renumbered":
      return `${x.was.id} was renumbered to ${x.now.id} (${x.now.doc}:${x.now.line}). IDs are stable; keep ${x.was.id}.`;
    case "reused":
      return `${x.id.id} now means something else; its old text moved to ${x.oldTextNow.id}. Do not reuse IDs.`;
    case "finding":
      return `New open ${x.finding.rule} ${x.finding.title}: ${x.finding.message}`;
  }
}

export interface ReviewContext {
  readonly base: string;
  readonly head: string;
  /** Refs layered under both sides (`--with`). */
  readonly with?: readonly string[];
  /** The head index, to quote the lines a finding cites. */
  readonly index: SpecIndex;
  /** True when `.tails.yml` differs between base and head, so the rules read the spec differently. */
  readonly configChanged?: boolean;
}


/** What changed in a row, with a few words of context: ~~removed~~ and **added**. */
function delta(before: Definition, after: Definition): string {
  const parts = wordDiff(gist(before), gist(after));
  const CONTEXT = 4;
  return parts
    .map((p, n) => {
      if (p.op === "del") return `~~${p.text}~~`;
      if (p.op === "add") return `**${p.text}**`;
      const w = p.text.split(" ");
      if (w.length <= CONTEXT * 2) return p.text;
      const head = n > 0 ? closeSpans(w.slice(0, CONTEXT).join(" ")) : "";
      const tail = n < parts.length - 1 ? openSpans(w.slice(-CONTEXT).join(" ")) : "";
      return [head, "…", tail].filter(Boolean).join(" ");
    })
    .join(" ")
    .replace(/\|/g, "\\|");
}

export function reviewMarkdown(r: Review, ctx: ReviewContext): string {
  const byPlace = new Map<string, string>();
  for (const e of ctx.index.entries) byPlace.set(`${e.doc}:${e.line}`, gist(e));
  for (const s of ctx.index.scope_rows) byPlace.set(`${s.doc}:${s.line}`, oneLine(s.text));
  const docs = new Set([...r.added, ...r.changed, ...r.removed].map((e) => e.doc));
  const warnings = r.opened.filter((f) => f.severity === "warn");
  const out: string[] = [];
  const range = `\`${ctx.base}\` → \`${ctx.head}\`${ctx.with?.length ? `, read with ${ctx.with.map((w) => `\`${w}\``).join(", ")}` : ""}`;

  out.push(
    r.blockers.length === 0
      ? `## ✅ tails: no spec conflicts`
      : `## ❌ tails: ${plural(r.blockers.length, "thing")} to fix before merge`,
    "",
    `${range}. This change adds ${plural(r.added.length, "ID")}, changes ${r.changed.length} and removes ${r.removed.length}` +
      ` across ${plural(docs.size, "document")}. It opens ${plural(warnings.length, "warning")} and resolves ${plural(r.resolved.length, "finding")}.`,
    "",
  );
  if (ctx.configChanged) out.push("> [!WARNING]", "> This change edits `.tails.yml`, so tails reads the spec with different settings than the base. Check that diff too.", "");

  if (r.blockers.length) {
    out.push("### Fix before merge", "");
    r.blockers.forEach((x, n) => {
      if (x.kind === "finding") {
        const f = x.finding;
        out.push(`**${n + 1}. ${f.title}** (${f.rule}): ${f.message}`, "");
        for (const c of f.citations.slice(0, QUOTES)) {
          out.push(`> **${ROLE_NAME[c.role]} · ${citeLabel(c)}** · \`${c.doc}:${c.line}\`  `, `> ${byPlace.get(`${c.doc}:${c.line}`) ?? oneLine(c.what)}`, "");
        }
        const rest = f.citations.slice(QUOTES);
        if (rest.length) out.push(`Also cited: ${rest.map((c) => `${citeLabel(c)} (\`${c.doc}:${c.line}\`)`).join(", ")}.`, "");
        out.push(`**What to do:** ${adviceFor(f.rule)} To accept it, add \`${f.fingerprint}\` with the reason to \`.tails/accepted.yml\`.`, "");
      } else if (x.kind === "renumbered") {
        out.push(`**${n + 1}. ${x.was.id} was renumbered to ${x.now.id}** (\`${x.now.doc}:${x.now.line}\`)`, "", `> ${gist(x.now)}`, "");
        out.push(`**What to do:** Keep \`${x.was.id}\`. Other PRs, tests and code cite IDs, and a renumbered ID silently points them somewhere else.`, "");
      } else {
        out.push(`**${n + 1}. ${x.id.id} now means something else** (\`${x.id.doc}:${x.id.line}\`); its old text moved to ${x.oldTextNow.id}.`, "", `> ${gist(x.id)}`, "");
        out.push(`**What to do:** Give the new requirement a new ID and keep \`${x.id.id}\` on its old text.`, "");
      }
    });
  }

  if (r.accepted.length) {
    out.push("### Accepted in this change", "", "These findings are waived in `.tails/accepted.yml`, not fixed. Check that each reason holds.", "");
    for (const f of r.accepted) out.push(`- **${f.rule} ${f.title}**: ${f.message} Accepted by ${f.accepted!.by} on ${f.accepted!.date}: ${f.accepted!.reason}`);
    out.push("");
  }

  if (r.impact.length) {
    out.push(
      "### Work that cites what changed",
      "",
      "These IDs changed or went away, and other rows still cite them. Check that the work behind those rows still holds.",
      "",
      "| ID | What changed | Cited by |",
      "| --- | --- | --- |",
    );
    for (const i of r.impact) {
      const cited = i.citedBy.map((c) => `${c.id} (\`${c.doc}:${c.line}\`)`).join(", ");
      const what = i.change === "changed" && r.before.has(i.entry.key) ? delta(r.before.get(i.entry.key)!, i.entry) : "removed";
      out.push(`| **${i.entry.id}** \`${i.entry.doc}:${i.entry.line}\` | ${what} | ${cited} |`);
    }
    out.push("");
  }

  if (warnings.length) {
    out.push(`<details><summary><strong>New warnings (${warnings.length})</strong>: worth a look, they do not block</summary>`, "");
    for (const f of warnings) out.push(`- **${f.rule} ${f.title}**: ${f.message}`);
    out.push("", "</details>", "");
  }
  if (r.resolved.length) {
    out.push(`<details><summary>Resolved by this change (${r.resolved.length})</summary>`, "");
    for (const f of r.resolved) out.push(`- ${f.rule} ${f.title}: ${f.message}`);
    out.push("", "</details>", "");
  }
  if (r.newQuestions.length) {
    out.push("### New open questions", "");
    for (const q of r.newQuestions) out.push(`- **${q.id}** ${gist(q)} (\`${q.doc}:${q.line}\`)`);
    out.push("");
  }

  const diff = [
    ...r.added.map((e) => ["added", e] as const),
    ...r.changed.map((e) => ["changed", e] as const),
    ...r.removed.map((e) => ["removed", e] as const),
  ];
  if (diff.length) {
    out.push(`<details><summary>Every ID this change touches (${diff.length})</summary>`, "", "| Change | ID | Where | Text |", "| --- | --- | --- | --- |");
    for (const [change, e] of diff) {
      const old = change === "changed" ? r.before.get(e.key) : undefined;
      out.push(`| ${change} | **${e.id}** | \`${e.doc}:${e.line}\` | ${old ? delta(old, e) : gist(e).replace(/\|/g, "\\|")} |`);
    }
    out.push("", "</details>", "");
  }

  out.push(`<sub>tails review --base ${ctx.base} --head ${ctx.head}${(ctx.with ?? []).map((w) => ` --with ${w}`).join("")}</sub>`);
  return out.join("\n").trimEnd() + "\n";
}
