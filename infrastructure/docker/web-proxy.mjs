#!/usr/bin/env node
/**
 * Minimal Cloud Run web process:
 * - serves the Vite static dist
 * - proxies /v1/* to public-bff using the runtime service identity
 * Browser never receives Google tokens, SA JSON, or Authorization headers.
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";
const distDir = resolve(
  process.env.WEB_DIST_DIR ?? join(fileURLToPath(new URL(".", import.meta.url)), "dist"),
);
const bffUrl = (process.env.PUBLIC_BFF_URL ?? "").replace(/\/$/, "");
const metadataIdentity =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function identityToken(audience) {
  const url = `${metadataIdentity}?audience=${encodeURIComponent(audience)}&format=full`;
  const res = await fetch(url, { headers: { "Metadata-Flavor": "Google" } });
  if (!res.ok) {
    throw new Error(`metadata_identity_http_${res.status}`);
  }
  return (await res.text()).trim();
}

function safeStaticPath(urlPath) {
  const cleaned = decodeURIComponent(urlPath.split("?")[0]).replace(/\\/g, "/");
  const rel = cleaned === "/" ? "/index.html" : cleaned;
  const resolved = resolve(join(distDir, rel));
  if (!resolved.startsWith(distDir)) return null;
  return resolved;
}

/** Vite emits content-hashed filenames under /assets, so they are immutable. */
function isHashedAsset(urlPath) {
  return urlPath.split("?")[0].startsWith("/assets/");
}

/**
 * Weak validator from size + mtime. Enough for a 304 on unchanged files, and it
 * changes whenever a new image is deployed because every layer is rewritten.
 */
function entityTag(stats) {
  return `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
}

function serveStatic(req, res) {
  const urlPath = req.url ?? "/";
  let filePath = safeStaticPath(urlPath);
  if (!filePath) {
    json(res, 400, { error: "BAD_PATH" });
    return;
  }

  const missing = !existsSync(filePath) || statSync(filePath).isDirectory();
  if (missing) {
    // A stale index.html points at content-hashed assets that no longer exist.
    // Falling back to index.html there returns HTML as JavaScript, which a
    // module script rejects on MIME — a blank page that never self-heals.
    // 404 lets the browser fail loudly and refetch the document instead.
    if (isHashedAsset(urlPath)) {
      json(res, 404, { error: "ASSET_NOT_FOUND" });
      return;
    }
    filePath = join(distDir, "index.html");
  }
  if (!existsSync(filePath)) {
    json(res, 404, { error: "NOT_FOUND" });
    return;
  }

  const stats = statSync(filePath);
  const etag = entityTag(stats);
  const type = MIME[extname(filePath)] ?? "application/octet-stream";

  // Hashed assets are safe to cache forever; the document must be revalidated
  // every load or a returning visitor keeps running the previous deployment.
  const cacheControl = !missing && isHashedAsset(urlPath)
    ? "public, max-age=31536000, immutable"
    : "no-cache";

  if ((req.headers["if-none-match"] ?? "") === etag) {
    res.writeHead(304, { etag, "cache-control": cacheControl });
    res.end();
    return;
  }

  res.writeHead(200, {
    "content-type": type,
    "cache-control": cacheControl,
    etag,
    "last-modified": stats.mtime.toUTCString(),
  });
  createReadStream(filePath).pipe(res);
}

async function proxyBff(req, res) {
  if (!bffUrl) {
    json(res, 503, { error: "BFF_URL_MISSING" });
    return;
  }
  let token;
  try {
    token = await identityToken(bffUrl);
  } catch {
    json(res, 503, { error: "IDENTITY_TOKEN_UNAVAILABLE" });
    return;
  }

  const target = `${bffUrl}${req.url}`;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);

  const headers = {
    authorization: `Bearer ${token}`,
    accept: req.headers.accept ?? "application/json",
  };
  if (req.headers["content-type"]) {
    headers["content-type"] = req.headers["content-type"];
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
  } catch {
    json(res, 502, { error: "BFF_UNREACHABLE" });
    return;
  }

  const outHeaders = { "cache-control": "no-store" };
  const ct = upstream.headers.get("content-type");
  if (ct) outHeaders["content-type"] = ct;
  const buf = Buffer.from(await upstream.arrayBuffer());
  res.writeHead(upstream.status, outHeaders);
  res.end(buf);
}

createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/healthz") {
    json(res, 200, { status: "ok", service: "web" });
    return;
  }
  if (path === "/readyz") {
    json(res, 200, {
      status: "ready",
      service: "web",
      bffConfigured: Boolean(bffUrl),
    });
    return;
  }
  if (path.startsWith("/v1/")) {
    void proxyBff(req, res);
    return;
  }
  serveStatic(req, res);
}).listen(port, host, () => {
  console.log(
    JSON.stringify({
      msg: "web proxy listening",
      port,
      host,
      bffConfigured: Boolean(bffUrl),
    }),
  );
});
