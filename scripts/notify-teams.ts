#!/usr/bin/env tsx
/**
 * Posts a single combined Teams notification summarizing one or more Playwright JSON
 * report files. Intended as the last step of the Drone pipeline, run once after both the
 * API and E2E suites have finished (see `.drone.yml`), so a run produces exactly one
 * notification instead of one per suite.
 *
 * Usage:
 *   tsx scripts/notify-teams.ts reports/api-results.json reports/e2e-results.json
 *
 * Each file must have been produced by Playwright's built-in `json` reporter
 * (`playwright test --reporter=json` with `PLAYWRIGHT_JSON_OUTPUT_NAME` or the config's
 * `outputFile` set — see `playwright.config.ts`).
 *
 * Without `TEAMS_WEBHOOK_URL` set, this logs the summary and exits 0 rather than failing
 * the build — a missing webhook shouldn't be a reason CI goes red.
 */
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { env } from '../src/config/env.js';
import { logger } from '../src/helpers/logger.js';
import {
  buildTeamsAdaptiveCardPayload,
  type SuiteSummary,
} from '../src/notifications/adaptive-card.builder.js';

interface PlaywrightJsonReport {
  stats: {
    expected: number;
    unexpected: number;
    flaky: number;
    skipped: number;
    duration: number;
  };
}

async function summarizeReport(path: string): Promise<SuiteSummary> {
  const raw = await readFile(path, 'utf-8');
  const report = JSON.parse(raw) as PlaywrightJsonReport;
  const { expected, unexpected, flaky, skipped, duration } = report.stats;

  return {
    label: basename(path).replace(/[-_.]?results?\.json$/i, '') || basename(path),
    total: expected + unexpected + flaky + skipped,
    passed: expected,
    failed: unexpected,
    flaky,
    skipped,
    durationMs: duration,
  };
}

async function main(): Promise<void> {
  const reportPaths = process.argv.slice(2);
  if (reportPaths.length === 0) {
    console.error('Usage: tsx scripts/notify-teams.ts <report1.json> [report2.json ...]');
    process.exit(1);
  }

  const summaries = await Promise.all(reportPaths.map(summarizeReport));

  for (const s of summaries) {
    logger.info(
      `${s.label}: ${s.passed}/${s.total} passed, ${s.flaky} flaky, ${s.failed} failed, ${s.skipped} skipped`,
    );
  }

  if (!env.TEAMS_WEBHOOK_URL) {
    logger.warn('TEAMS_WEBHOOK_URL is not set — skipping Teams notification.');
    return;
  }

  const payload = buildTeamsAdaptiveCardPayload(summaries, {
    buildNumber: env.DRONE_BUILD_NUMBER,
    buildLink: env.DRONE_BUILD_LINK,
    branch: env.DRONE_COMMIT_BRANCH,
    author: env.DRONE_COMMIT_AUTHOR,
    repo: env.DRONE_REPO,
  });

  const response = await fetch(env.TEAMS_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Teams webhook responded ${response.status}: ${await response.text()}`);
  }

  logger.info('Teams notification sent.');
}

main().catch((error) => {
  logger.error('notify-teams failed', error);
  process.exit(1);
});
