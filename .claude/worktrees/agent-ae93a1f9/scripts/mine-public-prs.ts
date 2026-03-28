#!/usr/bin/env npx tsx
/**
 * mine-public-prs.ts — Extract universal lessons from public monorepo PR reviews.
 *
 * Queries GitHub for PRs with review comments containing failure-mode keywords,
 * then feeds the diffs + reviews through `totem extract` to generate lessons.
 *
 * Usage:
 *   npx tsx scripts/mine-public-prs.ts --repo vercel/next.js --limit 50
 *   npx tsx scripts/mine-public-prs.ts --repo facebook/react --keyword "race condition"
 *
 * Output: Lessons written to .totem/baselines/<repo-slug>/ for human curation.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ─── Config ────────────────────────────────────────

const DEFAULT_REPOS = ['vercel/next.js', 'facebook/react', 'trpc/trpc'];

const FAILURE_KEYWORDS = [
  'memory leak',
  'race condition',
  'stale closure',
  'infinite loop',
  'import not found',
  'module not found',
  'breaking change',
  'regression',
  'security',
  'injection',
  'XSS',
  'CSRF',
  'deprecated',
  'type error',
  'null pointer',
  'undefined is not',
  'unhandled promise',
  'deadlock',
];

const DEFAULT_LIMIT = 30;
const OUTPUT_DIR = '.totem/baselines';

// ─── CLI args ──────────────────────────────────────

const args = process.argv.slice(2);
const repoIdx = args.indexOf('--repo');
const limitIdx = args.indexOf('--limit');
const keywordIdx = args.indexOf('--keyword');

const repos = repoIdx !== -1 && args[repoIdx + 1] ? [args[repoIdx + 1]] : DEFAULT_REPOS;
const limit =
  limitIdx !== -1 && args[limitIdx + 1] ? parseInt(args[limitIdx + 1], 10) : DEFAULT_LIMIT;
const extraKeyword = keywordIdx !== -1 ? args[keywordIdx + 1] : null;

if (extraKeyword) {
  FAILURE_KEYWORDS.push(extraKeyword);
}

// ─── Types ─────────────────────────────────────────

interface PrSummary {
  number: number;
  title: string;
  reviewComments: string[];
}

// ─── GitHub queries ────────────────────────────────

/** Titles that indicate low-value PRs. */
const SKIP_TITLE_RE = /\b(bump|dependabot|renovate|typo|nit|formatting|lint fix|chore\(deps\))\b/i;

function fetchPrsWithReviews(repo: string, keyword: string, maxResults: number): PrSummary[] {
  console.log(`  Searching ${repo} for "${keyword}"...`);

  try {
    const raw = execSync(
      `gh search prs --repo ${repo} --state closed --merged --limit ${maxResults} --json number,title "${keyword}"`,
      { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] },
    );

    const prs: Array<{ number: number; title: string }> = JSON.parse(raw);
    return prs
      .filter((pr) => !SKIP_TITLE_RE.test(pr.title))
      .map((pr) => ({
        number: pr.number,
        title: pr.title,
        reviewComments: [],
      }));
  } catch {
    console.log(`  (search failed for "${keyword}" — skipping)`);
    return [];
  }
}

function fetchReviewComments(repo: string, prNumber: number): string[] {
  const comments: string[] = [];

  const endpoints = [
    `repos/${repo}/pulls/${prNumber}/comments`,
    `repos/${repo}/pulls/${prNumber}/reviews`,
    `repos/${repo}/issues/${prNumber}/comments`,
  ];

  for (const endpoint of endpoints) {
    try {
      const raw = execSync(`gh api ${endpoint} --jq '[.[].body] | join("\\n---SPLIT---\\n")'`, {
        encoding: 'utf-8',
        timeout: 15000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const bodies = raw
        .split('---SPLIT---')
        .map((b) => b.trim())
        .filter(Boolean);
      comments.push(...bodies);
    } catch {
      // Non-fatal
    }
  }

  // Filter out bot noise
  const BOT_NOISE_RE =
    /graphite|codspeed|vercel|netlify|Tests Passed|Failing test|codecov|dependabot|renovate|\[bot\]|<img|<a href/i;

  return comments.filter((c) => c.length > 100 && !BOT_NOISE_RE.test(c)).slice(0, 5);
}

// ─── Lesson extraction ─────────────────────────────

function fetchPrBody(repo: string, prNumber: number): string {
  try {
    const raw = execSync(`gh pr view ${prNumber} --repo ${repo} --json body --jq '.body'`, {
      encoding: 'utf-8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return raw.trim().slice(0, 2000);
  } catch {
    return '';
  }
}

function synthesizeLesson(pr: PrSummary, repo: string): string | null {
  // Use PR body as fallback if no review comments survived filtering
  if (pr.reviewComments.length === 0) {
    const body = fetchPrBody(repo, pr.number);
    if (body.length > 100) {
      pr.reviewComments = [body];
    } else {
      return null;
    }
  }

  const comments = pr.reviewComments.join('\n---\n').slice(0, 3000);
  const slug = repo.replace('/', '-');

  return `## Lesson — [baseline:${slug}] ${pr.title.slice(0, 50)}

**Tags:** baseline, ${slug}, universal

**Source:** ${repo}#${pr.number}

Review feedback from ${repo} PR #${pr.number}:

${comments}

**Distilled invariant:** Based on the review above, what structural rule would prevent this class of bug from being merged by an AI agent?
`;
}

// ─── Main ──────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Totem Universal Baseline Miner ===');
  console.log(`Repos: ${repos.join(', ')}`);
  console.log(`Limit: ${limit} PRs per keyword`);
  console.log(`Keywords: ${FAILURE_KEYWORDS.length}`);
  console.log();

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  let totalPrs = 0;
  let totalLessons = 0;

  for (const repo of repos) {
    console.log(`\n[${repo}]`);
    const slug = repo.replace('/', '-');
    const repoDir = path.join(OUTPUT_DIR, slug);
    fs.mkdirSync(repoDir, { recursive: true });

    const seen = new Set<number>();
    const lessons: string[] = [];

    // Sample a few keywords (not all — would be too many API calls)
    const sampledKeywords = FAILURE_KEYWORDS.sort(() => Math.random() - 0.5).slice(0, 5);

    for (const keyword of sampledKeywords) {
      const prs = fetchPrsWithReviews(repo, keyword, Math.min(limit, 10));

      for (const pr of prs) {
        if (seen.has(pr.number)) continue;
        seen.add(pr.number);

        pr.reviewComments = fetchReviewComments(repo, pr.number);
        const lesson = synthesizeLesson(pr, repo);

        if (lesson) {
          lessons.push(lesson);
          totalLessons++;
        }
        totalPrs++;
      }
    }

    // Write raw lessons for human curation
    if (lessons.length > 0) {
      const outPath = path.join(repoDir, 'raw-lessons.md');
      fs.writeFileSync(outPath, lessons.join('\n\n---\n\n'), 'utf-8');
      console.log(`  Written ${lessons.length} raw lessons to ${outPath}`);
    } else {
      console.log('  No lessons extracted.');
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`PRs analyzed: ${totalPrs}`);
  console.log(`Raw lessons: ${totalLessons}`);
  console.log(`Output: ${OUTPUT_DIR}/`);
  console.log('\nNext steps:');
  console.log('1. Review raw lessons in .totem/baselines/');
  console.log('2. Curate top 20-30 into .totem/lessons/ format');
  console.log('3. Run `totem compile` to generate invariants');
}

main().catch(console.error);
