#!/usr/bin/env node
/**
 * Proves the validation logic in triage-report.mjs actually rejects bad
 * model output, rather than just claiming to. Run directly:
 *   node ai-utility/verify.mjs
 */
import { readFileSync } from 'node:fs';
import {
  collectTests,
  categorize,
  AnalysisSchema,
  validateGrounding,
  generateMockAnalysis,
} from './triage-report.mjs';

const raw = JSON.parse(readFileSync(new URL('./sample-reports/mixed-run.json', import.meta.url)));
const tests = collectTests({ suites: raw.suites });
const categorized = categorize(tests);

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}`);
  if (!condition) failures++;
}

console.log('--- Case 1: well-formed, grounded analysis ---');
const good = generateMockAnalysis(categorized);
const goodParsed = AnalysisSchema.safeParse(good);
check('schema validation accepts a well-formed analysis', goodParsed.success);
const goodGroundingErrors = validateGrounding(goodParsed.data, categorized.unexpectedFailures);
check('grounding check finds no errors on real data', goodGroundingErrors.length === 0);

console.log('\n--- Case 2: hallucinated test name (invented by the "model") ---');
const hallucinated = generateMockAnalysis(categorized);
hallucinated.unexpected_failures.push({
  test_title: 'handles concurrent booking writes without a race condition',
  file: 'crud.spec.js',
  likely_area: 'concurrency',
  likely_cause: 'Fabricated entry -- this test does not exist in the input.',
  suggested_priority: 'P1',
});
const hallucinatedParsed = AnalysisSchema.safeParse(hallucinated);
check('schema validation still accepts it (schema alone cannot catch this)', hallucinatedParsed.success);
const hallucinatedErrors = validateGrounding(hallucinatedParsed.data, categorized.unexpectedFailures);
check('grounding check catches the count mismatch', hallucinatedErrors.some((e) => e.includes('Count mismatch')));
check(
  'grounding check names the specific hallucinated test',
  hallucinatedErrors.some((e) => e.includes('handles concurrent booking writes'))
);
console.log('Grounding errors reported:');
for (const e of hallucinatedErrors) console.log(`  - ${e}`);

console.log('\n--- Case 3: dropped entry (model omits a real failure) ---');
const dropped = generateMockAnalysis(categorized);
dropped.unexpected_failures = [];
const droppedParsed = AnalysisSchema.safeParse(dropped);
const droppedErrors = validateGrounding(droppedParsed.data, categorized.unexpectedFailures);
check('grounding check catches a silently dropped failure', droppedErrors.some((e) => e.includes('Count mismatch')));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
