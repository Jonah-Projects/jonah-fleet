/**
 * Operational Memory (LESSONS.md) Partitioning and Filtering
 *
 * Implements role-filtered memory recall inspired by huggingface/funes v1.6.0 (PR #214),
 * allowing autonomous routines (autowork, peer-review, optimizer, etc.) to ingest
 * only role-relevant and general lessons rather than the unbounded file.
 */

export const KNOWN_ROUTINE_ROLES = new Set([
  'autowork',
  'peer-review',
  'optimizer',
  'issues-housekeeping',
  'dependency-update-security-check',
  'product-planning',
  'analytics-review',
  'design-review',
]);

export interface LessonEntry {
  raw: string;
  role: string;
  tag: string;
  title: string;
  symptom?: string;
  rootCause?: string;
  rule?: string;
}

export interface LessonEntryInput {
  role?: string;
  tag?: string;
  title: string;
  symptom: string;
  rootCause: string;
  rule: string;
}

/**
 * Parses raw LESSONS.md content into header preamble and array of structured entries.
 */
export function parseLessonsFile(content: string): { preamble: string; entries: LessonEntry[] } {
  const match = content.search(/\n(?=###\s+)/);
  if (match === -1) {
    if (content.startsWith('### ')) {
      return { preamble: '', entries: parseLessonEntries(content) };
    }
    return { preamble: content.trimEnd(), entries: [] };
  }

  const preamble = content.slice(0, match).trimEnd();
  const body = content.slice(match + 1);
  const entries = parseLessonEntries(body);

  return { preamble, entries };
}

/**
 * Parses structured lesson entries from LESSONS.md body or full file content.
 */
export function parseLessonEntries(content: string): LessonEntry[] {
  const chunks = content.split(/\n(?=###\s+)/).filter((chunk) => chunk.trim().startsWith('### '));
  const entries: LessonEntry[] = [];

  for (const chunk of chunks) {
    const lines = chunk.trim().split('\n');
    const headerLine = lines[0];

    let tag = 'general';
    let role = 'general';
    let title = headerLine.replace(/^###\s+/, '').trim();

    const tagMatch = headerLine.match(/^###\s+\[([^\]]+)\]\s*(.*)$/);
    if (tagMatch) {
      tag = tagMatch[1].trim();
      title = tagMatch[2].trim();

      const colonIndex = tag.indexOf(':');
      const slashIndex = tag.indexOf('/');
      const splitIndex = colonIndex !== -1 ? colonIndex : slashIndex;
      const baseRole = (splitIndex !== -1 ? tag.slice(0, splitIndex) : tag).toLowerCase();

      role = baseRole;
    }

    let symptom: string | undefined;
    let rootCause: string | undefined;
    let rule: string | undefined;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      const symptomMatch = line.match(/^-\s*\*\*Symptom:\*\*\s*(.*)$/i);
      if (symptomMatch) {
        symptom = symptomMatch[1].trim();
        continue;
      }
      const rootCauseMatch = line.match(/^-\s*\*\*Root Cause:\*\*\s*(.*)$/i);
      if (rootCauseMatch) {
        rootCause = rootCauseMatch[1].trim();
        continue;
      }
      const ruleMatch = line.match(/^-\s*\*\*Rule:\*\*\s*(.*)$/i);
      if (ruleMatch) {
        rule = ruleMatch[1].trim();
        continue;
      }
    }

    entries.push({
      raw: chunk.trim(),
      role,
      tag,
      title,
      symptom,
      rootCause,
      rule,
    });
  }

  return entries;
}

/**
 * Checks whether a lesson entry matches a given routine role.
 * Includes:
 * - Direct matches (e.g. entry tagged 'autowork' when role is 'autowork')
 * - Composite matches (e.g. entry tagged 'autowork:git')
 * - 'general' entries
 * - General/legacy subsystem entries not claimed by another known routine role
 */
export function isLessonRelevantForRole(entry: LessonEntry, role: string): boolean {
  const targetRole = role.toLowerCase().trim();
  const entryRole = entry.role.toLowerCase().trim();

  if (targetRole === 'all' || targetRole === '') {
    return true;
  }

  if (entryRole === targetRole) {
    return true;
  }

  if (entryRole === 'general') {
    return true;
  }

  // If entry role is a known other routine, exclude it
  if (KNOWN_ROUTINE_ROLES.has(entryRole) && entryRole !== targetRole) {
    return false;
  }

  // Any untagged or generic subsystem gotcha (e.g. [subsystem], [git], [cache]) is general operational memory
  return true;
}

/**
 * Filters LESSONS.md content to only entries relevant for the active routine role.
 */
export function filterLessonsByRole(content: string, role: string): string {
  const { preamble, entries } = parseLessonsFile(content);
  const relevantEntries = entries.filter((entry) => isLessonRelevantForRole(entry, role));

  if (relevantEntries.length === 0) {
    return preamble ? `${preamble}\n` : '';
  }

  const entriesBlock = relevantEntries.map((e) => e.raw).join('\n\n');
  if (!preamble) {
    return `${entriesBlock}\n`;
  }

  return `${preamble}\n\n${entriesBlock}\n`;
}

/**
 * Formats a structured 3-line lesson entry under the active routine tag.
 */
export function formatLessonEntry(input: LessonEntryInput): string {
  const tag = input.tag || input.role || 'general';
  return `### [${tag}] ${input.title}\n- **Symptom:** ${input.symptom}\n- **Root Cause:** ${input.rootCause}\n- **Rule:** ${input.rule}`;
}

/**
 * Appends a new structured lesson entry to LESSONS.md, enforcing the 25-entry hard cap.
 * If adding the entry exceeds maxEntries, the oldest entries are evicted.
 */
export function appendLessonEntry(
  content: string,
  input: LessonEntryInput,
  options: { maxEntries?: number } = {}
): string {
  const maxEntries = options.maxEntries ?? 25;
  const { preamble, entries } = parseLessonsFile(content);
  const formattedNewEntry = formatLessonEntry(input);

  const newEntryParsed = parseLessonEntries(formattedNewEntry)[0];
  const allEntries = [...entries, newEntryParsed];

  // Enforce hard cap by evicting oldest entries from top
  const cappedEntries = allEntries.length > maxEntries
    ? allEntries.slice(allEntries.length - maxEntries)
    : allEntries;

  const entriesBlock = cappedEntries.map((e) => e.raw).join('\n\n');

  if (!preamble) {
    return `${entriesBlock}\n`;
  }

  return `${preamble}\n\n${entriesBlock}\n`;
}
