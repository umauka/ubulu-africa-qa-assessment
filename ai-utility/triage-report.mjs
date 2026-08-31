#!/usr/bin/env node
/**
 * AI triage utility (Part 6, Task B).
 *
 * Reads a Playwright JSON report and produces a human-readable triage note
 * that separates:
 *   - genuinely new/unexpected failures (need a human now)
 *   - a test.fail()-tracked bug that unexpectedly PASSED (may be fixed --
 *     verify and promote out of test.fail())
 *   - known, tracked bugs still behaving as documented (no action needed)
 *   - flaky tests
 *
 * Categorization is done deterministically in code from the report's own
 * status/annotation fields -- the LLM is only asked to summarize and suggest
 * a likely root-cause area per genuine failure, never to do the counting or
 * classification itself (see docs/AI_Utility_Report_Part6.pdf for why).
 *
 * Usage:
 *   node --env-file=.env ai-utility/triage-report.mjs [path/to/results.json] [--out FILE]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const MODEL = 'claude-opus-5';

function stripAnsi(str) {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function firstLine(str, maxLen = 220) {
  const clean = stripAnsi(str).trim().split('\n')[0];
  return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
}

/** Recursively walks Playwright's nested suite tree and flattens every test. */
function collectTests(suite, out = []) {
  for (const s of suite.suites ?? []) collectTests(s, out);
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const result = test.results?.[0];
      const failAnnotation = (test.annotations ?? []).find((a) => a.type === 'fail');
      out.push({
        title: spec.title,
        file: spec.file,
        status: test.status, // 'expected' | 'unexpected' | 'flaky' | 'skipped'
        expectedStatus: test.expectedStatus,
        actualStatus: result?.status,
        bugId: failAnnotation ? failAnnotation.description.split(':')[0].trim() : null,
        bugDescription: failAnnotation ? failAnnotation.description : null,
        errorMessage: result?.errors?.[0]?.message ? firstLine(result.errors[0].message) : null,
      });
    }
  }
  return out;
}

function categorize(tests) {
  const trackedKnownIssues = tests.filter((t) => t.status === 'expected' && t.bugId);
  const possibleFixedBugs = tests.filter((t) => t.status === 'unexpected' && t.bugId);
  const unexpectedFailures = tests.filter((t) => t.status === 'unexpected' && !t.bugId);
  const flaky = tests.filter((t) => t.status === 'flaky');
  const passed = tests.filter((t) => t.status === 'expected' && !t.bugId);
  return { trackedKnownIssues, possibleFixedBugs, unexpectedFailures, flaky, passed };
}

const AnalysisSchema = z.object({
  executive_summary: z.string(),
  unexpected_failures: z.array(
    z.object({
      test_title: z.string(),
      file: z.string(),
      likely_area: z.string(),
      likely_cause: z.string(),
      suggested_priority: z.enum(['P1', 'P2', 'P3']),
    })
  ),
  flaky_tests_note: z.string(),
});

const TRIAGE_TOOL = {
  name: 'submit_triage_analysis',
  description: 'Submit the QA triage analysis for this test run.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      executive_summary: {
        type: 'string',
        description: '2-4 sentence human-readable summary of this run\'s health.',
      },
      unexpected_failures: {
        type: 'array',
        description: 'One entry per genuinely unexpected failure provided in the input. Do not add or omit entries.',
        items: {
          type: 'object',
          properties: {
            test_title: { type: 'string' },
            file: { type: 'string' },
            likely_area: { type: 'string', description: "Short tag, e.g. 'auth', 'schema-validation', 'network'." },
            likely_cause: { type: 'string', description: 'One-sentence hypothesis based on the error message.' },
            suggested_priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
          },
          required: ['test_title', 'file', 'likely_area', 'likely_cause', 'suggested_priority'],
          additionalProperties: false,
        },
      },
      flaky_tests_note: {
        type: 'string',
        description: 'Short note on flaky tests, or an empty string if there are none.',
      },
    },
    required: ['executive_summary', 'unexpected_failures', 'flaky_tests_note'],
    additionalProperties: false,
  },
};

/**
 * Grounding check: every failure the model references must exist, verbatim,
 * in the deterministic ground-truth list. Schema validity alone doesn't catch
 * a hallucinated test name -- this does.
 */
function validateGrounding(analysis, groundTruthFailures) {
  const errors = [];
  if (analysis.unexpected_failures.length !== groundTruthFailures.length) {
    errors.push(
      `Count mismatch: model returned ${analysis.unexpected_failures.length} unexpected failures, ` +
        `ground truth has ${groundTruthFailures.length}.`
    );
  }
  const groundTruthSet = new Set(groundTruthFailures.map((f) => `${f.file}::${f.title}`));
  for (const f of analysis.unexpected_failures) {
    const key = `${f.file}::${f.test_title}`;
    if (!groundTruthSet.has(key)) {
      errors.push(`Model referenced a test not present in the input: "${f.test_title}" (${f.file}).`);
    }
  }
  return errors;
}

/**
 * Deterministic stand-in for the LLM call, used only with --mock. Lets the
 * rest of the pipeline (validation, grounding, rendering) run and be
 * demonstrated end-to-end without a live API key. Never used unless --mock
 * is passed explicitly.
 */
function generateMockAnalysis(categorized) {
  return {
    executive_summary:
      `[MOCK] ${categorized.unexpectedFailures.length} unexpected failure(s) detected alongside ` +
      `${categorized.trackedKnownIssues.length} known tracked issue(s) behaving as documented.`,
    unexpected_failures: categorized.unexpectedFailures.map((t) => {
      const msg = (t.errorMessage ?? '').toLowerCase();
      let likely_area = 'unknown';
      let likely_cause = '[MOCK] No heuristic matched; needs manual triage.';
      let suggested_priority = 'P2';
      if (msg.includes('econnrefused') || msg.includes('timeout') || msg.includes('fetch failed')) {
        likely_area = 'network/connectivity';
        likely_cause = '[MOCK] Error message suggests the service under test was unreachable.';
        suggested_priority = 'P1';
      } else if (msg.includes('expected') && msg.includes('received')) {
        likely_area = 'assertion/status-code mismatch';
        likely_cause = '[MOCK] Assertion comparing expected vs. received values failed.';
        suggested_priority = 'P2';
      }
      if (/auth|token/i.test(t.title)) suggested_priority = 'P1';
      return { test_title: t.title, file: t.file, likely_area, likely_cause, suggested_priority };
    }),
    flaky_tests_note: categorized.flaky.length > 0 ? '[MOCK] Flaky tests present; investigate separately.' : '',
  };
}

function buildPrompt(categorized, stats) {
  const condensed = {
    stats,
    unexpected_failures: categorized.unexpectedFailures.map((t) => ({
      test_title: t.title,
      file: t.file,
      error_message: t.errorMessage,
    })),
    possible_fixed_bugs: categorized.possibleFixedBugs.map((t) => ({
      test_title: t.title,
      file: t.file,
      bug: t.bugDescription,
    })),
    flaky: categorized.flaky.map((t) => ({ test_title: t.title, file: t.file })),
  };
  return JSON.stringify(condensed, null, 2);
}

function renderMarkdown({ stats, categorized, analysis, groundingErrors }) {
  const lines = [];
  lines.push(`# Test Run Triage Note`);
  lines.push('');
  lines.push(`_Generated ${new Date().toISOString()} from a Playwright JSON report._`);
  lines.push('');
  lines.push(
    `**Run summary:** ${stats.expected} expected, ${stats.unexpected} unexpected, ` +
      `${stats.flaky} flaky, ${stats.skipped} skipped (${(stats.duration / 1000).toFixed(1)}s)`
  );
  lines.push('');

  if (analysis && groundingErrors.length === 0) {
    lines.push('## Summary');
    lines.push(analysis.executive_summary);
    lines.push('');
  } else if (groundingErrors.length > 0) {
    lines.push('## Summary');
    lines.push(
      '_AI analysis was rejected by validation and is omitted below -- see "AI Validation Failures" ' +
        'at the end of this note. Falling back to deterministic-only sections._'
    );
    lines.push('');
  }

  if (categorized.unexpectedFailures.length > 0) {
    lines.push('## Needs Human Attention Now');
    for (const t of categorized.unexpectedFailures) {
      const enrichment = analysis?.unexpected_failures.find(
        (f) => f.file === t.file && f.test_title === t.title
      );
      lines.push(`### ${t.title}`);
      lines.push(`- **File:** \`${t.file}\``);
      lines.push(`- **Error:** ${t.errorMessage ?? '(no error captured)'}`);
      if (enrichment) {
        lines.push(`- **Likely area:** ${enrichment.likely_area}`);
        lines.push(`- **Likely cause:** ${enrichment.likely_cause}`);
        lines.push(`- **Suggested priority:** ${enrichment.suggested_priority}`);
      }
      lines.push('');
    }
  } else {
    lines.push('## Needs Human Attention Now');
    lines.push('None -- no unexpected failures in this run.');
    lines.push('');
  }

  if (categorized.possibleFixedBugs.length > 0) {
    lines.push('## Possibly Fixed -- Verify & Promote Out of test.fail()');
    for (const t of categorized.possibleFixedBugs) {
      lines.push(`- **${t.title}** (\`${t.file}\`) now passes despite being tracked as: ${t.bugDescription}`);
    }
    lines.push('');
  }

  if (categorized.trackedKnownIssues.length > 0) {
    lines.push('## Known, Tracked -- No Action Needed');
    for (const t of categorized.trackedKnownIssues) {
      lines.push(`- ${t.bugDescription}`);
    }
    lines.push('');
  }

  if (categorized.flaky.length > 0) {
    lines.push('## Flaky -- Needs Investigation');
    for (const t of categorized.flaky) {
      lines.push(`- ${t.title} (\`${t.file}\`)`);
    }
    if (analysis?.flaky_tests_note) lines.push(`\n${analysis.flaky_tests_note}`);
    lines.push('');
  }

  if (groundingErrors.length > 0) {
    lines.push('## AI Validation Failures (analysis rejected)');
    for (const e of groundingErrors) lines.push(`- ${e}`);
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outFile = outIdx !== -1 ? args[outIdx + 1] : null;
  const mock = args.includes('--mock');
  const reportPath =
    args.find((a) => !a.startsWith('--') && a !== outFile) ?? 'test-results/results.json';

  const raw = JSON.parse(readFileSync(reportPath, 'utf-8'));
  const tests = collectTests({ suites: raw.suites });
  const categorized = categorize(tests);
  const stats = raw.stats;

  let analysis = null;
  let groundingErrors = [];

  if (categorized.unexpectedFailures.length === 0) {
    console.error('No unexpected failures -- skipping the AI call (nothing to triage).');
  } else if (mock) {
    console.error('--- MOCK MODE: no live API call was made; using a deterministic stand-in. ---');
    const parsed = AnalysisSchema.safeParse(generateMockAnalysis(categorized));
    analysis = parsed.success ? parsed.data : null;
    if (!parsed.success) groundingErrors = [`Mock schema validation failed: ${parsed.error.message}`];
    else groundingErrors = validateGrounding(analysis, categorized.unexpectedFailures);
    if (groundingErrors.length > 0) analysis = null;
  } else {
    const client = new Anthropic();
    const prompt = buildPrompt(categorized, stats);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system:
        'You are a QA triage assistant. You will receive a JSON summary of one Playwright test run. ' +
        'Known, already-tracked bugs and possibly-fixed bugs are provided for context only -- they are ' +
        'already handled by the caller and need no analysis from you. Your only job is: for each entry ' +
        'in `unexpected_failures`, suggest a short likely_area, a one-sentence likely_cause hypothesis ' +
        'based on its error_message, and a suggested_priority. Also write a 2-4 sentence executive_summary ' +
        'of overall run health. You MUST return exactly one entry in unexpected_failures for every entry ' +
        'given in the input, matching test_title and file exactly -- never invent, merge, or omit an entry.',
      tools: [TRIAGE_TOOL],
      tool_choice: { type: 'tool', name: TRIAGE_TOOL.name },
      messages: [{ role: 'user', content: prompt }],
    });

    const toolUse = response.content.find((b) => b.type === 'tool_use');
    if (!toolUse) {
      throw new Error('Model did not return a tool_use block.');
    }

    // Defense in depth: strict:true already guarantees schema-valid input,
    // but we re-validate with Zod (belt-and-braces) and then run a semantic
    // grounding check that no schema can express.
    const parsed = AnalysisSchema.safeParse(toolUse.input);
    if (!parsed.success) {
      groundingErrors = [`Schema validation failed: ${parsed.error.message}`];
    } else {
      analysis = parsed.data;
      groundingErrors = validateGrounding(analysis, categorized.unexpectedFailures);
      if (groundingErrors.length > 0) analysis = null;
    }
  }

  const markdown = renderMarkdown({ stats, categorized, analysis, groundingErrors });
  console.log(markdown);
  if (outFile) {
    writeFileSync(outFile, markdown);
    console.error(`\nWrote ${outFile}`);
  }
}

export { collectTests, categorize, AnalysisSchema, validateGrounding, generateMockAnalysis, renderMarkdown };

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Triage utility failed:', err.message ?? err);
    process.exitCode = 1;
  });
}
