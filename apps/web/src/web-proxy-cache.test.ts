import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * How the app is DELIVERED, not what it renders.
 *
 * The web container previously served every static file with only a
 * content-type — no Cache-Control, no ETag, no Last-Modified. A returning
 * visitor's browser had no way to revalidate index.html, so it reused the
 * cached document, which points at content-hashed assets that were cached the
 * same way. The result: a full previous deployment served from disk with only
 * the favicon touching the network, while the server was serving the new build.
 *
 * Byte-level checks of the served bundle cannot catch that. These can.
 */

const PROXY = resolve(
  fileURLToPath(new URL("../../../infrastructure/docker/web-proxy.mjs", import.meta.url)),
);

const ASSET = "index-TESTHASH.js";

let dist: string;
let child: ChildProcess;
let base: string;

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.on("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close(() => res(port));
    });
  });
}

async function waitForReady(url: string, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await fetch(`${url}/healthz`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("web proxy did not become ready");
}

beforeAll(async () => {
  dist = mkdtempSync(join(tmpdir(), "tm-web-dist-"));
  mkdirSync(join(dist, "assets"), { recursive: true });
  writeFileSync(
    join(dist, "index.html"),
    `<!doctype html><html><head><script type="module" crossorigin src="/assets/${ASSET}"></script></head><body><div id="root"></div></body></html>`,
    "utf8",
  );
  writeFileSync(join(dist, "assets", ASSET), "export const build = 'new';\n", "utf8");

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [PROXY], {
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", WEB_DIST_DIR: dist },
    stdio: "ignore",
  });
  await waitForReady(base);
}, 40_000);

afterAll(() => {
  child?.kill();
  if (dist) rmSync(dist, { recursive: true, force: true });
});

describe("the document is always revalidated", () => {
  it("serves index.html with no-cache and a validator", async () => {
    const r = await fetch(`${base}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-cache");
    // Without a validator the browser cannot revalidate, which is the whole bug.
    expect(r.headers.get("etag")).toBeTruthy();
    expect(r.headers.get("last-modified")).toBeTruthy();
  });

  it("applies the same rule to SPA routes like /demo", async () => {
    const r = await fetch(`${base}/demo`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.headers.get("cache-control")).toBe("no-cache");
    expect(r.headers.get("etag")).toBeTruthy();
  });

  it("answers a matching If-None-Match with 304", async () => {
    const first = await fetch(`${base}/`);
    const etag = first.headers.get("etag")!;
    const second = await fetch(`${base}/`, { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
  });
});

describe("content-hashed assets are immutable", () => {
  it("serves /assets/* with a long immutable max-age", async () => {
    const r = await fetch(`${base}/assets/${ASSET}`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/javascript");
    const cc = r.headers.get("cache-control")!;
    expect(cc).toContain("immutable");
    expect(cc).toContain("max-age=31536000");
  });

  it("still revalidates to 304 when asked", async () => {
    const first = await fetch(`${base}/assets/${ASSET}`);
    const etag = first.headers.get("etag")!;
    const second = await fetch(`${base}/assets/${ASSET}`, { headers: { "if-none-match": etag } });
    expect(second.status).toBe(304);
  });
});

describe("a stale asset URL fails loudly instead of returning HTML", () => {
  it("404s a missing hashed asset rather than falling back to index.html", async () => {
    const r = await fetch(`${base}/assets/index-DEADBEEF.js`);
    // Returning 200 index.html here is what turned a stale cache into a blank
    // page: a module script rejects text/html on MIME and never recovers.
    expect(r.status).toBe(404);
    const body = await r.text();
    expect(body).not.toContain("<!doctype html");
    expect(body).not.toContain("<div id=\"root\">");
  });

  it("keeps the SPA fallback for non-asset routes", async () => {
    const r = await fetch(`${base}/some/deep/route`);
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("<div id=\"root\">");
  });
});
