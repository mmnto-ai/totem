// R3 probe (mmnto-ai/totem-strategy#1193): regenerate ONE issue-anchored spec
// draft from its recorded prompt bytes three ways — unconstrained (the
// production shape), schema-constrained (Gemini responseSchema), and
// JSON-Schema-constrained with minLength — and run the strict pre-commit
// reader's TEMPLATE check on each rendering. Observation only; no verdict.
//
// Usage: node r3-structured-probe.mjs --resident D:/Dev/totem --artifact <id-prefix> --out <dir> [--runs 2]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);
const resident = args.resident ?? 'D:/Dev/totem';
const outDir = args.out ?? path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const runs = Number(args.runs ?? 2);
const artifactPrefix = args.artifact ?? 'e5a15c9c';

const runsDir = path.join(resident, '.totem', 'artifacts', 'runs');
const file = fs.readdirSync(runsDir).find((f) => f.startsWith(artifactPrefix) && f.endsWith('.json'));
if (!file) throw new Error('artifact not found: ' + artifactPrefix);
const artifact = JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'));
const prompt = artifact.inputBundle.maskedPrompt;
const model = artifact.backend.model;
const anchorLine = (prompt.match(/^=== ISSUE #(\d+): (.*) ===$/m) ?? [])[0] ?? '(no issue header)';

// The promised skeleton, in the order the built-in system prompt lists it.
const SECTIONS = [
  ['problemStatement', '### Problem Statement'],
  ['architecturalContext', '### Architectural Context'],
  ['filesToExamine', '### Files to Examine'],
  ['technicalApproachAndContracts', '### Technical Approach & Contracts'],
  ['edgeCasesAndTraps', '### Edge Cases & Traps'],
  ['implementationTasks', '### Implementation Tasks'],
  ['executionFlow', '### Execution Flow (structural constraint)'],
  ['verification', '### Verification (MANDATORY \u2014 do not skip)'],
  ['testPlan', '### Test Plan'],
];
// SPEC_REQUIRED_SECTIONS at 8d5e2691 (packages/cli/src/commands/spec-templates.ts).
const REQUIRED = ['### Problem Statement', '### Implementation Tasks'];

// ── The reader's predicates, transcribed from install-hooks.ts (8d5e2691) ──
function isHeading(line) {
  let n = 0;
  while (n < line.length && line.charAt(n) === '#') n = n + 1;
  if (n < 1 || n > 6) return false;
  if (line.charAt(n) !== ' ' && line.charAt(n) !== '\t') return false;
  return line.slice(n + 1).trim().length > 0;
}
function templateCheck(subject, required) {
  if (subject.charCodeAt(0) === 65279) subject = subject.slice(1);
  const lines = subject.split('\n');
  const hasBodyAfter = (start) => {
    for (let i = start + 1; i < lines.length; i++) {
      if (isHeading(lines[i])) return false;
      if (lines[i].trim().length > 0) return true;
    }
    return false;
  };
  const reasons = [];
  for (const heading of required) {
    let at = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trimEnd() === heading) { at = i; break; }
    }
    if (at < 0) { reasons.push('missing heading ' + heading); continue; }
    if (!hasBodyAfter(at)) reasons.push('empty heading ' + heading);
  }
  return { ok: reasons.length === 0, reasons };
}
function sectionBodies(markdown) {
  const lines = markdown.split('\n');
  const out = {};
  for (const [, heading] of SECTIONS) {
    const at = lines.findIndex((l) => l.trimEnd() === heading);
    if (at < 0) { out[heading] = null; continue; }
    const body = [];
    for (let i = at + 1; i < lines.length; i++) {
      if (isHeading(lines[i])) break;
      body.push(lines[i]);
    }
    out[heading] = body.join('\n').trim().length;
  }
  return out;
}
function render(obj) {
  return SECTIONS.map(([key, heading]) => heading + '\n' + String(obj[key] ?? '').trim() + '\n').join('\n');
}

// ── Gemini SDK, the same package the CLI orchestrator imports (2.6.0) ──
const sdkPath = path.resolve(outDir, '..', '..', '..', 'packages', 'cli', 'node_modules', '@google', 'genai', 'dist', 'node', 'index.mjs');
const { GoogleGenAI } = await import('file:///' + sdkPath.replace(/\\/g, '/'));
const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY missing');
const ai = new GoogleGenAI({ apiKey });
const MAX_OUTPUT_TOKENS = 16_384; // DEFAULT_MAX_OUTPUT_TOKENS in gemini-orchestrator.ts

const responseSchema = {
  type: 'OBJECT',
  properties: Object.fromEntries(SECTIONS.map(([k]) => [k, { type: 'STRING' }])),
  required: SECTIONS.map(([k]) => k),
  propertyOrdering: SECTIONS.map(([k]) => k),
};
const responseJsonSchema = {
  type: 'object',
  properties: Object.fromEntries(SECTIONS.map(([k]) => [k, { type: 'string', minLength: 1 }])),
  required: SECTIONS.map(([k]) => k),
  additionalProperties: false,
};

const ARMS = [
  { name: 'unconstrained', config: {} },
  { name: 'responseSchema', config: { responseMimeType: 'application/json', responseSchema } },
  { name: 'responseJsonSchema-minLength1', config: { responseMimeType: 'application/json', responseJsonSchema } },
];

async function callOnce(arm) {
  const t0 = Date.now();
  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: { maxOutputTokens: MAX_OUTPUT_TOKENS, ...arm.config },
    });
    return {
      ok: true,
      text: response.text ?? '',
      durationMs: Date.now() - t0,
      inputTokens: response.usageMetadata?.promptTokenCount ?? null,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
      finishReason: response.candidates?.[0]?.finishReason ?? null,
    };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err).slice(0, 600), durationMs: Date.now() - t0 };
  }
}

const results = [];
for (const arm of ARMS) {
  for (let r = 0; r < runs; r++) {
    const call = await callOnce(arm);
    const row = { arm: arm.name, run: r + 1, ...call };
    if (call.ok) {
      let markdown = call.text;
      if (arm.name !== 'unconstrained') {
        try {
          const obj = JSON.parse(call.text);
          row.jsonParsed = true;
          row.keys = Object.keys(obj);
          row.emptyValues = SECTIONS.filter(([k]) => String(obj[k] ?? '').trim().length === 0).map(([k]) => k);
          row.missingKeys = SECTIONS.filter(([k]) => !(k in obj)).map(([k]) => k);
          markdown = render(obj);
        } catch (e) {
          row.jsonParsed = false;
          row.parseError = String(e.message).slice(0, 200);
          markdown = call.text;
        }
      }
      row.markdownLength = markdown.length;
      row.reader = templateCheck(markdown, REQUIRED);
      row.readerAllNine = templateCheck(markdown, SECTIONS.map(([, h]) => h));
      row.exactHeadingsPresent = SECTIONS.filter(([, h]) => markdown.split('\n').some((l) => l.trimEnd() === h)).length;
      row.sectionBodyLengths = sectionBodies(markdown);
      row.textSha256Prefix = (await import('node:crypto')).createHash('sha256').update(call.text).digest('hex').slice(0, 12);
      fs.writeFileSync(path.join(outDir, 'r3-' + arm.name + '-run' + (r + 1) + '.md'), markdown);
    }
    results.push(row);
    console.log(JSON.stringify({ arm: row.arm, run: row.run, ok: row.ok, ms: row.durationMs, out: row.outputTokens, finish: row.finishReason, reader: row.reader?.ok, nine: row.readerAllNine?.ok, headings: row.exactHeadingsPresent, empty: row.emptyValues, err: row.error }));
  }
}

const record = {
  probe: 'R3 structured-output (mmnto-ai/totem-strategy#1193)',
  at: new Date().toISOString(),
  host: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version },
  artifact: { id: file.replace(/\.json$/, ''), createdAt: artifact.createdAt, model, anchorLine, promptChars: prompt.length, originalOutputChars: artifact.output.content.length },
  originalReader: templateCheck(artifact.output.content, REQUIRED),
  originalAllNine: templateCheck(artifact.output.content, SECTIONS.map(([, h]) => h)),
  originalHeadingsPresent: SECTIONS.filter(([, h]) => artifact.output.content.split('\n').some((l) => l.trimEnd() === h)).length,
  required: REQUIRED,
  sections: SECTIONS.map(([, h]) => h),
  sdk: '@google/genai 2.6.0',
  maxOutputTokens: MAX_OUTPUT_TOKENS,
  arms: ARMS.map((a) => ({ name: a.name, config: a.config })),
  results,
};
fs.writeFileSync(path.join(outDir, 'r3-structured-probe.json'), JSON.stringify(record, null, 2));
console.log('wrote', path.join(outDir, 'r3-structured-probe.json'));
