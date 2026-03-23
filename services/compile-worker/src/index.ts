import { Hono } from 'hono';
import { GoogleGenAI } from '@google/genai';

// ─── Types ──────────────────────────────────────────

interface LessonInput {
  heading: string;
  body: string;
  hash: string;
}

interface CompileRequest {
  lessons: LessonInput[];
  prompt: string;
  model?: string;
  concurrency?: number;
}

interface CompileResult {
  hash: string;
  response: string | null;
  error?: string;
}

// ─── Concurrency limiter ────────────────────────────

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

// ─── App ────────────────────────────────────────────

const app = new Hono();

app.get('/', (c) => c.json({ status: 'ok', service: 'totem-compile-worker' }));

app.post('/compile', async (c) => {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    return c.json({ error: 'GEMINI_API_KEY not configured' }, 500);
  }

  const body = await c.req.json<CompileRequest>();
  if (!body.lessons?.length || !body.prompt) {
    return c.json({ error: 'Missing lessons or prompt' }, 400);
  }

  // Request validation — prevent abuse
  const MAX_LESSONS = 1000;
  const MAX_PAYLOAD_CHARS = 10_000_000; // ~10MB
  if (body.lessons.length > MAX_LESSONS) {
    return c.json({ error: `Too many lessons (max ${MAX_LESSONS})` }, 400);
  }
  const payloadSize = JSON.stringify(body).length;
  if (payloadSize > MAX_PAYLOAD_CHARS) {
    return c.json({ error: `Payload too large (max ${MAX_PAYLOAD_CHARS} chars)` }, 400);
  }

  const model = body.model ?? 'gemini-3-flash-preview';
  const concurrency = Math.min(body.concurrency ?? 50, 100);
  const ai = new GoogleGenAI({ apiKey });

  const startTime = Date.now();

  const results = await mapWithConcurrency<LessonInput, CompileResult>(
    body.lessons,
    concurrency,
    async (lesson) => {
      const fullPrompt = `${body.prompt}\n\n## Lesson to Compile\n\nHeading: ${lesson.heading}\n\n${lesson.body}`;

      try {
        const response = await ai.models.generateContent({
          model,
          contents: fullPrompt,
          config: {
            temperature: 0, // Compilation is mechanical — strict JSON output, max determinism
            maxOutputTokens: 1024,
          },
        });

        const text = response.text ?? null;
        return { hash: lesson.hash, response: text };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { hash: lesson.hash, response: null, error: message };
      }
    },
  );

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const succeeded = results.filter((r) => r.response !== null).length;
  const failed = results.filter((r) => r.response === null).length;

  return c.json({
    results,
    stats: {
      total: body.lessons.length,
      succeeded,
      failed,
      concurrency,
      elapsed_seconds: parseFloat(elapsed),
    },
  });
});

import { serve } from '@hono/node-server';

const port = parseInt(process.env['PORT'] ?? '8080', 10);
serve({ fetch: app.fetch, port }, () => {
  console.log(`totem-compile-worker listening on :${port}`);
});
