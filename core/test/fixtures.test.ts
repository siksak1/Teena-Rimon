import { existsSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ExtractionError } from "../src/errors.js";
import { reconcile } from "../src/reconcile/reconcile.js";
import { goldenSummary } from "./golden.js";
import { customerSlugs, extractCase, fixtureCases, loadCustomer } from "./helpers.js";

/**
 * Golden-file regression suite: every sample pair of every customer is
 * reconciled under that customer's config and compared with
 * `customers/<slug>/fixtures/<case>.expected.json`. A fix for one supplier
 * that changes any other result shows up here.
 *
 * After an intended change: `npm run fixtures:update`, then review the diff
 * of the .expected.json files before committing.
 */
const UPDATE = process.env.UPDATE_FIXTURES === "1";

for (const slug of customerSlugs()) {
  const cases = fixtureCases(slug);
  if (!cases) continue;
  const dir = new URL(`../../customers/${slug}/fixtures/`, import.meta.url);
  const expectedFile = (name: string) => new URL(`${name}.expected.json`, dir);

  describe(`fixtures: ${slug}`, () => {
    const config = loadCustomer(slug);

    for (const [name, pair] of Object.entries(cases)) {
      it(name, async () => {
        let actual: unknown;
        try {
          const extraction = await extractCase(pair, config);
          actual = goldenSummary(extraction, reconcile(extraction, config));
        } catch (err) {
          // An expected rejection (e.g. a scanned invoice) is a result too.
          if (!(err instanceof ExtractionError)) throw err;
          actual = { error: err.message };
        }

        const file = expectedFile(name);
        if (UPDATE) {
          writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
          return;
        }
        if (!existsSync(file)) {
          throw new Error(`Missing ${name}.expected.json for ${slug} — run "npm run fixtures:update" and review it.`);
        }
        expect(actual).toEqual(JSON.parse(readFileSync(file, "utf8")));
      });
    }

    it("has no expected files for cases that no longer exist", () => {
      const stale = readdirSync(dir)
        .filter((f) => f.endsWith(".expected.json"))
        .map((f) => f.slice(0, -".expected.json".length))
        .filter((name) => !(name in cases));
      if (UPDATE) stale.forEach((name) => unlinkSync(expectedFile(name)));
      else expect(stale).toEqual([]);
    });
  });
}
