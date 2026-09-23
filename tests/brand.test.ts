import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  FLEET_PALETTE,
  FLEET_ASCII_EMBLEM,
  renderFleetBanner,
  getFleetRunBadge,
} from '../src/lib/brand.js';
import { stripAnsi } from '../src/lib/terminal-card.js';

describe('Fleet Brand Identity & Terminal Primitives', () => {
  it('defines the official Fleet color palette matching brand assets', () => {
    expect(FLEET_PALETTE.commandNight).toBe('#050811');
    expect(FLEET_PALETTE.radarChartreuse).toBe('#BBF65D');
    expect(FLEET_PALETTE.thrusterCobalt).toBe('#4619FC');
    expect(FLEET_PALETTE.battleshipSlate).toBe('#829287');
    expect(FLEET_PALETTE.ordnanceFlare).toBe('#CF8B14');
  });

  it('provides the high-contrast Fleet ASCII emblem', () => {
    expect(FLEET_ASCII_EMBLEM).toBeDefined();
    expect(FLEET_ASCII_EMBLEM.length).toBeGreaterThan(3);
    const joined = FLEET_ASCII_EMBLEM.join('\n');
    expect(joined).toContain('██');
  });

  it('renders a tactical command banner with ASCII emblem, slate borders, and telemetry', () => {
    const banner = renderFleetBanner({
      command: 'INIT',
      subtitle: 'INITIALIZING REPO FLEET',
      details: [
        { label: 'PRESET', value: 'standard' },
        { label: 'TARGET', value: '/tmp/test-repo' },
      ],
      width: 76,
    });

    const plain = stripAnsi(banner);
    expect(plain).toContain('┌');
    expect(plain).toContain('└');
    expect(plain).toContain('INIT');
    expect(plain).toContain('FLEET // COMMAND');
    expect(plain).toContain('SYS: READY [bbf65d90]');
    expect(plain).toContain('PRESET: standard');
    expect(plain).toContain('TARGET: /tmp/test-repo');
  });

  it('renders a compact banner when width is restricted', () => {
    const compactBanner = renderFleetBanner({
      command: 'STATUS',
      subtitle: 'DRIFT AUDIT',
      width: 50,
    });

    const plain = stripAnsi(compactBanner);
    expect(plain).toContain('FLEET // COMMAND');
    expect(plain).toContain('STATUS');
  });

  it('generates the unified Fleet run badge markdown', () => {
    const badge = getFleetRunBadge('123456');
    expect(badge).toContain('img.shields.io/badge/Fleet');
    expect(badge).toContain('BBF65D');
    expect(badge).toContain('actions/runs/123456');
  });

  it('verifies prompt templates incorporate the unified Fleet footer and run badge', () => {
    const autoworkPrompt = fs.readFileSync(
      path.join(process.cwd(), '.github/prompts/autowork.md'),
      'utf8'
    );
    expect(autoworkPrompt).toContain('Fleet');
    expect(autoworkPrompt).toContain('BBF65D');
  });
});
