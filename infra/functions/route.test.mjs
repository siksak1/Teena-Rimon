// Unit tests for the CloudFront routing function: `node --test functions/`.
// The function runs in CloudFront's own runtime, so the test loads its source
// and swaps the `cloudfront` module for an in-memory KeyValueStore.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./route.js", import.meta.url), "utf8").replace(
  'import cf from "cloudfront";',
  "",
);

function load(entries) {
  const cf = {
    kvs: () => ({
      async get(key) {
        if (!(key in entries)) throw new Error(`Key ${key} not found`);
        return entries[key];
      },
    }),
  };
  return new Function("cf", `${source}\nreturn handler;`)(cf);
}

const TOKEN = "teena-rimon-x7k2p9q4m3ab";
const handler = load({
  [TOKEN]: JSON.stringify({ slug: "teena-rimon", build: "1.0.0-a08adf9" }),
  "broken-entry-123": "not json",
});
const request = (uri) => ({ request: { uri, method: "GET", headers: {}, querystring: {} } });

test("rewrites a known token to its build", async () => {
  assert.equal((await handler(request(`/${TOKEN}/`))).uri, "/builds/teena-rimon/1.0.0-a08adf9/index.html");
  assert.equal(
    (await handler(request(`/${TOKEN}/assets/index-x.js`))).uri,
    "/builds/teena-rimon/1.0.0-a08adf9/assets/index-x.js",
  );
});

test("redirects the bare token to the trailing-slash URL", async () => {
  const res = await handler(request(`/${TOKEN}`));
  assert.equal(res.statusCode, 301);
  assert.equal(res.headers.location.value, `/${TOKEN}/`);
  assert.equal(res.headers["x-robots-tag"].value, "noindex, nofollow, noarchive");
});

for (const uri of [
  "/",
  "/robots.txt",
  "/index.html",
  "/teena-rimon-wrongtoken1/",
  "/builds/teena-rimon/1.0.0-a08adf9/index.html",
  "/broken-entry-123/",
  `/${TOKEN}/../other/index.html`,
  "/TEENA-RIMON-X7K2P9Q4M3AB/",
]) {
  test(`404 with noindex for ${uri}`, async () => {
    const res = await handler(request(uri));
    assert.equal(res.statusCode, 404);
    assert.equal(res.headers["x-robots-tag"].value, "noindex, nofollow, noarchive");
    assert.equal(res.headers["referrer-policy"].value, "no-referrer");
  });
}
