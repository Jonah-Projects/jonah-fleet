import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runStatus } from '../src/commands/status.js';

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[\d+m/g, '');
}

describe('Status Command', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-status-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('outputs status without manifest as error in json or warning in text', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runStatus({ cwd: tempDir, json: true });
    expect(logSpy).toHaveBeenCalled();
    const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
    expect(jsonOutput.error).toContain('No agents-manifest.json found');

    logSpy.mockClear();
    await runStatus({ cwd: tempDir, json: false });
    expect(logSpy).toHaveBeenCalled();
    expect(logSpy.mock.calls[0][0]).toContain('No agents-manifest.json found');
  });

  it('displays status with per-routine token breakdown when logs exist and --tokens is used', async () => {
    // Create manifest
    fs.writeFileSync(
      path.join(tempDir, 'agents-manifest.json'),
      JSON.stringify(
        {
          version: '1.1.0',
          preset: 'standard',
          routines: { autowork: true, 'peer-review': true },
          skills: ['tdd', 'code-review'],
        },
        null,
        2
      )
    );

    // Create prompt logs with dynamic timestamp within 7-day rolling window
    const logsDir = path.join(tempDir, '.github/prompts/logs/autowork');
    fs.mkdirSync(logsDir, { recursive: true });
    const logTimestamp = new Date().toISOString();
    fs.writeFileSync(
      path.join(logsDir, `${logTimestamp.replace(/[:.]/g, '-')}.md`),
      `# Run Log
## Metadata
| Field | Value |
|-------|-------|
| Routine | \`autowork\` |
| Timestamp | \`${logTimestamp}\` |
| Result | \`SUCCESS\` |
| Input tokens | \`80000\` |
| Output tokens | \`5000\` |
| Estimated cost | \`$0.25\` |
| Iterations used | \`18 / 65\` |
`
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runStatus({ cwd: tempDir, json: false, tokens: true });
    const fullText = logSpy.mock.calls.map((c) => stripAnsi(c[0])).join('\n');

    expect(fullText).toContain('Jonah Fleet Status');
    expect(fullText).toContain('7-Day Token Spend');
    expect(fullText).toContain('autowork');
    expect(fullText).toContain('$0.25');

    // JSON mode verification
    logSpy.mockClear();
    await runStatus({ cwd: tempDir, json: true });
    const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
    expect(jsonOutput.tokenUsage).toBeDefined();
    expect(jsonOutput.tokenUsage.byRoutine.autowork).toBeDefined();
    expect(jsonOutput.tokenUsage.byRoutine.autowork.totalTokens).toBe(85000);
  });

  it('displays status with token usage from .jonah-fleet/runs directory', async () => {
    fs.writeFileSync(
      path.join(tempDir, 'agents-manifest.json'),
      JSON.stringify(
        {
          version: '1.8.0',
          preset: 'standard',
          routines: { autowork: true },
          skills: ['tdd'],
        },
        null,
        2
      )
    );

    const runsDir = path.join(tempDir, '.jonah-fleet', 'runs');
    fs.mkdirSync(runsDir, { recursive: true });
    const logTimestamp = new Date().toISOString();
    fs.writeFileSync(
      path.join(runsDir, `autowork-${logTimestamp.replace(/[:.]/g, '-')}.md`),
      `# Run Log\n## Metadata\n| Field | Value |\n|---|---|\n| Routine | \`autowork\` |\n| Timestamp | \`${logTimestamp}\` |\n| Result | \`SUCCESS\` |\n| Input tokens | \`50000\` |\n| Output tokens | \`4000\` |\n| Estimated cost | \`$0.15\` |\n`
    );

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runStatus({ cwd: tempDir, json: true });
    const jsonOutput = JSON.parse(logSpy.mock.calls[0][0]);
    expect(jsonOutput.tokenUsage).toBeDefined();
    expect(jsonOutput.tokenUsage.recentRunCount).toBe(1);
    expect(jsonOutput.tokenUsage.byRoutine.autowork.totalTokens).toBe(54000);
  });
});
