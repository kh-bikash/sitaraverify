import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Sitaara property workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Sitaara Verify/);
  assert.match(html, /Property intelligence/);
  assert.match(html, /Document lab/);
  assert.match(html, /Plot map/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site/);
});

test("keeps Gemini credentials server-side and OCR editable, persistent and removable", async () => {
  const [page, route, readme, envExample] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ocr/gemini/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
  ]);

  assert.match(page, /\/api\/ocr\/gemini/);
  assert.match(page, /indexedDB\.open/);
  assert.match(page, /removeLocalDocument/);
  assert.match(page, /Handwriting \/ unclear/);
  assert.match(page, /Confirm correction/);
  assert.match(page, /onLineChange/);
  assert.match(page, /OpenStreetMap/);
  assert.match(route, /process\.env\.GEMINI_API_KEY/);
  assert.match(route, /x-goog-api-key/);
  assert.match(route, /gemini-3\.6-flash/);
  assert.match(route, /Never silently correct a name/);
  assert.doesNotMatch(page, /NEXT_PUBLIC_GEMINI/);
  assert.match(readme, /server-only route/);
  assert.match(envExample, /GEMINI_API_KEY=replace_/);
});
