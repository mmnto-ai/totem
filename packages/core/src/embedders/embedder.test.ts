import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddingProvider } from '../config-schema.js';
import { TotemConfigError } from '../errors.js';
import { createEmbedder } from './embedder.js';

// ─── Mock OpenAI embedder ──────────────────────────

vi.mock('./openai-embedder.js', () => ({
  OpenAIEmbedder: class {
    dimensions = 1536;
    private callCount = 0;
    async embed(texts: string[]): Promise<number[][]> {
      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));
      this.callCount++;
      return texts.map(() => new Array(1536).fill(this.callCount));
    }
  },
}));

// ─── Mock the @google/genai SDK as ABSENT ──────────
// mmnto-ai/totem#1859: simulate the optional peer dep being uninstalled so the
// gemini construction path (importGeminiSdk) rejects — the SDK-missing trigger
// for the Ollama fallback, distinct from the missing-API-key trigger the other
// gemini tests exercise. Inert for those key-missing tests: they throw at the
// constructor's key check, before tryBuildEmbedder reaches importGeminiSdk.
vi.mock('@google/genai', () => {
  throw new Error("Cannot find package '@google/genai'");
});

// ─── Tests ─────────────────────────────────────────

describe('createEmbedder', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env['OPENAI_API_KEY'] = originalApiKey;
    } else {
      delete process.env['OPENAI_API_KEY'];
    }
  });

  it('returns an embedder for ollama (direct, no lazy wrapper)', () => {
    const config: EmbeddingProvider = {
      provider: 'ollama',
      model: 'nomic-embed-text',
      baseUrl: 'http://localhost:11434',
    };
    const embedder = createEmbedder(config);
    expect(embedder.dimensions).toBe(768);
  });

  it('returns a lazy embedder for openai', () => {
    // Force env so constructor doesn't throw
    process.env['OPENAI_API_KEY'] = 'test-key';
    const config: EmbeddingProvider = { provider: 'openai', model: 'text-embedding-3-small' };
    const embedder = createEmbedder(config);
    expect(embedder.dimensions).toBe(1536);
  });
});

describe('LazyEmbedder concurrency', () => {
  let originalApiKey: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env['OPENAI_API_KEY'] = originalApiKey;
    } else {
      delete process.env['OPENAI_API_KEY'];
    }
  });

  it('concurrent embed() calls share the same init promise (no race condition)', async () => {
    process.env['OPENAI_API_KEY'] = 'test-key';
    const config: EmbeddingProvider = { provider: 'openai', model: 'text-embedding-3-small' };
    const embedder = createEmbedder(config);

    // Fire 3 concurrent embed calls — this is exactly what hybridSearch does
    const [r1, r2, r3] = await Promise.all([
      embedder.embed(['a']),
      embedder.embed(['b']),
      embedder.embed(['c']),
    ]);

    // All should succeed without "Cannot read properties of null"
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);
    expect(r3).toHaveLength(1);
  });
});

// The fallback chain triggers when `tryBuildEmbedder` throws (typically the
// configured provider's constructor failing on missing API key). When Ollama
// is also unreachable, callers MUST get the documented 3-step
// `TotemConfigError`. Regressing this contract pushes consumers back toward
// vendor-coupling workarounds (mmnto-ai/totem-status#8 → upstream-feedback/064 →
// mmnto-ai/totem#1851). Both fallback triggers are covered below: a missing API
// key (constructor throw) and a missing provider SDK (construction-time probe,
// mmnto-ai/totem#1859).
describe('LazyEmbedder fallback chain — regression contract (mmnto-ai/totem#1851)', () => {
  let originalGeminiKey: string | undefined;
  let originalGoogleKey: string | undefined;
  let originalOpenAIKey: string | undefined;

  beforeEach(() => {
    originalGeminiKey = process.env['GEMINI_API_KEY'];
    originalGoogleKey = process.env['GOOGLE_API_KEY'];
    originalOpenAIKey = process.env['OPENAI_API_KEY'];
    delete process.env['GEMINI_API_KEY'];
    delete process.env['GOOGLE_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    if (originalGeminiKey !== undefined) process.env['GEMINI_API_KEY'] = originalGeminiKey;
    else delete process.env['GEMINI_API_KEY'];
    if (originalGoogleKey !== undefined) process.env['GOOGLE_API_KEY'] = originalGoogleKey;
    else delete process.env['GOOGLE_API_KEY'];
    if (originalOpenAIKey !== undefined) process.env['OPENAI_API_KEY'] = originalOpenAIKey;
    else delete process.env['OPENAI_API_KEY'];
    vi.restoreAllMocks();
  });

  it('throws CONFIG_MISSING TotemConfigError with 3-step remediation when configured provider fails and Ollama is unreachable (gemini path)', async () => {
    // Force isOllamaAvailable() → false via the only network call it makes.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    const warns: string[] = [];
    const config: EmbeddingProvider = { provider: 'gemini', model: 'gemini-embedding-2-preview' };
    const embedder = createEmbedder(config, (msg) => warns.push(msg));

    let caught: unknown;
    try {
      await embedder.embed(['x']);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TotemConfigError);
    const err = caught as TotemConfigError;
    expect(err.code).toBe('CONFIG_MISSING');
    expect(err.message).toContain('No embedding provider available');
    expect(err.recoveryHint).toContain('(1) Install the SDK');
    expect(err.recoveryHint).toContain('(2) Install and start Ollama');
    expect(err.recoveryHint).toContain("(3) Set provider: 'ollama'");

    // The warn callback is the agent-facing breadcrumb that the fallback was
    // attempted before the terminal throw. Substring-match keeps copy edits
    // cheap while still locking the diagnostic chain.
    const allWarns = warns.join('\n');
    expect(allWarns).toContain('unavailable');
    expect(allWarns).toContain('Falling back to Ollama');
  });

  it('returns the Ollama fallback embedder when Ollama is reachable after configured provider fails', async () => {
    // 200 from Ollama — fallback path succeeds, no terminal throw.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'nomic-embed-text' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    const warns: string[] = [];
    const config: EmbeddingProvider = { provider: 'gemini', model: 'gemini-embedding-2-preview' };
    const embedder = createEmbedder(config, (msg) => warns.push(msg));

    // Force the LazyEmbedder to resolve. The Ollama fallback embedder will be
    // returned; we assert the warn breadcrumb fired and we don't call embed()
    // (which would hit the live Ollama HTTP API).
    let resolveErr: unknown;
    try {
      // Trigger doResolve via a direct embed call wrapped in expectation that
      // we'll get past resolve and into OllamaEmbedder.embed (which would then
      // try to fetch /api/embeddings — also fetch-mocked here, but we don't
      // need to assert on the embedding shape, only that the fallback was
      // selected).
      await embedder.embed([]);
    } catch (err) {
      resolveErr = err;
    }

    // Empty texts short-circuits OllamaEmbedder.embed → []; no throw expected.
    expect(resolveErr).toBeUndefined();
    const allWarns = warns.join('\n');
    expect(allWarns).toContain('Falling back to Ollama');
    expect(allWarns).toContain('Using Ollama fallback embedder');
  });

  // mmnto-ai/totem#1859: the SDK-missing trigger (distinct from missing-key above).
  // The API key IS present, so GeminiEmbedder constructs cleanly; only the mocked-
  // absent @google/genai SDK is missing. This asserts the construction-time SDK
  // probe: without it, importGeminiSdk() would throw inside embed() — PAST the
  // fallback boundary — surfacing the raw "Gemini SDK is not installed" error with
  // no fallback attempt (empty warns, no "No embedding provider available"). Both
  // discriminating assertions below fail on the pre-fix code, so this is non-vacuous.
  it('falls back to Ollama when the Gemini SDK is missing but the API key is present (mmnto-ai/totem#1859)', async () => {
    process.env['GEMINI_API_KEY'] = 'test-gemini-key';
    // Force isOllamaAvailable() → false so the fallback terminates at CONFIG_MISSING.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
    );

    const warns: string[] = [];
    const config: EmbeddingProvider = { provider: 'gemini', model: 'gemini-embedding-2-preview' };
    const embedder = createEmbedder(config, (msg) => warns.push(msg));

    let caught: unknown;
    try {
      await embedder.embed(['x']);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TotemConfigError);
    const err = caught as TotemConfigError;
    expect(err.code).toBe('CONFIG_MISSING');
    expect(err.message).toContain('No embedding provider available');
    // Full contract parity with the missing-key test above: the terminal error must
    // carry the documented 3-step remediation, so a refactor can't silently strip the
    // user-facing guidance while this test still passes (greptile P2, #2302).
    expect(err.recoveryHint).toContain('(1) Install the SDK');
    expect(err.recoveryHint).toContain('(2) Install and start Ollama');
    expect(err.recoveryHint).toContain("(3) Set provider: 'ollama'");

    // The fallback was attempted (breadcrumb) rather than the raw SDK error escaping.
    const allWarns = warns.join('\n');
    expect(allWarns).toContain('unavailable');
    expect(allWarns).toContain('Falling back to Ollama');
  });
});
