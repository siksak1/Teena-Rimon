// Static server for the end-to-end tests: serves frontend/dist under a fake
// customer token with exactly the headers CloudFront sends
// (infra/security-headers.json), and a 404 + noindex for every other path,
// like the routing function. Usage: node e2e/serve.mjs <port>
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

export const TOKEN = "e2e-test-token-0123456789";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const headers = JSON.parse(readFileSync(new URL("../../infra/security-headers.json", import.meta.url), "utf8"));
const port = Number(process.argv[2] ?? 43130);

const SECURITY = {
  "Content-Security-Policy": headers.contentSecurityPolicy.join("; "),
  "X-Robots-Tag": headers.robots,
  "Referrer-Policy": headers.referrerPolicy,
  "Permissions-Policy": headers.permissionsPolicy,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const prefix = `/${TOKEN}/`;
  if (!path.startsWith(prefix)) {
    res.writeHead(404, { ...SECURITY, "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  const rest = path.slice(prefix.length) || "index.html";
  const file = normalize(join(dist, rest));
  if (!file.startsWith(dist) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { ...SECURITY, "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { ...SECURITY, "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1");
