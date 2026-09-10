export interface SuiteSummary {
  /** Short label for the test suite/project this summary came from, e.g. "api", "e2e". */
  label: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs: number;
}

export interface CiContext {
  buildNumber?: string;
  buildLink?: string;
  branch?: string;
  author?: string;
  repo?: string;
}

/**
 * Builds the payload for a Power Automate "When a Teams webhook request is received"
 * workflow trigger: a `message` activity carrying one Adaptive Card attachment. This
 * replaced the legacy Office 365 Connector "Incoming Webhook" (retired), which used a
 * different, simpler `MessageCard` JSON shape — do not reuse old MessageCard snippets
 * against this payload shape, they're not compatible.
 */
export function buildTeamsAdaptiveCardPayload(suites: SuiteSummary[], ci: CiContext = {}): object {
  const overall = suites.reduce(
    (acc, s) => ({
      total: acc.total + s.total,
      passed: acc.passed + s.passed,
      failed: acc.failed + s.failed,
      flaky: acc.flaky + s.flaky,
      skipped: acc.skipped + s.skipped,
    }),
    { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 },
  );

  const allGreen = overall.failed === 0;
  const headerColor = allGreen ? 'Good' : 'Attention';
  const title = allGreen ? '✅ Playwright run passed' : '❌ Playwright run failed';

  const facts = [
    { title: 'Total', value: String(overall.total) },
    { title: 'Passed', value: String(overall.passed) },
    { title: 'Failed', value: String(overall.failed) },
    { title: 'Flaky', value: String(overall.flaky) },
    { title: 'Skipped', value: String(overall.skipped) },
  ];
  if (ci.branch) facts.push({ title: 'Branch', value: ci.branch });
  if (ci.author) facts.push({ title: 'Author', value: ci.author });
  if (ci.buildNumber) facts.push({ title: 'Build', value: `#${ci.buildNumber}` });

  const perSuiteText = suites
    .map(
      (s) => `**${s.label}**: ${s.passed}/${s.total} passed, ${s.flaky} flaky, ${s.failed} failed`,
    )
    .join('\n\n');

  const card = {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'Container',
        style: headerColor,
        bleed: true,
        items: [{ type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true }],
      },
      { type: 'FactSet', facts },
      { type: 'TextBlock', text: perSuiteText, wrap: true, spacing: 'Medium' },
    ],
    actions: ci.buildLink
      ? [{ type: 'Action.OpenUrl', title: 'View build', url: ci.buildLink }]
      : [],
  };

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: card,
      },
    ],
  };
}
