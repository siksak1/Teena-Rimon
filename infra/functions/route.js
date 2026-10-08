// CloudFront Function (viewer request, runtime cloudfront-js-2.0).
//
// Maps a customer's secret URL path to that customer's build in S3:
//   /teena-rimon-x7k2p9q4m3ab/assets/a.js → /builds/teena-rimon/1.0.0-a08adf9/assets/a.js
// using the KeyValueStore entry  token → {"slug":"teena-rimon","build":"1.0.0-a08adf9"}.
// Unknown tokens, "/", "/robots.txt" and direct "/builds/..." requests get a
// plain 404 here and never reach S3. Revoking a customer = deleting its key.
import cf from "cloudfront";

const kvs = cf.kvs("__KVS_ID__");

const ROBOTS = {
  "x-robots-tag": { value: "noindex, nofollow, noarchive" },
  "referrer-policy": { value: "no-referrer" },
  "cache-control": { value: "no-store" },
};

// Tokens are "<slug>-<random>": lowercase letters, digits and dashes.
const PATH = /^\/([a-z0-9-]{8,80})(\/.*)?$/;

function notFound() {
  return {
    statusCode: 404,
    statusDescription: "Not Found",
    headers: Object.assign({ "content-type": { value: "text/plain; charset=utf-8" } }, ROBOTS),
    body: { encoding: "text", data: "Not found" },
  };
}

async function handler(event) {
  const request = event.request;
  const match = request.uri.match(PATH);
  if (!match) return notFound();

  let route;
  try {
    // Two statements on purpose: CloudFront's runtime rejects `await` inside call arguments.
    const value = await kvs.get(match[1]);
    route = JSON.parse(value);
  } catch (e) {
    return notFound(); // no such token (or a malformed entry)
  }
  if (!route || !route.slug || !route.build) return notFound();

  // "/<token>" → "/<token>/", so the page's relative asset URLs resolve under the token.
  if (match[2] === undefined) {
    return {
      statusCode: 301,
      statusDescription: "Moved Permanently",
      headers: Object.assign({ location: { value: `/${match[1]}/` } }, ROBOTS),
    };
  }

  const rest = match[2] === "/" ? "/index.html" : match[2];
  if (rest.indexOf("..") !== -1) return notFound();
  request.uri = `/builds/${route.slug}/${route.build}${rest}`;
  return request;
}
