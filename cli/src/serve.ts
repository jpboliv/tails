// `tails serve`: a local, read-only static file server for a generated site. Browsers such as
// Firefox restrict navigation between file:// pages, so this is the reliable way to preview.
import { createServer, type Server } from "node:http";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { TailsInputError } from "./model.js";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

/** Maps a request path to a file under root, or null when it escapes root or does not exist. */
function resolveRequest(root: string, url: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return null;
  }
  try {
    const abs = realpathSync(resolve(root, "." + path));
    if (abs !== root && !abs.startsWith(root + sep)) return null;
    const file = realpathSync(statSync(abs).isDirectory() ? join(abs, "index.html") : abs);
    return file.startsWith(root + sep) && statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

export function serve(dir: string, port: number, host = "127.0.0.1"): Promise<Server> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new TailsInputError(`${dir}: not a directory`);
  const root = realpathSync(dir);
  const server = createServer((req, res) => {
    const file = req.method === "GET" || req.method === "HEAD" ? resolveRequest(root, req.url ?? "/") : null;
    if (!file) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found\n");
      return;
    }
    try {
      const body = req.method === "HEAD" ? undefined : readFileSync(file);
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found\n");
    }
  });
  return new Promise((ok, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => ok(server));
  });
}
