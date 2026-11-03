// Renders spec markdown as GitHub does, for the GFM subset cli/README.md lists, with line anchors.
// markdown.ts is the separate line reader the indexer uses to find IDs.
//
// Specs are untrusted input: a spec PR can carry any text. Every character of the source is
// escaped, raw HTML is shown as text (only a bare <br> becomes a line break, as in GitHub table
// cells), and links keep only http, https and mailto targets or targets the caller resolves.
//
// Each source line keeps an anchor, so a finding that cites doc.md:123 lands on the block that
// holds line 123: table rows and code lines carry id="L123" themselves, and other blocks hold an
// empty <span class="la" id="L123"> where the line starts. CSS highlights the block with :has().
//
// With a `reader`, the page is the reader view: reader.ts decides what folds, restyles or goes.
import { EXISTING_HTML, isBlocked, isGuide, matchNote, matchRecord, NOTE_LABEL, recordIds, stripComments, type Note, type NoteKind, type Reader } from "./reader.js";

export const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Line {
  readonly n: number;
  readonly text: string;
}

export interface MdOptions {
  /** Spec IDs to link on a source line, by ID. */
  readonly idsAt?: (line: number) => ReadonlyMap<string, string> | undefined;
  /** Extra anchors a source line carries, such as the IDs it defines. */
  readonly anchorsAt?: (line: number) => readonly string[];
  /** Resolves a relative link target. Undefined renders the label as plain text. */
  readonly href?: (url: string) => string | undefined;
  /** False leaves out the #L<n> anchors, for an excerpt shown on another page. */
  readonly lineAnchors?: boolean;
  /** Renders the reader view with these rules (reader.ts). */
  readonly reader?: Reader;
}

export interface InlineOptions {
  readonly ids?: ReadonlyMap<string, string>;
  readonly href?: (url: string) => string | undefined;
  /** Words to wrap in <mark>, such as the terms a finding matched. */
  readonly mark?: readonly string[];
  /** Turns line sentinels into anchors. */
  readonly anchor?: (n: number) => string;
}

const STASH = "\u0001";
const LINE = "\u0002";
const LABEL_OPEN = "\u0003";
const LABEL_CLOSE = "\u0004";
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Allowed link targets: web and mail, or whatever the caller resolves. Never javascript: or data:. */
function safeHref(url: string, resolve?: (url: string) => string | undefined): string | undefined {
  const u = url.trim().replace(/^<|>$/g, "");
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//")) return undefined;
  return resolve?.(u);
}

const ext = (href: string) => (/^(https?:|mailto:)/i.test(href) ? ` rel="noopener noreferrer nofollow"` : "");

export function renderInline(src: string, o: InlineOptions = {}): string {
  const stash: string[] = [];
  const put = (html: string) => `${STASH}${stash.push(html) - 1}${STASH}`;
  const hl = (html: string) =>
    !o.mark?.length ? html : html.replace(new RegExp(`\\b(${o.mark.map(reEsc).join("|")})\\w*`, "gi"), "<mark>$&</mark>");
  // A link label stays in the text so it gets emphasis, and sits between LABEL_OPEN and
  // LABEL_CLOSE so no ID link is nested inside it.
  const link = (href: string | undefined, label: string) => (href ? `${put(`<a href="${esc(href)}"${ext(href)}>`)}${LABEL_OPEN}${label}${LABEL_CLOSE}${put("</a>")}` : label);
  const whole = (href: string | undefined, html: string) => put(href ? `<a href="${esc(href)}"${ext(href)}>${html}</a>` : html);

  // The control characters the renderer uses as markers never come from the source.
  let s = src
    .replace(/[\u0001\u0003\u0004]/g, "\uFFFD")
    .replace(/(?: {2,}|\\)\n/g, () => put("<br>") + "\n")
    .replace(/\\([!-/:-@[-`{-~])/g, (_, ch: string) => put(esc(ch)))
    .replace(/(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g, (_, _t, code: string) => put(`<code>${hl(esc(code.replace(/\n/g, " ").replace(/^ (.*) $/, "$1")))}</code>`))
    .replace(/<((?:https?:|mailto:)[^\s<>]+)>/gi, (_, url: string) => whole(url, esc(url)))
    .replace(/<br\s*\/?>/gi, () => put("<br>"))
    .replace(/!\[([^\]]*)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g, (_, alt: string, url: string) => whole(safeHref(url, o.href), `<span class="img">Image: ${esc(alt || url)}</span>`))
    .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)(?:\s+"[^"]*")?\)/g, (_, label: string, url: string) => link(safeHref(url, o.href), label))
    .replace(/(^|[\s(])(https?:\/\/[^\s<>\u0001-\u0004]*[^\s<>\u0001-\u0004.,;:!?)"'\]])/g, (_, pre: string, url: string) => pre + whole(url, esc(url)));
  s = hl(esc(s))
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w])__(?=\S)([\s\S]*?\S)__(?!\w)/g, "$1<strong>$2</strong>")
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, "<del>$1</del>")
    .replace(/(^|[^*\w])\*(?=[^\s*])([\s\S]*?[^\s*])\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([\s\S]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>");
  if (o.ids?.size) {
    const ids = [...o.ids].sort(([a], [b]) => b.length - a.length);
    s = s
      .split(new RegExp(`(${LABEL_OPEN}[\\s\\S]*?${LABEL_CLOSE})`))
      .map((seg) => {
        if (seg.startsWith(LABEL_OPEN)) return seg;
        for (const [id, href] of ids) seg = seg.replace(new RegExp(`(?<![\\w#/-])${reEsc(id)}(?![\\w-]|\\.\\d)`, "g"), () => put(`<a class="idref" href="${esc(href)}">${esc(id)}</a>`));
        return seg;
      })
      .join("");
  }
  s = s.replace(new RegExp(`[${LABEL_OPEN}${LABEL_CLOSE}]`, "g"), "");
  const restore = (x: string): string => x.replace(new RegExp(`${STASH}(\\d+)${STASH}`, "g"), (_, i: string) => restore(stash[Number(i)] ?? ""));
  return restore(s).replace(new RegExp(`${LINE}(\\d+)${LINE}`, "g"), (_, n: string) => o.anchor?.(Number(n)) ?? "");
}

/** GitHub's heading slug: lower case, punctuation dropped, spaces to hyphens. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/`|\*\*|__|~~/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");
}

const RE = {
  blank: /^\s*$/,
  fence: /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)/,
  heading: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  quote: /^ {0,3}> ?/,
  item: /^( {0,3})([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*)|$)/,
  delim: /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/,
};

const indentOf = (s: string) => /^ */.exec(s.replace(/\t/g, "    "))![0].length;
const dedent = (s: string, n: number) => {
  const t = s.replace(/^\t+/, (m) => " ".repeat(4 * m.length));
  return t.slice(Math.min(n, indentOf(t)));
};

function tableCells(row: string): string[] {
  let s = row.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const out: string[] = [];
  let cur = "";
  for (let k = 0; k < s.length; k++) {
    const ch = s[k]!;
    if (ch === "\\" && s[k + 1] === "|") {
      cur += "|";
      k++;
    } else if (ch === "|") {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

const isTableStart = (ls: readonly Line[], i: number) => ls[i]!.text.includes("|") && i + 1 < ls.length && RE.delim.test(ls[i + 1]!.text) && ls[i + 1]!.text.includes("-");

function startsBlock(ls: readonly Line[], i: number): boolean {
  const t = ls[i]!.text;
  return RE.fence.test(t) || RE.heading.test(t) || RE.hr.test(t) || RE.quote.test(t) || RE.item.test(t) || isTableStart(ls, i);
}

const ALERTS: Record<string, string> = { NOTE: "Note", TIP: "Tip", IMPORTANT: "Important", WARNING: "Warning", CAUTION: "Caution" };

class Renderer {
  private readonly slugs = new Map<string, number>();
  /** The record whose item is being rendered, so its own ID is not repeated in its notes. */
  private rec: readonly string[] | undefined;
  /** Record IDs this document defines, which a note can link to in the page. */
  records: ReadonlySet<string> = new Set();
  constructor(private readonly o: MdOptions) {}

  private headingId(text: string): string {
    let s = slug(text) || "section";
    const seen = this.slugs.get(s) ?? 0;
    this.slugs.set(s, seen + 1);
    if (seen) s = `${s}-${seen}`;
    return s;
  }

  private heading(l: Line, level: number, text: string): string {
    const s = this.headingId(text);
    return `<h${level} id="${esc(s)}">${this.inline([l], `${this.sentinel(l.n)}${text}`)}<a class="hash" href="#${esc(s)}" aria-label="Link to this section">#</a></h${level}>`;
  }

  anchor = (n: number): string => {
    const ids = this.o.anchorsAt?.(n) ?? [];
    return (this.o.lineAnchors === false ? "" : `<span class="la" id="L${n}"></span>`) + ids.map((id) => `<span class="la" id="${esc(id)}"></span>`).join("");
  };

  private idsFor(lines: readonly number[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const n of lines) for (const [id, href] of this.o.idsAt?.(n) ?? []) m.set(id, href);
    return m;
  }

  inline(ls: readonly Line[], text?: string): string {
    const src = text ?? ls.map((l) => `${LINE}${l.n}${LINE}${l.text.trim()}`).join("\n");
    const html = renderInline(src, { ids: this.idsFor(ls.map((l) => l.n)), anchor: this.anchor, ...(this.o.href ? { href: this.o.href } : {}) });
    return this.o.reader?.has("existing") ? html.replace(EXISTING_HTML, `<span class="tag" title="Shipped behaviour this design relies on. No PR builds it.">Existing</span>`) : html;
  }

  private noteAt(text: string): Note | null {
    const note = this.o.reader ? matchNote(text) : null;
    return note && this.o.reader!.has(note.kind) ? note : null;
  }

  /** A run of agent notes, blank lines between them included, folded into one disclosure. */
  private notes(ls: readonly Line[], start: number, out: string[]): number {
    const rows: string[] = [];
    const kinds: NoteKind[] = [];
    const named: string[] = [];
    let i = start;
    for (;;) {
      const note = this.noteAt(ls[i]!.text)!;
      const para: Line[] = [{ n: ls[i]!.n, text: note.rest }];
      let j = i + 1;
      while (j < ls.length && !RE.blank.test(ls[j]!.text) && !startsBlock(ls, j)) para.push(ls[j++]!);
      const ids = this.rec && note.ids.every((id) => this.rec!.includes(id)) ? [] : note.ids;
      for (const id of ids) if (!named.includes(id)) named.push(id);
      const idHtml = ids.map((id) => (this.records.has(id) ? `<a href="#${esc(id)}">${esc(id)}</a>` : `<span>${esc(id)}</span>`)).join(" ");
      rows.push(`<div class="an"><p class="an-k">${NOTE_LABEL[note.kind]}${idHtml ? `<span class="an-ids">${idHtml}</span>` : ""}</p><div class="an-v">${this.blocks(para)}</div></div>`);
      kinds.push(note.kind);
      let k = j;
      while (k < ls.length && RE.blank.test(ls[k]!.text)) k++;
      if (k > j && k < ls.length && this.noteAt(ls[k]!.text) && !startsBlock(ls, k)) {
        if (this.o.lineAnchors !== false) for (let b = j; b < k; b++) rows.push(this.anchor(ls[b]!.n));
        i = k;
        continue;
      }
      const label = [...new Set(kinds)].map((kind) => NOTE_LABEL[kind]).join(" · ");
      const about = this.rec === undefined && named.length ? ` <span class="an-about">${esc(named.slice(0, 3).join(", "))}${named.length > 3 ? ` +${named.length - 3}` : ""}</span>` : "";
      // One note about its own record needs no label inside: the summary already names it.
      const body = kinds.length === 1 && !named.length ? rows.join("").replace(/^<div class="an"><p class="an-k">[^<]*<\/p>/, '<div class="an solo">') : rows.join("");
      out.push(`<details class="agent" data-agent><summary><span class="an-sum">${label}</span>${about}</summary><div class="agent-b">${body}</div></details>`);
      return j;
    }
  }

  /** The section that teaches the agent the record format, folded with its heading as the label. */
  private guide(ls: readonly Line[], start: number, level: number, text: string, out: string[]): number {
    let j = start + 1;
    let fence = false;
    for (; j < ls.length; j++) {
      const x = ls[j]!.text;
      if (RE.fence.test(x)) fence = !fence;
      const h = !fence && RE.heading.exec(x);
      if (h && h[1]!.length <= level) break;
    }
    out.push(`<details class="agent guide" data-agent><summary>${this.heading(ls[start]!, level, text)}<span class="an-sum">${NOTE_LABEL.guide}</span></summary><div class="agent-b">${this.blocks(ls.slice(start + 1, j))}</div></details>`);
    return j;
  }

  private sentinel = (n: number) => `${LINE}${n}${LINE}`;
  private lineId = (n: number) => (this.o.lineAnchors === false ? "" : ` id="L${n}"`);

  blocks(ls: readonly Line[], tight = false): string {
    const out: string[] = [];
    let i = 0;
    while (i < ls.length) {
      const l = ls[i]!;
      const t = l.text;
      if (RE.blank.test(t)) {
        if (this.o.lineAnchors !== false) out.push(this.anchor(l.n));
        i++;
        continue;
      }
      let m: RegExpExecArray | null;
      if ((m = RE.fence.exec(t))) {
        const [, ind = "", mark = "", info = ""] = m;
        const body: Line[] = [];
        let j = i + 1;
        while (j < ls.length && !new RegExp(`^ {0,3}${mark[0] === "`" ? "`" : "~"}{${mark.length},}\\s*$`).test(ls[j]!.text)) body.push(ls[j++]!);
        const close = ls[j];
        const lang = info.toLowerCase();
        const code = body.map((b) => `<span class="cl"${this.lineId(b.n)}>${esc(dedent(b.text, ind.length))}\n</span>`).join("");
        const label = lang === "mermaid" ? "Mermaid diagram, shown as source" : lang;
        out.push(`<div class="code">${label ? `<div class="code-h">${esc(label)}</div>` : ""}<pre${lang ? ` data-lang="${esc(lang)}"` : ""}>${this.anchor(l.n)}<code>${code}</code>${close ? this.anchor(close.n) : ""}</pre></div>`);
        i = j + 1;
        continue;
      }
      if ((m = RE.heading.exec(t))) {
        const level = m[1]!.length;
        const text = m[2] ?? "";
        if (this.o.reader?.has("guide") && isGuide(text)) {
          i = this.guide(ls, i, level, text, out);
          continue;
        }
        out.push(this.heading(l, level, text));
        i++;
        continue;
      }
      if (RE.hr.test(t)) {
        out.push(`${this.anchor(l.n)}<hr>`);
        i++;
        continue;
      }
      if (isTableStart(ls, i)) {
        const head = tableCells(t);
        const align = tableCells(ls[i + 1]!.text).map((c) => (c.startsWith(":") && c.endsWith(":") ? ' class="a-c"' : c.endsWith(":") ? ' class="a-r"' : ""));
        const rows: Line[] = [];
        let j = i + 2;
        while (j < ls.length && !RE.blank.test(ls[j]!.text) && ls[j]!.text.includes("|") && !startsBlockOtherThanRow(ls, j)) rows.push(ls[j++]!);
        // renderInline already escapes the text, so dropping its tags leaves attribute-safe HTML.
        const labels = head.map((h) => renderInline(h).replace(/<[^>]+>/g, ""));
        const cell = (tag: "th" | "td", row: Line, c: string, k: number, first: boolean) =>
          `<${tag}${align[k] ?? ""}${tag === "td" ? ` data-label="${labels[k] ?? ""}"` : ""}>${first ? this.anchorIds(row.n) : ""}${this.inline([row], c)}</${tag}>`;
        const tr = (row: Line, tag: "th" | "td") =>
          `<tr${this.lineId(row.n)}>${head.map((_, k) => cell(tag, row, tableCells(row.text)[k] ?? "", k, k === 0)).join("")}</tr>`;
        out.push(
          `<div class="md-table${head.length >= 4 ? " wide" : ""}"><table><thead${this.lineId(ls[i + 1]!.n)}>${tr(l, "th")}</thead>${rows.length ? `<tbody>${rows.map((r) => tr(r, "td")).join("")}</tbody>` : ""}</table></div>`,
        );
        i = j;
        continue;
      }
      if (RE.quote.test(t)) {
        const inner: Line[] = [];
        let j = i;
        while (j < ls.length && (RE.quote.test(ls[j]!.text) || (inner.length && !RE.blank.test(ls[j]!.text) && !RE.blank.test(inner.at(-1)!.text) && !startsBlock(ls, j)))) {
          inner.push({ n: ls[j]!.n, text: ls[j]!.text.replace(RE.quote, "") });
          j++;
        }
        const alert = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(inner[0]?.text ?? "");
        if (alert) {
          const kind = alert[1]!.toUpperCase();
          out.push(`<div class="alert ${kind.toLowerCase()}">${this.anchor(inner[0]!.n)}<p class="alert-t">${ALERTS[kind]}</p>${this.blocks(inner.slice(1))}</div>`);
        } else out.push(`<blockquote>${this.blocks(inner)}</blockquote>`);
        i = j;
        continue;
      }
      if ((m = RE.item.exec(t))) {
        i = this.list(ls, i, out);
        continue;
      }
      if (this.noteAt(t)) {
        i = this.notes(ls, i, out);
        continue;
      }
      const para: Line[] = [l];
      let j = i + 1;
      while (j < ls.length && !RE.blank.test(ls[j]!.text) && !startsBlock(ls, j)) para.push(ls[j++]!);
      const html = this.inline(para);
      out.push(this.o.reader?.has("blocked") && isBlocked(t) ? `<p class="blocked">${html}</p>` : tight ? html : `<p>${html}</p>`);
      i = j;
    }
    return out.join("\n");
  }

  /** The line's extra anchors (the IDs it defines), without the line anchor the row already has. */
  private anchorIds(n: number): string {
    return (this.o.anchorsAt?.(n) ?? []).map((id) => `<span class="la" id="${esc(id)}"></span>`).join("");
  }

  private list(ls: readonly Line[], start: number, out: string[]): number {
    const first = RE.item.exec(ls[start]!.text)!;
    const ordered = /\d/.test(first[2]!);
    const indent = first[1]!.length;
    const sameList = (m: RegExpExecArray) => m[1]!.length <= indent + 1 && /\d/.test(m[2]!) === ordered && (ordered || m[2] === first[2]);
    const items: { lines: Line[]; head: Line }[] = [];
    let loose = false;
    let i = start;
    while (i < ls.length) {
      const m = RE.item.exec(ls[i]!.text);
      if (!m || !sameList(m)) break;
      const pad = (m[3] ?? " ").length;
      const w = m[1]!.length + m[2]!.length + (pad > 4 ? 1 : pad);
      const lines: Line[] = [{ n: ls[i]!.n, text: m[4] ?? "" }];
      let j = i + 1;
      while (j < ls.length) {
        const tx = ls[j]!.text;
        if (RE.blank.test(tx)) {
          let k = j;
          while (k < ls.length && RE.blank.test(ls[k]!.text)) k++;
          if (k < ls.length && indentOf(ls[k]!.text) >= w) {
            for (; j < k; j++) lines.push({ n: ls[j]!.n, text: "" });
            continue;
          }
          break;
        }
        if (indentOf(tx) >= w) lines.push({ n: ls[j]!.n, text: dedent(tx, w) });
        else if (!RE.blank.test(lines.at(-1)!.text) && !startsBlock(ls, j)) lines.push({ n: ls[j]!.n, text: tx.trim() });
        else break;
        j++;
      }
      // A blank line between items, or between blocks inside one, makes the list loose.
      if (lines.some((x, k) => k > 0 && x.text === "" && k < lines.length - 1)) loose = true;
      items.push({ lines, head: ls[i]! });
      let k = j;
      while (k < ls.length && RE.blank.test(ls[k]!.text)) k++;
      const next = k < ls.length ? RE.item.exec(ls[k]!.text) : null;
      if (k > j && next && sameList(next)) {
        loose = true;
        for (; j < k; j++) lines.push({ n: ls[j]!.n, text: "" });
      }
      i = j;
    }
    const startNo = ordered ? Number(/\d+/.exec(first[2]!)![0]) : 1;
    let records = false;
    const lis = items.map(({ lines }) => {
      const rec = this.o.reader ? matchRecord(lines[0]!.text, this.o.reader) : null;
      if (rec) {
        records = true;
        const n = lines[0]!.n;
        const prev = this.rec;
        this.rec = rec.ids;
        const html = this.blocks([{ n, text: rec.rest }, ...lines.slice(1)], !loose);
        this.rec = prev;
        const links = this.idsFor([n]);
        const defined = this.o.anchorsAt?.(n) ?? [];
        const own = rec.ids.filter((id) => !defined.includes(id)).map((id) => `<span class="la" id="${esc(id)}"></span>`).join("");
        const title = rec.retired ? ` title="Retired in revision ${esc(rec.retired)}"` : "";
        const label = rec.ids.map((id) => `<a href="${esc(links.get(id) ?? `#${id}`)}"${title}>${esc(id)}</a>`).join("");
        return `<li class="rec${rec.retired ? " retired" : ""}">${own}<span class="rid">${label}</span><div class="rb">${html}</div></li>`;
      }
      const task = /^\[([ xX])\]\s+/.exec(lines[0]!.text);
      const body = task ? [{ ...lines[0]!, text: lines[0]!.text.slice(task[0].length) }, ...lines.slice(1)] : lines;
      const box = task ? `<input type="checkbox" disabled${task[1] === " " ? "" : " checked"} aria-label="${task[1] === " " ? "Not done" : "Done"}"> ` : "";
      let html = this.blocks(body, !loose);
      if (box) html = html.startsWith("<p>") ? `<p>${box}${html.slice(3)}` : box + html;
      return `<li${task ? ' class="task"' : ""}>${html}</li>`;
    });
    const cls = [items.some((x) => /^\[[ xX]\]\s/.test(x.lines[0]!.text)) ? "tasks" : "", records ? "records" : ""].filter(Boolean).join(" ");
    out.push(ordered ? `<ol${startNo !== 1 ? ` start="${startNo}"` : ""}${records ? ' class="records"' : ""}>${lis.join("")}</ol>` : `<ul${cls ? ` class="${cls}"` : ""}>${lis.join("")}</ul>`);
    return i;
  }
}

function startsBlockOtherThanRow(ls: readonly Line[], i: number): boolean {
  const t = ls[i]!.text;
  return RE.fence.test(t) || RE.heading.test(t) || RE.quote.test(t);
}

export const toLines = (text: string, from = 1): Line[] => text.split(/\r?\n/).map((t, k) => ({ n: from + k, text: t }));

/** Renders a markdown document. Front matter, if any, is shown folded. */
export function renderMarkdown(lines: readonly Line[], o: MdOptions = {}): string {
  const r = new Renderer(o);
  lines = lines.map((l) => ({ n: l.n, text: l.text.replace(/[\u0001-\u0004]/g, "\uFFFD") }));
  if (o.reader?.has("comment")) lines = stripComments(lines);
  if (o.reader?.has("record")) {
    r.records = new Set(lines.flatMap((l) => recordIds(RE.item.exec(l.text)?.[4] ?? "")));
  }
  let body = lines;
  let front = "";
  if (lines[0]?.text.trim() === "---") {
    const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l.text));
    if (end > 0) {
      const fm = lines.slice(1, end);
      front = `<details class="front">${r.anchor(lines[0]!.n)}<summary>Front matter</summary><pre><code>${fm.map((l) => `<span class="cl"${o.lineAnchors === false ? "" : ` id="L${l.n}"`}>${esc(l.text)}\n</span>`).join("")}</code></pre>${r.anchor(lines[end]!.n)}</details>`;
      body = lines.slice(end + 1);
    }
  }
  return front + r.blocks(body);
}

/** The lines that belong to the block starting at a line: a heading's section, a list item, or the line itself. */
export function blockAt(lines: readonly Line[], n: number): Line[] {
  const i = lines.findIndex((l) => l.n === n);
  if (i < 0) return [];
  const t = lines[i]!.text;
  const h = RE.heading.exec(t);
  let j = i + 1;
  if (h) {
    let fence = false;
    for (; j < lines.length; j++) {
      const x = lines[j]!.text;
      if (RE.fence.test(x)) fence = !fence;
      const hh = !fence && RE.heading.exec(x);
      if (hh && hh[1]!.length <= h[1]!.length) break;
    }
  } else if (RE.item.test(t)) {
    const ind = indentOf(t);
    for (; j < lines.length; j++) {
      const x = lines[j]!.text;
      if (RE.blank.test(x)) {
        const next = lines.slice(j).find((y) => !RE.blank.test(y.text));
        if (!next || indentOf(next.text) <= ind) break;
        continue;
      }
      if (indentOf(x) <= ind) break;
    }
  }
  return lines.slice(i, j);
}

export interface OutlineHeading {
  readonly level: number;
  /** The heading's markdown text. */
  readonly text: string;
  /** The id the rendered page gives it. */
  readonly slug: string;
  readonly n: number;
}

/** The headings a document gets, in order, with the ids the rendered page gives them. */
export function outline(lines: readonly Line[], o: Pick<MdOptions, "reader"> = {}): OutlineHeading[] {
  const out: OutlineHeading[] = [];
  const seen = new Map<string, number>();
  let fence = false;
  for (const l of o.reader?.has("comment") ? stripComments(lines) : lines) {
    if (RE.fence.test(l.text)) fence = !fence;
    const h = !fence && RE.heading.exec(l.text);
    if (!h) continue;
    const s = slug(h[2] ?? "") || "section";
    const k = seen.get(s) ?? 0;
    seen.set(s, k + 1);
    out.push({ level: h[1]!.length, text: h[2] ?? "", slug: k ? `${s}-${k}` : s, n: l.n });
  }
  return out;
}

/** The heading slugs a document gets, in order, for checking #fragment links before rendering. */
export function headingSlugs(lines: readonly Line[]): Set<string> {
  return new Set(outline(lines).map((h) => h.slug));
}

/** A list item's lines without its marker, ready to render on its own. */
export function itemBody(lines: readonly Line[]): Line[] {
  const [first, ...rest] = lines;
  if (!first) return [];
  const m = RE.item.exec(first.text);
  const ind = Math.min(...rest.filter((l) => !RE.blank.test(l.text)).map((l) => indentOf(l.text)));
  return [{ n: first.n, text: m ? (m[4] ?? "") : first.text }, ...rest.map((l) => ({ n: l.n, text: Number.isFinite(ind) ? dedent(l.text, ind) : l.text }))];
}

export const isHeading = (text: string) => RE.heading.test(text);
