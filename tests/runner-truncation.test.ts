import { describe, it, expect } from 'vitest';
import {
  truncateHeadTail,
  truncateHeadTailDetails,
  HeadTailStreamTruncator,
  executeCommand,
  DEFAULT_MAX_LINES,
  DEFAULT_MAX_BYTES,
  DEFAULT_HEAD_LINES,
  DEFAULT_TAIL_LINES,
} from '../src/lib/runner.js';

describe('Head-Tail Streaming Truncation Guard', () => {
  describe('constants & defaults', () => {
    it('defines standard ceiling defaults', () => {
      expect(DEFAULT_MAX_LINES).toBe(500);
      expect(DEFAULT_MAX_BYTES).toBe(64 * 1024);
      expect(DEFAULT_HEAD_LINES).toBe(50);
      expect(DEFAULT_TAIL_LINES).toBe(100);
    });
  });

  describe('truncateHeadTail', () => {
    it('returns original output unmodified when within line and byte limits', () => {
      const input = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');
      const result = truncateHeadTail(input);
      expect(result).toBe(input);
      expect(result).not.toContain('truncated to preserve context window');
    });

    it('truncates output when lines exceed maxLines, preserving head and tail', () => {
      const totalLines = 600;
      const lines = Array.from({ length: totalLines }, (_, i) => `line ${i + 1}`);
      const input = lines.join('\n');

      const result = truncateHeadTail(input, {
        maxLines: 500,
        headLines: 50,
        tailLines: 100,
      });

      // Verify head preserved
      expect(result.startsWith('line 1\nline 2\n')).toBe(true);
      expect(result).toContain('line 50\n');
      expect(result).not.toContain('line 51\n');

      // Verify truncation marker
      const omittedLines = totalLines - (50 + 100); // 450
      expect(result).toMatch(new RegExp(`\\.\\.\\. \\[${omittedLines} lines / [0-9.]+ KB truncated to preserve context window\\] \\.\\.\\.`));

      // Verify tail preserved
      expect(result).not.toContain('line 500\n');
      expect(result).toContain('line 501\n');
      expect(result.endsWith('line 600')).toBe(true);
    });

    it('truncates output when bytes exceed maxBytes even if lines are below maxLines', () => {
      // 200 lines, but each line is 500 characters (~100 KB total > 64 KB)
      const totalLines = 200;
      const longContent = 'A'.repeat(500);
      const lines = Array.from({ length: totalLines }, (_, i) => `line ${i + 1}: ${longContent}`);
      const input = lines.join('\n');

      const details = truncateHeadTailDetails(input, {
        maxLines: 500,
        maxBytes: 64 * 1024,
        headLines: 50,
        tailLines: 100,
      });

      expect(details.truncated).toBe(true);
      expect(details.truncatedLines).toBe(50); // 200 - (50 + 100) = 50 lines omitted
      expect(details.truncatedBytes).toBeGreaterThan(20 * 1024);
      expect(details.text).toContain('... [50 lines /');
      expect(details.text).toContain('truncated to preserve context window] ...');
      expect(details.text.startsWith('line 1:')).toBe(true);
      expect(details.text.endsWith(longContent)).toBe(true);
    });

    it('handles single massive line exceeding maxBytes safely', () => {
      const hugeLine = 'START-' + 'X'.repeat(100 * 1024) + '-END';
      const result = truncateHeadTail(hugeLine, {
        maxBytes: 10 * 1024,
      });

      expect(result.length).toBeLessThan(15 * 1024);
      expect(result).toContain('truncated to preserve context window');
      expect(result.startsWith('START-')).toBe(true);
      expect(result.endsWith('-END')).toBe(true);
    });

    it('handles empty input gracefully', () => {
      expect(truncateHeadTail('')).toBe('');
      const details = truncateHeadTailDetails('');
      expect(details.truncated).toBe(false);
      expect(details.text).toBe('');
      expect(details.totalLines).toBe(0);
      expect(details.totalBytes).toBe(0);
    });
  });

  describe('HeadTailStreamTruncator', () => {
    it('buffers streaming chunks and accurately identifies truncation', () => {
      const truncator = new HeadTailStreamTruncator({
        maxLines: 10,
        headLines: 3,
        tailLines: 3,
      });

      for (let i = 1; i <= 20; i++) {
        truncator.feed(`line ${i}\n`);
      }
      truncator.flush();

      expect(truncator.isTruncated()).toBe(true);
      const output = truncator.getOutput();
      expect(output).toContain('line 1\nline 2\nline 3\n');
      expect(output).toContain('... [14 lines /');
      expect(output).toContain('line 18\nline 19\nline 20');
    });

    it('handles partial chunk boundaries seamlessly', () => {
      const truncator = new HeadTailStreamTruncator({
        maxLines: 5,
        headLines: 2,
        tailLines: 2,
      });

      truncator.feed('line 1\nli');
      truncator.feed('ne 2\nline 3\nli');
      truncator.feed('ne 4\nline 5\nline 6\nline 7');
      truncator.flush();

      expect(truncator.isTruncated()).toBe(true);
      const output = truncator.getOutput();
      expect(output).toContain('line 1\nline 2\n');
      expect(output).toContain('... [3 lines /');
      expect(output).toContain('line 6\nline 7');
    });
  });

  describe('executeCommand', () => {
    it('executes a basic command and captures untruncated output', async () => {
      const result = await executeCommand(process.execPath, ['-e', 'console.log("hello world")']);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello world');
      expect(result.stderr).toBe('');
      expect(result.truncated).toBe(false);
    });

    it('truncates voluminous command output exceeding line limits', async () => {
      const script = 'for (let i = 1; i <= 600; i++) console.log("record " + i);';
      const result = await executeCommand(process.execPath, ['-e', script], {
        maxLines: 500,
        headLines: 50,
        tailLines: 100,
      });

      expect(result.exitCode).toBe(0);
      expect(result.truncated).toBe(true);
      expect(result.stdout).toContain('record 1\nrecord 2');
      expect(result.stdout).toContain('... [450 lines /');
      expect(result.stdout).toContain('truncated to preserve context window');
      expect(result.stdout).toContain('record 599\nrecord 600');
    });

    it('preserves non-zero exit code and captures stderr', async () => {
      const script = 'console.error("fatal error occurred"); process.exit(42);';
      const result = await executeCommand(process.execPath, ['-e', script]);
      expect(result.exitCode).toBe(42);
      expect(result.stderr).toContain('fatal error occurred');
    });
  });
});
