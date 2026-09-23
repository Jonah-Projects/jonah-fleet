import { execSync } from 'node:child_process';
import pc from 'picocolors';

export interface ContributeOptions {
  title?: string;
  body?: string;
  prompt?: string;
  cwd?: string;
  repo?: string;
  dryRun?: boolean;
  executor?: (args: string[]) => Promise<string> | string;
  throwOnError?: boolean;
}

export interface ContributionPayload {
  repo: string;
  branchName: string;
  title: string;
  body: string;
  prompt?: string;
  prCommand: string;
}

export interface ContributionResult {
  success: boolean;
  dryRun?: boolean;
  branchName?: string;
  title?: string;
  prUrl?: string;
  error?: string;
}

export function prepareContributionPayload(options: ContributeOptions = {}): ContributionPayload {
  const repo = options.repo || 'Jonah-Projects/jonah-fleet';
  const title = options.title || 'fix(prompts): improve orchestrator routine handling';
  const body = options.body || 'Proposed prompt optimization discovered during autonomous execution runs.';
  const branchName = `contrib/optimize-${Date.now()}`;

  const prCommand = `gh pr create --repo ${repo} --title "${title}" --body "${body}"`;

  return {
    repo,
    branchName,
    title,
    body,
    prompt: options.prompt,
    prCommand,
  };
}

export async function runContribute(options: ContributeOptions = {}): Promise<ContributionResult> {
  console.log(pc.cyan(`\n🚀 Jonah Fleet Upstream Contribution Bridge\n`));

  const payload = prepareContributionPayload(options);

  console.log(`Preparing upstream contribution PR against ${pc.bold(payload.repo)}...`);
  console.log(`Title: ${pc.green(payload.title)}`);
  console.log(`Body:  ${pc.gray(payload.body)}\n`);

  if (options.dryRun) {
    console.log(pc.yellow(`[DRY-RUN] Would create branch: ${payload.branchName}`));
    console.log(pc.yellow(`[DRY-RUN] Would execute: ${payload.prCommand}\n`));
    return {
      success: true,
      dryRun: true,
      branchName: payload.branchName,
      title: payload.title,
    };
  }

  try {
    console.log(`Creating branch ${pc.cyan(payload.branchName)}...`);

    // Verify git status and gh CLI
    if (options.executor) {
      await options.executor(['auth', 'status']);
      const prUrl = await options.executor([
        'pr',
        'create',
        '--repo',
        payload.repo,
        '--title',
        payload.title,
        '--body',
        payload.body,
      ]);
      console.log(pc.green(`✓ Submitted upstream contribution: ${prUrl}`));
      return {
        success: true,
        branchName: payload.branchName,
        title: payload.title,
        prUrl: typeof prUrl === 'string' && prUrl.trim() ? prUrl.trim() : undefined,
      };
    } else {
      try {
        execSync('gh auth status', { stdio: 'pipe' });
      } catch {
        const errorMsg = 'GitHub CLI (`gh`) is not authenticated. Run `gh auth login` first.';
        console.error(pc.red(`❌ ${errorMsg}`));
        if (options.throwOnError) throw new Error(errorMsg);
        return { success: false, error: errorMsg };
      }

      console.log(pc.green(`✓ Ready to package and submit upstream contribution to ${payload.repo}.`));
      console.log(pc.cyan(`Command executed by optimizer routine or operator:\n`));
      console.log(`  ${payload.prCommand}\n`);
      return {
        success: true,
        branchName: payload.branchName,
        title: payload.title,
      };
    }
  } catch (err: any) {
    console.error(pc.red(`❌ Error during contribution preparation: ${err.message}`));
    if (options.throwOnError) {
      throw err;
    }
    return {
      success: false,
      error: err.message,
    };
  }
}
