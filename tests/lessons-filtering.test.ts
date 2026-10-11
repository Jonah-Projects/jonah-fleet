import { describe, it, expect } from 'vitest';
import {
  filterLessonsByRole,
  parseLessonEntries,
  formatLessonEntry,
  appendLessonEntry,
} from '../src/lib/memory.js';

describe('Role-based LESSONS.md Partitioning and Filtering', () => {
  const sampleLessons = `# Operational Lessons & Repository Heuristics
<!-- Invariants: Max 25 entries. Hard cap. Older entries graduate or demote to LESSONS_ARCHIVE.md -->

### [autowork] Avoid bare git commit in multi-agent runs
- **Symptom:** Concurrent agent changes swept into branch
- **Root Cause:** Bare git commit stages all staged changes
- **Rule:** Always commit explicit paths with git commit -m "..." -- <paths>

### [peer-review] Verify WCAG contrast on dark surfaces
- **Symptom:** Low contrast warnings on button elements
- **Root Cause:** Incomplete Tailwind palette mapping
- **Rule:** Check 4.5:1 ratio explicitly on all text surfaces

### [optimizer] Prune stale routine-log issues
- **Symptom:** Log issues cluttering issue tracker
- **Root Cause:** Unclosed routine-log issues older than 12h
- **Rule:** Run routine log sweep during optimizer passes

### [general] Clean up scratch files
- **Symptom:** Temp files left in worktree
- **Root Cause:** Unhandled script exits
- **Rule:** Trap EXIT in bash scripts to remove temp artifacts

### [subsystem] Legacy untagged subsystem gotcha
- **Symptom:** Cache misses on CI
- **Root Cause:** Dynamic timestamp in cache key
- **Rule:** Keep cache keys static
`;

  it('filters lessons for autowork routine: retains autowork, general, and untagged/subsystem, but excludes peer-review and optimizer', () => {
    const filtered = filterLessonsByRole(sampleLessons, 'autowork');

    expect(filtered).toContain('### [autowork] Avoid bare git commit in multi-agent runs');
    expect(filtered).toContain('### [general] Clean up scratch files');
    expect(filtered).toContain('### [subsystem] Legacy untagged subsystem gotcha');

    // Should omit other routines
    expect(filtered).not.toContain('### [peer-review] Verify WCAG contrast on dark surfaces');
    expect(filtered).not.toContain('### [optimizer] Prune stale routine-log issues');
  });

  it('filters lessons for peer-review routine: retains peer-review, general, and untagged/subsystem, but excludes autowork and optimizer', () => {
    const filtered = filterLessonsByRole(sampleLessons, 'peer-review');

    expect(filtered).toContain('### [peer-review] Verify WCAG contrast on dark surfaces');
    expect(filtered).toContain('### [general] Clean up scratch files');
    expect(filtered).toContain('### [subsystem] Legacy untagged subsystem gotcha');

    // Should omit other routines
    expect(filtered).not.toContain('### [autowork] Avoid bare git commit in multi-agent runs');
    expect(filtered).not.toContain('### [optimizer] Prune stale routine-log issues');
  });

  it('supports composite routine tags such as [autowork:git] or [general:ci]', () => {
    const customLessons = `# Operational Lessons
### [autowork:git] Scope commit paths
- **Symptom:** Dirty tree
- **Root Cause:** Unscoped add
- **Rule:** Explicit paths

### [peer-review:design] Token purity
- **Symptom:** Bespoke classes
- **Root Cause:** No token check
- **Rule:** Check tokens
`;

    const autoworkFiltered = filterLessonsByRole(customLessons, 'autowork');
    expect(autoworkFiltered).toContain('### [autowork:git] Scope commit paths');
    expect(autoworkFiltered).not.toContain('### [peer-review:design]');

    const reviewFiltered = filterLessonsByRole(customLessons, 'peer-review');
    expect(reviewFiltered).toContain('### [peer-review:design] Token purity');
    expect(reviewFiltered).not.toContain('### [autowork:git]');
  });

  it('parses structured lesson entries into metadata objects', () => {
    const entries = parseLessonEntries(sampleLessons);
    expect(entries.length).toBe(5);

    expect(entries[0].role).toBe('autowork');
    expect(entries[0].title).toBe('Avoid bare git commit in multi-agent runs');
    expect(entries[0].rule).toContain('Always commit explicit paths');

    expect(entries[1].role).toBe('peer-review');
    expect(entries[3].role).toBe('general');
  });

  it('formats a structured 3-line lesson entry under the active routine role tag', () => {
    const formatted = formatLessonEntry({
      role: 'autowork',
      title: 'Explicit git scoping',
      symptom: 'Sweeping concurrent files',
      rootCause: 'Bare commit used',
      rule: 'Always use git commit -- <paths>',
    });

    expect(formatted).toContain('### [autowork] Explicit git scoping');
    expect(formatted).toContain('- **Symptom:** Sweeping concurrent files');
    expect(formatted).toContain('- **Root Cause:** Bare commit used');
    expect(formatted).toContain('- **Rule:** Always use git commit -- <paths>');
  });

  it('appends formatted lesson entry and enforces 25-entry hard cap', () => {
    const initial = '# Operational Lessons\n<!-- Invariants: Max 25 entries. Hard cap. -->\n';
    const updated = appendLessonEntry(initial, {
      role: 'autowork',
      title: 'New gotcha',
      symptom: 'Symptom A',
      rootCause: 'Cause B',
      rule: 'Rule C',
    });

    expect(updated).toContain('### [autowork] New gotcha');

    // Test cap enforcement
    let content = initial;
    for (let i = 1; i <= 25; i++) {
      content = appendLessonEntry(content, {
        role: 'autowork',
        title: 'Lesson ' + i,
        symptom: 'Symptom ' + i,
        rootCause: 'Cause ' + i,
        rule: 'Rule ' + i,
      });
    }

    const entriesAt25 = parseLessonEntries(content);
    expect(entriesAt25.length).toBe(25);

    // Appending 26th should keep total at 25 (evicting oldest entry)
    const content26 = appendLessonEntry(content, {
      role: 'autowork',
      title: 'Lesson 26',
      symptom: 'Symptom 26',
      rootCause: 'Cause 26',
      rule: 'Rule 26',
    });

    const entriesAt26 = parseLessonEntries(content26);
    expect(entriesAt26.length).toBe(25);
    expect(entriesAt26[entriesAt26.length - 1].title).toBe('Lesson 26');
    expect(entriesAt26[0].title).toBe('Lesson 2'); // Oldest evicted
  });
});
