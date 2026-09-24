import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  classifyBacklogIssues,
  getBacklogIssues,
  getBacklogTriageReport,
  performAutoworkScan,
  isBotLogin,
  type BacklogIssue,
  type BacklogTriageReport,
} from '../src/lib/daemon.js';
import {
  renderBacklogDiagnosticCard,
} from '../src/lib/terminal-card.js';

describe('Daemon Autowork Backlog Preflight & Classification', () => {
  describe('isBotLogin', () => {
    it('identifies GitHub App bot accounts and configured bots', () => {
      expect(isBotLogin('github-actions[bot]')).toBe(true);
      expect(isBotLogin('dependabot[bot]')).toBe(true);
      expect(isBotLogin('jonah-fleet-bot')).toBe(true);
      expect(isBotLogin('my-custom-bot')).toBe(true);
      expect(isBotLogin('github-actions')).toBe(true);
    });

    it('identifies human accounts as non-bot', () => {
      expect(isBotLogin('juliendurandeu')).toBe(false);
      expect(isBotLogin('alice')).toBe(false);
      expect(isBotLogin('octocat')).toBe(false);
      expect(isBotLogin('')).toBe(false);
      expect(isBotLogin(undefined)).toBe(false);
    });
  });

  describe('classifyBacklogIssues', () => {
    it('returns empty lists for empty issues array', () => {
      const report = classifyBacklogIssues([]);
      expect(report.total).toBe(0);
      expect(report.actionable).toEqual([]);
      expect(report.inProgress).toEqual([]);
      expect(report.gatedHuman).toEqual([]);
      expect(report.awaitingInfo).toEqual([]);
      expect(report.guardrails).toEqual([]);
      expect(report.routineLogs).toEqual([]);
    });

    it('classifies unassigned open issues without gating labels as actionable', () => {
      const issues: BacklogIssue[] = [
        {
          number: 10,
          title: 'feat: add awesome feature',
          labels: [{ name: 'type/feat' }, { name: 'priority/P1' }],
          assignees: [],
        },
      ];

      const report = classifyBacklogIssues(issues);
      expect(report.actionable).toHaveLength(1);
      expect(report.actionable[0].number).toBe(10);
      expect(report.total).toBe(1);
    });

    it('classifies bot-assigned issues as actionable', () => {
      const issues: BacklogIssue[] = [
        {
          number: 11,
          title: 'fix: edge case bug',
          labels: [{ name: 'type/bug' }, { name: 'priority/P2' }],
          assignees: [{ login: 'github-actions[bot]' }],
        },
      ];

      const report = classifyBacklogIssues(issues);
      expect(report.actionable).toHaveLength(1);
      expect(report.actionable[0].number).toBe(11);
    });

    it('classifies human-assigned issues as inProgress', () => {
      const issues: BacklogIssue[] = [
        {
          number: 12,
          title: 'chore: maintainer assigned task',
          labels: [{ name: 'priority/P2' }],
          assignees: [{ login: 'juliendurandeu' }],
        },
      ];

      const report = classifyBacklogIssues(issues);
      expect(report.inProgress).toHaveLength(1);
      expect(report.inProgress[0].number).toBe(12);
      expect(report.actionable).toHaveLength(0);
    });

    it('classifies issues with active open PRs as inProgress', () => {
      const issues: BacklogIssue[] = [
        {
          number: 13,
          title: 'feat: in-flight PR work',
          labels: [{ name: 'priority/P1' }],
          assignees: [],
        },
      ];
      const openPRs = [
        {
          number: 55,
          title: 'feat: implement #13',
          body: 'Closes #13',
          headRefName: 'feat/issue-13',
        },
      ];

      const report = classifyBacklogIssues(issues, openPRs);
      expect(report.inProgress).toHaveLength(1);
      expect(report.inProgress[0].number).toBe(13);
      expect(report.actionable).toHaveLength(0);
    });

    it('classifies issues with draft PRs needing convergence as actionable', () => {
      const issues: BacklogIssue[] = [
        {
          number: 4439,
          title: 'profile settings UI for franchise and season 3-state',
          labels: [{ name: 'priority/P1' }],
          assignees: [],
        },
      ];
      const openPRs = [
        {
          number: 4440,
          title: 'feat: profile settings UI (#4439)',
          body: 'Closes #4439',
          headRefName: 'feat/4439-settings',
          isDraft: true,
        },
      ];

      const report = classifyBacklogIssues(issues, openPRs);
      expect(report.actionable).toHaveLength(1);
      expect(report.actionable[0].number).toBe(4439);
      expect(report.inProgress).toHaveLength(0);
    });

    it('classifies issues with draft PRs carrying needs-human as gatedHuman', () => {
      const issues: BacklogIssue[] = [
        {
          number: 4439,
          title: 'profile settings UI',
          labels: [],
          assignees: [],
        },
      ];
      const openPRs = [
        {
          number: 4440,
          title: 'feat: profile settings UI (#4439)',
          isDraft: true,
          labels: [{ name: 'needs-human' }],
        },
      ];

      const report = classifyBacklogIssues(issues, openPRs);
      expect(report.gatedHuman).toHaveLength(1);
      expect(report.gatedHuman[0].number).toBe(4439);
      expect(report.actionable).toHaveLength(0);
    });

    it('classifies issues with human-assigned draft PRs as inProgress', () => {
      const issues: BacklogIssue[] = [
        {
          number: 4439,
          title: 'profile settings UI',
          labels: [],
          assignees: [],
        },
      ];
      const openPRs = [
        {
          number: 4440,
          title: 'feat: profile settings UI (#4439)',
          isDraft: true,
          assignees: [{ login: 'juliendurandeu' }],
        },
      ];

      const report = classifyBacklogIssues(issues, openPRs);
      expect(report.inProgress).toHaveLength(1);
      expect(report.inProgress[0].number).toBe(4439);
      expect(report.actionable).toHaveLength(0);
    });

    it('classifies unlinked draft PRs needing convergence as actionable', () => {
      const issues: BacklogIssue[] = [];
      const openPRs = [
        {
          number: 77,
          title: 'refactor: decouple queue',
          isDraft: true,
        },
      ];

      const report = classifyBacklogIssues(issues, openPRs);
      expect(report.actionable).toHaveLength(1);
      expect(report.actionable[0].number).toBe(77);
    });

    it('classifies issues with needs-human as gatedHuman', () => {
      const issues: BacklogIssue[] = [
        {
          number: 14,
          title: 'feat: needs architectural decision',
          labels: [{ name: 'needs-human' }, { name: 'priority/P1' }],
          assignees: [],
        },
      ];

      const report = classifyBacklogIssues(issues);
      expect(report.gatedHuman).toHaveLength(1);
      expect(report.gatedHuman[0].number).toBe(14);
      expect(report.actionable).toHaveLength(0);
    });

    it('classifies issues with needs-info or needs-design as awaitingInfo', () => {
      const issues: BacklogIssue[] = [
        {
          number: 15,
          title: 'feat: unclear spec',
          labels: [{ name: 'needs-info' }],
          assignees: [],
        },
        {
          number: 16,
          title: 'ui: needs wireframe',
          labels: [{ name: 'needs-design' }],
          assignees: [],
        },
      ];

      const report = classifyBacklogIssues(issues);
      expect(report.awaitingInfo).toHaveLength(2);
      expect(report.awaitingInfo.map((i) => i.number)).toEqual([15, 16]);
      expect(report.actionable).toHaveLength(0);
    });

    it('classifies issues with measurement or wontfix as guardrails', () => {
      const issues: BacklogIssue[] = [
        {
          number: 17,
          title: 'metrics: conversion tracking',
          labels: [{ name: 'measurement' }],
          assignees: [],
        },
        {
          number: 18,
          title: 'wontfix: obsolete feature',
          labels: [{ name: 'wontfix' }],
          assignees: [],
        },
      ];

      const report = classifyBacklogIssues(issues);
      expect(report.guardrails).toHaveLength(2);
      expect(report.guardrails.map((i) => i.number)).toEqual([17, 18]);
      expect(report.actionable).toHaveLength(0);
    });

    it('classifies issues with routine-log or routine run title as routineLogs', () => {
      const issues: BacklogIssue[] = [
        {
          number: 19,
          title: '[autowork] run 2026-09-23T12-00-00Z',
          labels: [{ name: 'routine-log' }],
          assignees: [],
        },
        {
          number: 20,
          title: '[peer-review] run 2026-09-23T12-30-00Z (PR #10)',
          labels: [],
          assignees: [],
        },
      ];

      const report = classifyBacklogIssues(issues);
      expect(report.routineLogs).toHaveLength(2);
      expect(report.routineLogs.map((i) => i.number)).toEqual([19, 20]);
      expect(report.actionable).toHaveLength(0);
    });
  });

  describe('renderBacklogDiagnosticCard', () => {
    it('renders clean empty state when total issues is 0', () => {
      const emptyReport: BacklogTriageReport = {
        actionable: [],
        inProgress: [],
        gatedHuman: [],
        awaitingInfo: [],
        guardrails: [],
        routineLogs: [],
        total: 0,
      };

      const card = renderBacklogDiagnosticCard(emptyReport);
      expect(card).toContain('AUTOWORK BACKLOG TRIAGE');
      expect(card).toContain('Backlog is completely empty');
      expect(card).toContain('0 open issues');
      expect(card).toContain('┌');
      expect(card).toContain('┘');
    });

    it('renders diagnostic triage breakdown with gating reasons and actionable hints', () => {
      const report: BacklogTriageReport = {
        actionable: [],
        inProgress: [
          { number: 40, title: 'In-progress task', assignees: [{ login: 'juliendurandeu' }] },
        ],
        gatedHuman: [
          { number: 41, title: 'Needs maintainer review', labels: [{ name: 'needs-human' }] },
        ],
        awaitingInfo: [
          { number: 42, title: 'Unclear acceptance criteria', labels: [{ name: 'needs-info' }] },
        ],
        guardrails: [
          { number: 43, title: 'Telemetry metric issue', labels: [{ name: 'measurement' }] },
        ],
        routineLogs: [
          { number: 44, title: '[autowork] run log', labels: [{ name: 'routine-log' }] },
        ],
        total: 5,
      };

      const card = renderBacklogDiagnosticCard(report);
      expect(card).toContain('AUTOWORK BACKLOG TRIAGE');
      expect(card).toContain('0 Actionable');
      expect(card).toContain('#40');
      expect(card).toContain('#41');
      expect(card).toContain('#42');
      expect(card).toContain('#43');
      expect(card).toContain('Gated');
      expect(card).toContain('Hints to unblock:');
      expect(card).toContain('needs-human');
      expect(card).toContain('needs-info');
    });
  });

  describe('performAutoworkScan Zero-Token Preflight Bypass', () => {
    let tmpRepo: string;

    beforeEach(() => {
      tmpRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'jonah-fleet-autowork-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpRepo, { recursive: true, force: true });
    });

    it('bypasses worktree creation and routine execution when actionable.length === 0', async () => {
      let runRoutineCalled = false;
      let diagnosticCardReceived: string | null = null;

      const dummyReport: BacklogTriageReport = {
        actionable: [],
        inProgress: [{ number: 99, title: 'Some work in progress' }],
        gatedHuman: [],
        awaitingInfo: [],
        guardrails: [],
        routineLogs: [],
        total: 1,
      };

      const result = await performAutoworkScan({
        repoRoot: tmpRepo,
        getPRs: async () => [],
        getBacklog: async () => dummyReport,
        runRoutine: async () => {
          runRoutineCalled = true;
          return { success: true };
        },
        onDiagnosticCard: (card) => {
          diagnosticCardReceived = card;
        },
      });

      expect(runRoutineCalled).toBe(false);
      expect(result.executed).toBe(false);
      expect(result.reason).toBe('zero_actionable');
      expect(diagnosticCardReceived).not.toBeNull();
      expect(diagnosticCardReceived).toContain('AUTOWORK BACKLOG TRIAGE');
    });

    it('proceeds with routine execution when actionable.length > 0', async () => {
      let runRoutineCalled = false;

      const dummyReport: BacklogTriageReport = {
        actionable: [{ number: 100, title: 'Actionable feature request' }],
        inProgress: [],
        gatedHuman: [],
        awaitingInfo: [],
        guardrails: [],
        routineLogs: [],
        total: 1,
      };

      const result = await performAutoworkScan({
        repoRoot: tmpRepo,
        getPRs: async () => [],
        getBacklog: async () => dummyReport,
        runRoutine: async () => {
          runRoutineCalled = true;
          return { success: true };
        },
      });

      expect(runRoutineCalled).toBe(true);
      expect(result.executed).toBe(true);
    });

    it('proceeds with routine execution when an issue has a draft PR needing convergence', async () => {
      let runRoutineCalled = false;

      const reportWithDraftPR = classifyBacklogIssues(
        [{ number: 4439, title: 'profile settings UI' }],
        [{ number: 4440, title: 'feat: profile settings UI (#4439)', isDraft: true }]
      );

      const result = await performAutoworkScan({
        repoRoot: tmpRepo,
        getPRs: async () => [],
        getBacklog: async () => reportWithDraftPR,
        runRoutine: async () => {
          runRoutineCalled = true;
          return { success: true };
        },
      });

      expect(runRoutineCalled).toBe(true);
      expect(result.executed).toBe(true);
    });
  });
});
