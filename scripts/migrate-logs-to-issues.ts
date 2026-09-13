import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

interface LogCandidate {
  filePath: string;
  routine: string;
  timestamp: string;
  filename: string;
}

function findLatestLogs(logsBaseDir: string, limit: number = 25): LogCandidate[] {
  const candidates: LogCandidate[] = [];

  if (!fs.existsSync(logsBaseDir)) {
    return candidates;
  }

  const routines = fs.readdirSync(logsBaseDir).filter((d) => {
    return fs.statSync(path.join(logsBaseDir, d)).isDirectory();
  });

  for (const routine of routines) {
    const routineDir = path.join(logsBaseDir, routine);
    const files = fs
      .readdirSync(routineDir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md');

    for (const file of files) {
      const timestamp = file.replace(/\.md$/, '');
      candidates.push({
        filePath: path.join(routineDir, file),
        routine,
        timestamp,
        filename: file,
      });
    }
  }

  // Sort chronologically ascending so earliest runs get created first
  candidates.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Take the last `limit` items
  return candidates.slice(-limit);
}

function parseLogMetadata(content: string): {
  result: string;
  cost?: string;
  tokens?: string;
  iterations?: string;
  target?: string;
} {
  const resultMatch = content.match(/\|\s*Result\s*\|\s*`?([A-Za-z0-9_]+)`?\s*\|/i);
  const result = resultMatch ? resultMatch[1].toUpperCase() : 'SUCCESS';

  const costMatch = content.match(/\|\s*Estimated cost\s*\|\s*([^|\n]+)\|/i);
  const cost = costMatch ? costMatch[1].trim() : undefined;

  const tokensMatch = content.match(/\|\s*Total tokens\s*\|\s*([^|\n]+)\|/i);
  const tokens = tokensMatch ? tokensMatch[1].trim() : undefined;

  const iterMatch = content.match(/\|\s*Iterations used\s*\|\s*([^|\n]+)\|/i);
  const iterations = iterMatch ? iterMatch[1].trim() : undefined;

  const targetMatch = content.match(/(?:PR|Issue)\s*#?(\d+)/i);
  const target = targetMatch ? targetMatch[0] : undefined;

  return { result, cost, tokens, iterations, target };
}

export async function migrateLogs(options: { limit?: number; dryRun?: boolean } = {}) {
  const limit = options.limit ?? 25;
  const dryRun = options.dryRun ?? false;
  const repoRoot = process.cwd();
  const logsBaseDir = path.join(repoRoot, '.github', 'prompts', 'logs');

  const logs = findLatestLogs(logsBaseDir, limit);
  console.log(`Found ${logs.length} log(s) to migrate (limit: ${limit}, dryRun: ${dryRun}).\n`);

  for (let i = 0; i < logs.length; i++) {
    const item = logs[i];
    const content = fs.readFileSync(item.filePath, 'utf8');
    const { result, cost, tokens, iterations, target } = parseLogMetadata(content);

    const title = `[${item.routine}] run ${item.timestamp} - ${result}${target ? ` (${target})` : ''}`;
    const labels = [
      'routine-log',
      `routine:${item.routine}`,
      `status:${result.toLowerCase()}`,
      'historical-migration',
      'runner:github-actions',
    ];

    console.log(`[${i + 1}/${logs.length}] ${title}`);
    console.log(`   Labels: ${labels.join(', ')}`);
    console.log(`   File: ${path.relative(repoRoot, item.filePath)}`);

    if (dryRun) {
      console.log('   [dry-run] Skipped gh issue creation.\n');
      continue;
    }

    const bodyWithFooter = `${content}\n\n---\n_Historical run migrated from git log archive (\`${path.relative(repoRoot, item.filePath)}\`)._`;
    const tempBodyFile = path.join(repoRoot, `.temp-migrated-issue-body.md`);
    fs.writeFileSync(tempBodyFile, bodyWithFooter, 'utf8');

    try {
      const labelArgs = labels.map((l) => `--label "${l}"`).join(' ');
      const createCmd = `gh issue create --title "${title}" --body-file "${tempBodyFile}" ${labelArgs}`;
      const issueUrl = execSync(createCmd, { encoding: 'utf8', cwd: repoRoot }).trim();
      const issueNumberMatch = issueUrl.match(/\/issues\/(\d+)$/);
      const issueNumber = issueNumberMatch ? issueNumberMatch[1] : undefined;

      console.log(`   Created: ${issueUrl}`);

      if (issueNumber && result === 'SUCCESS') {
        execSync(`gh issue close ${issueNumber} --reason completed`, {
          encoding: 'utf8',
          cwd: repoRoot,
        });
        console.log(`   Closed issue #${issueNumber} as completed.`);
      }

      // Throttling sleep (1.5 seconds) to prevent secondary rate limits
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (err: any) {
      console.error(`   Error creating issue for ${item.filename}:`, err.message);
    } finally {
      if (fs.existsSync(tempBodyFile)) {
        fs.unlinkSync(tempBodyFile);
      }
    }

    console.log('');
  }

  console.log('Migration complete.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const isDryRun = process.argv.includes('--dry-run');
  const limitArgIndex = process.argv.indexOf('--limit');
  const limit = limitArgIndex !== -1 ? parseInt(process.argv[limitArgIndex + 1], 10) : 25;

  migrateLogs({ limit, dryRun: isDryRun }).catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
