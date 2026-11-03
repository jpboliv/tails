// The YAML subset tails config files use: nested mappings, lists, flow lists
// `[a, b]`, quoted or plain scalars, and comments. Every scalar is a string.
// Anything else (anchors, block scalars, multi-document) is rejected with a line number,
// so a config that parses here means what it says. Avoids a runtime dependency.

export type Yaml = string | Yaml[] | { [key: string]: Yaml };

export class YamlError extends Error {}

interface Line {
  readonly n: number;
  readonly indent: number;
  readonly text: string;
}

function stripComment(s: string): string {
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (quote === '"' && c === "\\") { i++; continue; }
      if (quote === "'" && c === "'" && s[i + 1] === "'") { i++; continue; }
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]!))) return s.slice(0, i);
  }
  return s;
}

function scalar(raw: string, n: number): Yaml {
  const s = raw.trim();
  if (/^[&*!|>]/.test(s)) throw new YamlError(`line ${n}: unsupported YAML syntax "${s}"`);
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) throw new YamlError(`line ${n}: unclosed flow list`);
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    const parts: string[] = [];
    let start = 0, quote: string | null = null;
    for (let i = 0; i < inner.length; i++) {
      const c = inner[i]!;
      if (quote === '"' && c === "\\") { i++; continue; }
      if (quote === "'" && c === "'" && inner[i + 1] === "'") { i++; continue; }
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ",") { parts.push(inner.slice(start, i)); start = i + 1; }
      else if (c === "[" || c === "]") throw new YamlError(`line ${n}: nested flow lists are not supported`);
    }
    if (quote) throw new YamlError(`line ${n}: unclosed quoted string`);
    parts.push(inner.slice(start));
    return parts.map((x) => scalar(x, n));
  }
  if (s.startsWith("{")) throw new YamlError(`line ${n}: flow mappings are not supported`);
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s.startsWith('"')) {
    try { return JSON.parse(s) as string; }
    catch { throw new YamlError(`line ${n}: invalid double-quoted string; use JSON escapes`); }
  }
  if (s.startsWith("'")) throw new YamlError(`line ${n}: unclosed quoted string`);
  return s;
}

const KEY = /^("[^"]*"|'[^']*'|[^:#\s][^:]*?):(\s+|$)(.*)$/;

export function parseYaml(text: string): Yaml | null {
  const lines: Line[] = [];
  let started = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const body = stripComment(raw).replace(/\s+$/, "");
    if (body.trim() === "") return;
    if (body.trim() === "---" || body.trim() === "...") {
      if (started || body.trim() === "...") throw new YamlError(`line ${i + 1}: multiple YAML documents are not supported`);
      started = true;
      return;
    }
    started = true;
    if (/\t/.test(body.slice(0, body.length - body.trimStart().length))) throw new YamlError(`line ${i + 1}: tabs are not allowed for indentation`);
    lines.push({ n: i + 1, indent: body.length - body.trimStart().length, text: body.trim() });
  });
  if (lines.length === 0) return null;
  let pos = 0;

  function block(indent: number): Yaml {
    const first = lines[pos]!;
    if (first.text.startsWith("- ") || first.text === "-") {
      const list: Yaml[] = [];
      while (pos < lines.length && lines[pos]!.indent === indent && (lines[pos]!.text.startsWith("- ") || lines[pos]!.text === "-")) {
        const line = lines[pos]!;
        const rest = line.text.slice(1).trim();
        if (rest === "") {
          pos++;
          list.push(pos < lines.length && lines[pos]!.indent > indent ? block(lines[pos]!.indent) : "");
        } else if (KEY.test(rest)) {
          // "- key: value" starts a mapping whose keys sit at indent + 2.
          lines[pos] = { n: line.n, indent: indent + 2, text: rest };
          list.push(block(indent + 2));
        } else {
          list.push(scalar(rest, line.n));
          pos++;
        }
      }
      return list;
    }
    const map: { [key: string]: Yaml } = {};
    while (pos < lines.length && lines[pos]!.indent === indent) {
      const line = lines[pos]!;
      const m = KEY.exec(line.text);
      if (!m) throw new YamlError(`line ${line.n}: expected "key: value"`);
      const key = scalar(m[1]!, line.n) as string;
      if (key in map) throw new YamlError(`line ${line.n}: duplicate key "${key}"`);
      pos++;
      if (m[3]!.trim() !== "") map[key] = scalar(m[3]!, line.n);
      else if (pos < lines.length && lines[pos]!.indent > indent) map[key] = block(lines[pos]!.indent);
      else if (pos < lines.length && lines[pos]!.indent === indent && lines[pos]!.text.startsWith("- ")) map[key] = block(indent);
      else map[key] = "";
    }
    return map;
  }

  const root = block(lines[0]!.indent);
  if (pos < lines.length) throw new YamlError(`line ${lines[pos]!.n}: unexpected indentation`);
  return root;
}
