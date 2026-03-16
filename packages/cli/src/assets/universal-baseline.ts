/**
 * Universal Baseline Lessons — battle-tested traps extracted from
 * PR reviews in vercel/next.js, facebook/react, trpc/trpc,
 * prisma/prisma, tailwindlabs/tailwindcss, and drizzle-team/drizzle-orm.
 *
 * These ship with `totem init` to give every project immediate value.
 * Each lesson was born from real pain, not theory.
 *
 * @see .strategy/baselines/candidate-prs.md for source PRs
 * @see proposal 028 (mining public baselines)
 */

export const UNIVERSAL_BASELINE_MARKER = '<!-- totem:universal-baseline -->';

export const UNIVERSAL_BASELINE_LESSONS: Array<{
  heading: string;
  tags: string[];
  body: string;
}> = [
  // ─── Async & Promises ─────────────────────────────
  {
    heading: 'Unhandled promise rejections crash Node processes',
    tags: ['async', 'node', 'universal'],
    body: 'Every async function called without await, and every Promise without a .catch(), is a potential unhandled rejection that crashes the process in Node 15+. Always handle rejections at the call site or use a global handler. Source: vercel/next.js#15049.',
  },
  {
    heading: 'Synchronous assumptions in async boundaries',
    tags: ['async', 'api', 'universal'],
    body: 'Functions that accept callbacks or return values synchronously but are consumed in async contexts (fetch wrappers, middleware, headers) create subtle timing bugs. If a function CAN be async, treat it as async everywhere. Source: trpc/trpc#902.',
  },
  {
    heading: 'Missing state transitions in async lifecycles',
    tags: ['async', 'state', 'universal'],
    body: 'WebSocket connections, database pools, and HTTP clients have distinct states (connecting, open, closing, closed). Skipping a state transition (e.g., marking a connection as "open" without going through "connecting") causes race conditions in reconnection logic. Source: trpc/trpc#5119.',
  },

  // ─── React & Hooks ────────────────────────────────
  {
    heading: 'Stale closure from missing effect dependencies',
    tags: ['react', 'hooks', 'universal'],
    body: 'useEffect and useCallback capture variables from their closure scope. If a dependency is omitted from the array, the callback uses a stale value from a previous render. This causes bugs that are invisible in dev but corrupt state in production. Source: facebook/react#29705.',
  },
  {
    heading: 'Effects must clean up subscriptions and timers',
    tags: ['react', 'hooks', 'universal'],
    body: 'Every useEffect that creates a subscription, timer, or event listener MUST return a cleanup function. Without cleanup, effects leak memory and cause "setState on unmounted component" warnings. React StrictMode double-invokes effects specifically to catch this. Source: facebook/react#30954.',
  },
  {
    heading: 'Impure effects break in StrictMode and Concurrent Mode',
    tags: ['react', 'hooks', 'universal'],
    body: 'Effects that mutate external state (DOM, global variables, network) without idempotency will produce double side-effects when React double-invokes them in development. Design every effect to be safe to run twice. Source: facebook/react#19523.',
  },

  // ─── Server/Client Boundaries ─────────────────────
  {
    heading: 'Server-only code leaking into client bundles',
    tags: ['nextjs', 'ssr', 'universal'],
    body: 'Importing server-side constants, database clients, or API keys in shared modules causes them to be bundled into the client. Move server-only code to dedicated files and use "use server" or "server-only" guards. Source: vercel/next.js#59239.',
  },
  {
    heading: 'Hydration mismatch from environment-dependent rendering',
    tags: ['nextjs', 'ssr', 'universal'],
    body: 'Any rendering that differs between server and client (Date.now(), window checks, random values) causes hydration mismatches. Use useEffect for client-only rendering, not conditional checks in the render body. Source: vercel/next.js#44857.',
  },

  // ─── Environment & Config ─────────────────────────
  {
    heading: 'Runtime crashes from missing environment variables',
    tags: ['config', 'env', 'universal'],
    body: 'Accessing process.env.MY_VAR without validation causes undefined-as-string bugs that surface only in production. Validate ALL required environment variables at build time using a schema (Zod, envalid) and fail fast. Source: t3-oss/create-t3-app#147.',
  },
  {
    heading: 'Build-time vs runtime env var confusion',
    tags: ['config', 'env', 'universal'],
    body: 'Environment variables inlined at build time (NEXT_PUBLIC_, VITE_) are frozen into the bundle. Variables needed at runtime must be read from the server environment, not from the build. Mixing these up causes secrets to leak into client bundles or values to be stale. Source: vercel/next.js#6212.',
  },
  {
    heading: 'Hardcoded localhost URLs in production code',
    tags: ['config', 'url', 'universal'],
    body: 'WebSocket connections, API endpoints, and asset URLs that hardcode localhost or 127.0.0.1 work in dev but break in production. Always derive URLs from configuration or the request context. Source: vercel/next.js#30632.',
  },

  // ─── TypeScript & Types ───────────────────────────
  {
    heading: 'Dropped generic arguments in wrapper functions',
    tags: ['typescript', 'generics', 'universal'],
    body: 'When wrapping a generic function, failing to forward the type parameter narrows the return type to the default. This silently loses type safety for all callers. Always propagate generics through wrapper layers. Source: vercel/next.js#52498.',
  },
  {
    heading: 'Type assertions (as) bypass safety checks',
    tags: ['typescript', 'safety', 'universal'],
    body: '"as unknown as X" and "as any" suppress TypeScript errors without fixing the underlying type mismatch. Every type assertion is a potential runtime crash. Use type guards or schema validation (Zod) at system boundaries instead.',
  },

  // ─── Database & ORM ───────────────────────────────
  {
    heading: 'Schema drift between migrations and actual database',
    tags: ['database', 'migration', 'universal'],
    body: 'The migration history in version control can diverge from the actual database schema if migrations are applied manually or out of order. Always diff the expected schema against the live database before deploying. Source: prisma/prisma#11440.',
  },
  {
    heading: 'Destructive operations without baseline validation',
    tags: ['database', 'safety', 'universal'],
    body: 'Database reset, seed, or migration commands that operate without first validating the current state can destroy production data. Always snapshot or validate state before destructive operations. Source: prisma/prisma#16098.',
  },

  // ─── Performance & Resources ──────────────────────
  {
    heading: 'Synchronous work blocking the main thread',
    tags: ['performance', 'browser', 'universal'],
    body: 'CPU-intensive operations (parsing, sorting, encryption) on the main thread freeze the UI. Use requestIdleCallback, Web Workers, or async chunking for non-critical work. Source: vercel/next.js#14580.',
  },
  {
    heading: 'Unbounded payload sizes in state mechanisms',
    tags: ['performance', 'security', 'universal'],
    body: 'Cookies, headers, localStorage, and URL params have size limits. Storing unbounded data (user preferences, preview data, session state) without size validation causes silent truncation or server errors. Source: vercel/next.js#10831.',
  },

  // ─── CSS & Styling ────────────────────────────────
  {
    heading: 'CSS config changes require full rebuild',
    tags: ['css', 'tailwind', 'universal'],
    body: 'Changes to Tailwind config, PostCSS plugins, or CSS-in-JS theme tokens are not picked up by HMR. The dev server must be restarted. Fail to document this and developers waste hours debugging "why my styles aren\'t updating." Source: tailwindlabs/tailwindcss.',
  },

  // ─── Error Handling ───────────────────────────────
  {
    heading: 'Empty catch blocks hide critical failures',
    tags: ['error-handling', 'universal'],
    body: 'catch (e) {} swallows the error silently. The operation appears to succeed but downstream code operates on undefined or stale data. At minimum, log the error. Better: re-throw or return a typed error result.',
  },
  {
    heading: 'Error messages must include recovery actions',
    tags: ['error-handling', 'dx', 'universal'],
    body: 'A raw stack trace tells the developer what broke. A good error tells them how to fix it. Every user-facing error should include a concrete recovery action ("Run totem sync --full to rebuild the index").',
  },
];
