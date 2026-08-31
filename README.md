# Ubulu Africa QA Assessment

## Walkthrough video

[Walkthrough video](https://www.loom.com/share/99c975834c6a4e749ca5b55b16cb1b68) — recommend watching at 1.25x-1.5x speed.

## Chosen electives: Part 2 (API test automation) + Part 5 (CI/CD)

Part 2 exercises the core hands-on QA engineering skill this role needs day to day — designing an API test suite that validates behavior and response *shape*, not just status codes, and that's disciplined about finding and tracking real defects rather than working around them. Part 5 was chosen alongside it because a test suite that only runs on someone's laptop isn't actually done — wiring it into a real pipeline (service containers, parallel jobs, artifact reporting, and a signal that survives known, accepted bugs) is what makes the automation trustworthy for a team to rely on.

## Running the suite

**Prerequisites:** Node.js, Docker.

```bash
# 1. Start a local Restful Booker instance (the suite refuses to run against
#    anything that isn't localhost/127.0.0.1 — see api-tests/config/env.js)
docker run -d -p 3001:3001 mwinteringham/restfulbooker

# 2. Install dependencies
npm ci

# 3. Run the full suite (one command, deterministic, self-cleaning)
npx playwright test

# 4. View the HTML report
npx playwright show-report
```

Running `npx playwright test` twice in a row leaves the booking count unchanged — every test creates and deletes its own data via fixture teardown (`api-tests/fixtures/api-fixtures.js`).

**CI:** `.github/workflows/api-tests.yml` runs automatically on every push and pull request (any branch), plus a nightly scheduled run at 02:00 UTC. It can also be re-run manually from the repo's Actions tab. No manual setup is needed to trigger it — Restful Booker runs as a `services:` container inside the workflow itself.

## Known gaps / scope cuts

- **JavaScript, not TypeScript.** Built in plain JS by choice; Zod (`api-tests/helpers/schemas.js`) still gives full runtime response-shape validation, so no safety is lost, just compile-time type checking.
- **No fixture/mock data library** (e.g. Faker). A small custom random-data builder (`api-tests/helpers/data-builders.js`) was enough for this suite's size and keeps the dependency footprint minimal.
- **CI test sharding (bonus) doesn't merge into one combined HTML report.** Each of the 2 shards uploads its own report/results artifacts. Merging via Playwright's blob reporter is the standard mechanism, but it's extra moving parts that aren't justified for a 16-test suite — worth revisiting if the suite grows substantially.
- **ESLint config is intentionally minimal** (`eslint.config.mjs`, `@eslint/js` recommended rules only) since there was no pre-existing project convention to match.
- Part 1 and Part 6 deliverables (test plan, test cases, AI critique/utility docs) are tracked separately and out of scope for this section, which covers Part 2 + Part 5 only.

## Known-bug / expected-failure policy

Restful Booker has real, reproducible defects (see `docs/Restful_Booker_Bug_Report.pdf` for the full list, with severities and repro steps — BUG-1 through BUG-6). When a test uncovers one, the assertion is kept **strict** — it encodes the spec-correct expected behavior, never softened to force a pass. Instead, `test.fail(true, 'BUG-n: <what's wrong>')` is called at the top of that one test, with a comment giving expected vs. actual behavior, and the test stays in the suite permanently so it keeps exercising the broken behavior on every run.

This keeps CI meaningful instead of permanently red because of accepted, tracked defects:

- **Bug still present** (the assertion fails) → Playwright reports it as an *expected failure*, which counts toward the suite's overall **pass** and a `0` exit code.
- **Bug silently fixed** (the assertion now succeeds) → Playwright reports an *unexpected pass*, which **fails** the suite — surfacing the fix as a signal to promote the test out of `test.fail()` and close the bug, rather than the fix going unnoticed.
- **Any other, unrelated test failing** → fails the suite as normal.

Verified directly against a real run: the JUnit report (`test-results/results.xml`) shows `failures="0"` for a full run even with all 6 known bugs present, and each `test.fail()` test is annotated with `<property name="fail" value="BUG-n: ...">` in the XML — so the bug ID is traceable straight from the CI artifact, not just from source comments.
