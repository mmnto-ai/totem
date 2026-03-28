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
    body: 'Every async function called without await, and every Promise without a .catch(), is a potential unhandled rejection that crashes the process in Node 15+. Always handle rejections at the call site or use a global handler. Source: vercel/next.js#15049. Fix: Add .catch() to every unhandled Promise chain, or use try/catch with await. Register a process.on("unhandledRejection") handler as a safety net.',
  },
  {
    heading: 'Synchronous assumptions in async boundaries',
    tags: ['async', 'api', 'universal'],
    body: 'Functions that accept callbacks or return values synchronously but are consumed in async contexts (fetch wrappers, middleware, headers) create subtle timing bugs. If a function CAN be async, treat it as async everywhere. Source: trpc/trpc#902. Fix: Ensure all functions in an async chain are explicitly marked async and awaited.',
  },
  {
    heading: 'Missing state transitions in async lifecycles',
    tags: ['async', 'state', 'universal'],
    body: 'WebSocket connections, database pools, and HTTP clients have distinct states (connecting, open, closing, closed). Skipping a state transition (e.g., marking a connection as "open" without going through "connecting") causes race conditions in reconnection logic. Source: trpc/trpc#5119. Fix: Implement explicit state machines with all transitional states (e.g., "connecting") to prevent race conditions.',
  },

  // ─── React & Hooks ────────────────────────────────
  {
    heading: 'Stale closure from missing effect dependencies',
    tags: ['react', 'hooks', 'universal'],
    body: 'useEffect and useCallback capture variables from their closure scope. If a dependency is omitted from the array, the callback uses a stale value from a previous render. This causes bugs that are invisible in dev but corrupt state in production. Source: facebook/react#29705. Fix: Include all variables from the component scope used inside the effect in the dependency array, or use ESLint exhaustive-deps.',
  },
  {
    heading: 'Effects must clean up subscriptions and timers',
    tags: ['react', 'hooks', 'universal'],
    body: 'Every useEffect that creates a subscription, timer, or event listener MUST return a cleanup function. Without cleanup, effects leak memory and cause "setState on unmounted component" warnings. React StrictMode double-invokes effects specifically to catch this. Source: facebook/react#30954. Fix: Return a cleanup function from every useEffect that unsubscribes, clears timers, or removes listeners.',
  },
  {
    heading: 'Impure effects break in StrictMode and Concurrent Mode',
    tags: ['react', 'hooks', 'universal'],
    body: 'Effects that mutate external state (DOM, global variables, network) without idempotency will produce double side-effects when React double-invokes them in development. Design every effect to be safe to run twice. Source: facebook/react#19523. Fix: Make effects idempotent. Ensure cleanup functions fully reverse any mutations or subscriptions created by the effect.',
  },

  // ─── Server/Client Boundaries ─────────────────────
  {
    heading: 'Server-only code leaking into client bundles',
    tags: ['nextjs', 'ssr', 'universal'],
    body: 'Importing server-side constants, database clients, or API keys in shared modules causes them to be bundled into the client. Move server-only code to dedicated files and use "use server" or "server-only" guards. Source: vercel/next.js#59239. Fix: Move server-only imports to files that import the "server-only" package, or use "use server" directives.',
  },
  {
    heading: 'Hydration mismatch from environment-dependent rendering',
    tags: ['nextjs', 'ssr', 'universal'],
    body: 'Any rendering that differs between server and client (Date.now(), window checks, random values) causes hydration mismatches. Use useEffect for client-only rendering, not conditional checks in the render body. Source: vercel/next.js#44857. Fix: Move environment-dependent rendering into useEffect or use the suppressHydrationWarning prop for intentional mismatches.',
  },

  // ─── Environment & Config ─────────────────────────
  {
    heading: 'Runtime crashes from missing environment variables',
    tags: ['config', 'env', 'universal'],
    body: 'Accessing process.env.MY_VAR without validation causes undefined-as-string bugs that surface only in production. Validate ALL required environment variables at build time using a schema (Zod, envalid) and fail fast. Source: t3-oss/create-t3-app#147. Fix: Validate environment variables at application startup using a schema library like Zod.',
  },
  {
    heading: 'Build-time vs runtime env var confusion',
    tags: ['config', 'env', 'universal'],
    body: 'Environment variables inlined at build time (NEXT_PUBLIC_, VITE_) are frozen into the bundle. Variables needed at runtime must be read from the server environment, not from the build. Mixing these up causes secrets to leak into client bundles or values to be stale. Source: vercel/next.js#6212. Fix: Use NEXT_PUBLIC_ or VITE_ prefixes only for non-secret values. Read secrets from the server environment at runtime, never at build time.',
  },
  {
    heading: 'Hardcoded localhost URLs in production code',
    tags: ['config', 'url', 'universal'],
    body: 'WebSocket connections, API endpoints, and asset URLs that hardcode localhost or 127.0.0.1 work in dev but break in production. Always derive URLs from configuration or the request context. Source: vercel/next.js#30632. Fix: Read base URLs from environment variables or derive from the incoming request (req.headers.host). Never hardcode host/port.',
  },

  // ─── TypeScript & Types ───────────────────────────
  {
    heading: 'Dropped generic arguments in wrapper functions',
    tags: ['typescript', 'generics', 'universal'],
    body: 'When wrapping a generic function, failing to forward the type parameter narrows the return type to the default. This silently loses type safety for all callers. Always propagate generics through wrapper layers. Source: vercel/next.js#52498. Fix: Explicitly forward type parameters in wrapper function signatures: function wrap<T>(fn: () => T): T.',
  },
  {
    heading: 'Type assertions (as) bypass safety checks',
    tags: ['typescript', 'safety', 'universal'],
    body: '"as unknown as X" and "as any" suppress TypeScript errors without fixing the underlying type mismatch. Every type assertion is a potential runtime crash. Use type guards or schema validation (Zod) at system boundaries instead. Fix: Replace type assertions with runtime type guards (if/typeof checks) or Zod schema parsing at system boundaries.',
  },

  // ─── Database & ORM ───────────────────────────────
  {
    heading: 'Schema drift between migrations and actual database',
    tags: ['database', 'migration', 'universal'],
    body: 'The migration history in version control can diverge from the actual database schema if migrations are applied manually or out of order. Always diff the expected schema against the live database before deploying. Source: prisma/prisma#11440. Fix: Run schema diff (e.g., prisma db pull + prisma migrate diff) against the live database before every deployment.',
  },
  {
    heading: 'Destructive operations without baseline validation',
    tags: ['database', 'safety', 'universal'],
    body: 'Database reset, seed, or migration commands that operate without first validating the current state can destroy production data. Always snapshot or validate state before destructive operations. Source: prisma/prisma#16098. Fix: Require a --force flag or environment check (NODE_ENV !== "production") before destructive database operations.',
  },

  // ─── Performance & Resources ──────────────────────
  {
    heading: 'Synchronous work blocking the main thread',
    tags: ['performance', 'browser', 'universal'],
    body: 'CPU-intensive operations (parsing, sorting, encryption) on the main thread freeze the UI. Use requestIdleCallback, Web Workers, or async chunking for non-critical work. Source: vercel/next.js#14580. Fix: Move CPU-intensive work to a Web Worker or use requestIdleCallback/setTimeout chunking to yield to the main thread.',
  },
  {
    heading: 'Unbounded payload sizes in state mechanisms',
    tags: ['performance', 'security', 'universal'],
    body: 'Cookies, headers, localStorage, and URL params have size limits. Storing unbounded data (user preferences, preview data, session state) without size validation causes silent truncation or server errors. Source: vercel/next.js#10831. Fix: Implement strict size limits and truncation/pagination logic for stored data payloads.',
  },

  // ─── CSS & Styling ────────────────────────────────
  {
    heading: 'CSS config changes require full rebuild',
    tags: ['css', 'tailwind', 'universal'],
    body: 'Changes to Tailwind config, PostCSS plugins, or CSS-in-JS theme tokens are not picked up by HMR. The dev server must be restarted. Fail to document this and developers waste hours debugging "why my styles aren\'t updating." Source: tailwindlabs/tailwindcss. Fix: Restart the dev server after modifying tailwind.config.*, postcss.config.*, or theme token files.',
  },

  // ─── Error Handling ───────────────────────────────
  {
    heading: 'Empty catch blocks hide critical failures',
    tags: ['error-handling', 'universal'],
    body: 'catch (e) {} swallows the error silently. The operation appears to succeed but downstream code operates on undefined or stale data. At minimum, log the error. Better: rethrow or return a typed error result. Fix: At minimum, log the error with context. If the error is truly safe to ignore, add a comment explaining why.',
  },
  {
    heading: 'Dev tooling modifying execution paths incorrectly',
    tags: ['dx', 'tooling', 'universal'],
    body: 'Development overlays or debuggers that inject elements or modify the component tree must defer execution until after initial hydration. Injecting UI too early causes position-dependent hooks (like useId) to generate inconsistent values between server and client. Source: vercel/next.js#75199. Fix: Wrap dev-only UI injections in a useEffect to ensure they execute after hydration completes.',
  },
  {
    heading: 'Environment-specific URL handling leaking across boundaries',
    tags: ['config', 'url', 'universal'],
    body: 'Local development often uses specialized protocols (e.g., file:// or turbopack://) that do not exist in production environments. Code handling source maps, static assets, or metadata must normalize these URIs at the environment boundary to prevent broken paths when deployed. Source: vercel/next.js#71489. Fix: Normalize URLs at the environment boundary using new URL() or a path resolver that strips dev-only protocols.',
  },
  {
    heading: 'Regex/Matcher divergence between dev and prod runtimes',
    tags: ['routing', 'regex', 'universal'],
    body: 'Middleware matchers or routing regular expressions that rely on environment-specific syntax or Node.js features may fail silently when compiled for Edge or V8 runtimes in production. Always test complex matchers in the target execution environment. Source: vercel/next.js#69602. Fix: Test routing matchers and regex in the production runtime (Edge/V8). Avoid Node.js-specific regex features like lookbehind in Edge middleware.',
  },
  {
    heading: 'Swallowing critical errors during SSR',
    tags: ['ssr', 'error-handling', 'universal'],
    body: 'Hydration errors or SSR mismatches should not be caught and silenced by generic error boundaries without explicit logging. Masking these errors during development leads to unstable UI state and broken interactive elements in production. Source: vercel/next.js#44857. Fix: Explicitly log SSR errors to your monitoring service before allowing error boundaries to render fallback UI.',
  },
  {
    heading: 'Compiler transforms breaking CSS-in-JS injection',
    tags: ['compiler', 'css', 'universal'],
    body: 'Custom AST transformations or compiler plugins (like SWC/Babel) can inadvertently strip or reorder the styled-component injection tags required by CSS-in-JS libraries. Always ensure CSS extraction logic is preserved during AST compilation. Source: vercel/next.js#34687. Fix: Add integration tests that verify CSS-in-JS output survives AST transformation. Whitelist injection markers in compiler plugins.',
  },
  {
    heading: 'Internal modules establishing cyclic dependencies on ambient type declarations',
    tags: ['typescript', 'types', 'universal'],
    body: "Internal framework code should never import directly from auto-generated ambient type declaration files (e.g., next-env.d.ts). This creates a cyclic dependency where the framework relies on the user's generated types to compile. Source: vercel/next.js#34394. Fix: Define explicit interface contracts within the framework rather than relying on user-generated ambient types.",
  },
  {
    heading: 'Context flags misaligned during edge compilation',
    tags: ['compiler', 'edge', 'universal'],
    body: 'When compiling code for Edge runtimes, standard environmental flags (like isServer or isClient) must be explicitly handled. Assuming Edge is purely "client" or purely "server" leads to incorrectly stripping required polyfills or exposing sensitive logic. Source: vercel/next.js#30242. Fix: Treat Edge as a third runtime context. Add explicit isEdge checks alongside isServer/isClient in conditional compilation.',
  },
  {
    heading: 'FS watchers failing to handle atomic file renames',
    tags: ['fs', 'tooling', 'universal'],
    body: 'When building file-system watchers, do not assume files are only "created" or "modified". Editors and OS operations frequently use atomic renames (moving a temp file over an existing file). Failure to handle the "rename" event leads to stale caches and missed updates. Source: vercel/next.js#10351. Fix: Handle "rename" events in fs.watch/chokidar watchers. Re-read the file on rename to pick up atomic saves.',
  },
  {
    heading: 'Style injection breaking modular chunk loading',
    tags: ['css', 'bundler', 'universal'],
    body: "Injecting global CSS script tags directly into granular, dynamically loaded JavaScript chunks can cause race conditions or duplicate style definitions. CSS should be extracted and managed by the bundler's dedicated style loader, not inline scripts. Source: vercel/next.js#9306. Fix: Use the bundler's built-in CSS extraction (e.g., mini-css-extract-plugin) instead of injecting style tags in JS chunks.",
  },
  {
    heading: 'Hardcoding third-party SDK dependencies into core logic',
    tags: ['architecture', 'coupling', 'universal'],
    body: 'Core routing or state management logic should never directly import third-party SDKs (e.g., Auth0, Stripe). Abstract these behind provider interfaces. Hardcoding them prevents replacing the vendor and breaks the application if the SDK is unavailable. Source: vercel/next.js#8802. Fix: Inject dependencies using the Dependency Inversion Principle, wrapping SDKs in project-specific provider interfaces.',
  },
  {
    heading: 'Leaking proprietary rendering logic into generic component trees',
    tags: ['architecture', 'react', 'universal'],
    body: 'Framework-specific rendering paradigms (like AMP or specific SSR wrappers) should not leak down into generic, reusable UI components. Passing framework-specific props deeply into the tree prevents those components from being used in other contexts. Source: vercel/next.js#7669. Fix: Keep generic components unaware of their rendering context; pass necessary data via standard props.',
  },
  {
    heading: 'Hook rules violation inside memoization callbacks',
    tags: ['react', 'hooks', 'universal'],
    body: 'Never call a React Hook (useContext, useState) inside the callback function passed to useMemo, useCallback, or React.memo. This breaks the fundamental rule of hooks (call order) because the memoized function is executed unpredictably. Source: facebook/react#14608. Fix: Move hook calls to the component body. Pass hook return values into memoization callbacks as dependencies.',
  },
  {
    heading: 'Race conditions during batched state updates',
    tags: ['react', 'state', 'universal'],
    body: 'When deriving state from props (e.g., getDerivedStateFromProps), assume that multiple state updates might be batched together. Relying on the intermediate state synchronously before the batch completes will result in torn UI or dropped updates. Source: facebook/react#12408. Fix: Use the functional update form of setState (e.g., setState(prev => ...)) when new state depends on previous state.',
  },
  {
    heading: 'Swallowing nested errors across rendering boundaries',
    tags: ['react', 'error-handling', 'universal'],
    body: 'When building error boundaries or guarded execution callbacks, ensure that an error thrown in a deeply nested renderer (like a portal or a custom renderer) correctly bubbles up to the primary boundary. Swallowing cross-boundary errors masks fatal crashes. Source: facebook/react#10270. Fix: Ensure custom renderers and portals propagate exceptions up to the closest React Error Boundary.',
  },
  {
    heading: 'Monolithic structures containing untestable generic utilities',
    tags: ['architecture', 'testing', 'universal'],
    body: 'Do not hide generic, pure utility functions (e.g., string formatting, math calculations) inside massive, stateful class components or UI modules. Extract them into separate files so they can be unit tested in isolation without mocking the DOM. Source: facebook/react#9658. Fix: Extract pure utility functions into separate, standalone modules and write isolated unit tests for them.',
  },
  {
    heading: 'Insufficient context in error logging for dynamically typed inputs',
    tags: ['error-handling', 'dx', 'universal'],
    body: 'When throwing errors about invalid inputs (e.g., "Expected a string, got object"), always include a stack trace or the specific key/component name that caused the error. Generic type errors without context are impossible to debug in large trees. Source: facebook/react#8495. Fix: Include the component name, prop key, and received typeof in error messages. Use Error.captureStackTrace where available.',
  },
  {
    heading: 'Silent failures in static lifecycle methods',
    tags: ['react', 'error-handling', 'universal'],
    body: 'Errors thrown inside static lifecycle methods (like getDerivedStateFromProps) can sometimes fail silently if the framework does not explicitly wrap them in a logging boundary, as they execute outside the standard render flow. Always log exceptions at the boundary. Source: facebook/react#15797. Fix: Wrap static lifecycle methods in try/catch and report errors to your monitoring service.',
  },
  {
    heading: 'Serialization failures when passing complex objects to devtools',
    tags: ['tooling', 'serialization', 'universal'],
    body: 'When exposing internal state to DevTools or logger overlays, ensure the payload is serializable. Passing complex objects with circular references, functions, or Symbols will crash the DevTools bridge. Use useDebugValue with a formatter. Source: facebook/react#18070. Fix: Use useDebugValue with a format function. Strip non-serializable values (functions, Symbols, circular refs) before passing to DevTools.',
  },
  {
    heading: 'Bypassing standard synthetic event systems for performance',
    tags: ['react', 'events', 'universal'],
    body: "Bypassing the framework's synthetic event system (e.g., attaching raw DOM event listeners) to gain performance often breaks event pooling, batching, and cross-platform compatibility (like React Native). Only bypass the event system when absolutely necessary and document the trade-off. Source: facebook/react#23232. Fix: Stick to standard React event handlers unless profiling proves native DOM events are strictly required, and document the exception.",
  },
  {
    heading: 'Compiler transforms invalidating internal context tracking',
    tags: ['compiler', 'react', 'universal'],
    body: 'When writing AST transforms or compiler optimizations, do not rewrite or reorder calls to `useContext` or other hooks that rely on internal fiber state tracking. Moving a hook call outside of its expected execution context breaks the React runtime. Source: facebook/react#30612. Fix: Ensure custom Babel/SWC plugins maintain the exact order and scope of hook calls during AST transformation.',
  },
  {
    heading: 'Memory leaks caused by calling setState on unmounted components',
    tags: ['react', 'memory', 'universal'],
    body: 'Always cancel active asynchronous requests (fetch, setTimeout) when a component unmounts. Calling `setState` after the component is destroyed causes memory leaks and React warnings. Use AbortController or a mounted flag ref. Source: facebook/react#12531. Fix: Use AbortController in useEffect cleanup to cancel fetch requests. Clear timeouts/intervals in the cleanup return function.',
  },
  {
    heading: 'Leaking heavy development-only assertions into production bundles',
    tags: ['performance', 'bundler', 'universal'],
    body: 'Costly validation logic, deep object comparisons, and verbose error strings must be wrapped in `if (__DEV__)` or `if (process.env.NODE_ENV !== "production")` blocks so the bundler can strip them out via Dead Code Elimination. Source: facebook/react#10316. Fix: Wrap dev-only assertions in if (process.env.NODE_ENV !== "production") blocks. The bundler will tree-shake them out of production builds.',
  },
  {
    heading: 'Assuming `setState` is synchronous',
    tags: ['react', 'state', 'universal'],
    body: 'Never read `this.state` or a state variable immediately after calling `setState`. State updates are batched and asynchronous. If the next state depends on the previous state, use the updater function form: `setState((prev) => prev + 1)`. Source: facebook/react#9329. Fix: Use the functional update form: setState(prev => prev + 1). Never read state immediately after setting it.',
  },
  {
    heading: 'Evaluating defaultProps before lazy component resolution',
    tags: ['react', 'lazy', 'universal'],
    body: 'When using lazy loading or dynamic imports, do not attempt to merge or evaluate `defaultProps` before the underlying module has fully resolved. This causes synchronous crashes. Defer prop resolution until the render phase. Source: facebook/react#14112. Fix: Apply default values during component render (e.g., destructuring with defaults) rather than relying on defaultProps for lazy components.',
  },
  {
    heading: 'Connection pooling leaks in underlying HTTP clients',
    tags: ['database', 'network', 'universal'],
    body: 'When initializing database clients or ORMs (like Prisma), ensure the underlying HTTP client (e.g., undici or node-fetch) has strict timeouts and connection pool limits. Infinite keep-alive connections will exhaust server sockets under load. Source: prisma/prisma#8831. Fix: Explicitly configure keep-alive timeouts and connection limits on HTTP clients used by ORMs.',
  },
  {
    heading: 'Type loss across SQL aggregate boundaries',
    tags: ['database', 'typescript', 'universal'],
    body: 'When executing raw SQL or aggregate functions (`count`, `sum`) in a type-safe ORM, ensure the return type is explicitly cast or parsed. SQL drivers often return aggregates as strings (e.g., "10" instead of 10) to prevent precision loss, breaking TS assumptions. Source: drizzle-team/drizzle-orm#1487. Fix: Explicitly parse aggregate results with Number() or parseInt(). Define return types for raw SQL queries instead of relying on inference.',
  },
  {
    heading: 'Lateral joins breaking query builder schema resolution',
    tags: ['database', 'sql', 'universal'],
    body: 'Advanced SQL features like `LATERAL` joins introduce dynamic scoping where subqueries reference columns from preceding tables. Query builders must correctly resolve these scope chains, or they will generate invalid SQL or lose type safety. Source: drizzle-team/drizzle-orm#1079. Fix: Use raw SQL for complex joins that the query builder does not support natively. Verify generated SQL with .toSQL() before execution.',
  },
  {
    heading: 'Driver-specific adapters leaking into core query logic',
    tags: ['database', 'architecture', 'universal'],
    body: 'Keep SQL query generation strictly separated from driver-specific execution (e.g., Postgres vs MySQL vs SQLite). Passing driver connection objects deep into the query builder tightly couples the ORM to a specific database vendor. Source: drizzle-team/drizzle-orm#5222. Fix: Create an abstraction layer for query execution that accepts generic query objects rather than driver-specific connection instances.',
  },
  {
    heading: 'Desync between .env templates and validation schemas',
    tags: ['config', 'env', 'universal'],
    body: 'If you maintain a `.env.example` file and a Zod schema for environment variables, they must be kept in perfect sync. Adding a variable to one without the other causes either failing builds or confusing onboarding experiences. Source: t3-oss/create-t3-app#430. Fix: Add a CI check or pre-commit hook that validates .env.example keys match the Zod schema keys.',
  },
  {
    heading: 'Incomplete database lifecycles in scaffolding templates',
    tags: ['database', 'tooling', 'universal'],
    body: 'When providing scripts to setup a project, ensure the database lifecycle is complete: generation, migration, and seeding. Providing a `db:generate` script without a `db:migrate` script leaves the developer in a broken state upon initial launch. Source: t3-oss/create-t3-app#1893. Fix: Provide a comprehensive setup script that sequentially runs generation, migration, and seeding.',
  },
  {
    heading: 'Side-effect imports executing out of order due to lack of sorting',
    tags: ['javascript', 'imports', 'universal'],
    body: 'If modules rely on side-effects (e.g., polyfills, global CSS, or environment initializers), the import order is critical. Use an automated tool (like Prettier plugin or ESLint) to deterministically sort imports to prevent fragile execution orders. Source: t3-oss/create-t3-app#1392. Fix: Use eslint-plugin-import or @trivago/prettier-plugin-sort-imports. Mark side-effect imports with a comment to prevent reordering.',
  },
  {
    heading: 'Hardcoded component logic inside top-level layout files',
    tags: ['architecture', 'react', 'universal'],
    body: 'Root `_app.tsx` or `layout.tsx` files should be as thin as possible, containing only context providers and structure. Hardcoding complex UI logic (like splash screens or modals) directly in the layout makes it impossible to reuse or test. Extract to components. Source: t3-oss/create-t3-app#178. Fix: Extract UI logic from layout files into dedicated components. Layouts should only compose providers and structural wrappers.',
  },
  {
    heading: 'Scaffolding scripts failing to respect existing .git states',
    tags: ['tooling', 'git', 'universal'],
    body: 'CLI tools that generate projects (like `create-t3-app` or `totem init`) must check if a `.git` directory already exists before attempting to run `git init`. Blindly initializing git can corrupt an existing repository or submodule structure. Source: t3-oss/create-t3-app#4. Fix: Check for .git directory existence before running git init. Skip initialization if already a git repo.',
  },
  {
    heading: 'Specificity overrides breaking AST/string serialization',
    tags: ['css', 'compiler', 'universal'],
    body: 'When parsing or generating CSS (e.g., adding `!important`), ensure the AST formatter correctly handles the spacing and placement of the token. Appending `!important` without respecting the original declaration structure leads to malformed CSS strings. Source: tailwindlabs/tailwindcss#14611. Fix: Use an AST-aware CSS parser to safely inject modifiers like !important instead of string concatenation.',
  },
  {
    heading: 'Implicit ordering dependencies in CSS cascade generation',
    tags: ['css', 'architecture', 'universal'],
    body: 'When generating utility classes (like Tailwind), the final output order determines the CSS cascade specificity. Do not rely on the implicit order of object keys in JavaScript. Use explicit directives (`@layer`, `@tailwind`) to guarantee the cascade order. Source: tailwindlabs/tailwindcss#88. Fix: Use @layer directives to explicitly control CSS cascade order. Never rely on JavaScript object key ordering for CSS specificity.',
  },

  // ─── AI-Assisted Workflows (Solo Dev / Cursor Guardrails) ─────────
  {
    heading: 'Isolation of localized component changes',
    tags: ['workflow', 'ai-agent', 'universal'],
    body: 'When asked to implement a local feature (e.g., adding a button state), DO NOT rewrite the surrounding layout, change the CSS framework, or refactor sibling components unless explicitly instructed. Isolate the state change locally to prevent cascading breakages. Fix: Restrict your edits only to the specific component requested, leaving surrounding architecture and layouts untouched.',
  },
  {
    heading: 'Premature abstraction of duplicated code',
    tags: ['architecture', 'ai-agent', 'universal'],
    body: 'Do not abstract repetitive code (like fetch calls or UI wrappers) into complex generic utilities until the exact pattern has been duplicated at least three times in separate domains (The Rule of Three). Premature generic abstraction ruins prototyping velocity. Fix: Wait until code is duplicated at least three times across different contexts before refactoring it into a shared abstraction.',
  },
  {
    heading: 'Silent failures and "TODO" placeholders',
    tags: ['workflow', 'dx', 'universal'],
    body: 'If a requested feature cannot be fully implemented due to missing context or complexity, you MUST throw an explicit error or insert a highly visible UI warning (e.g., `<div style="color:red">NOT IMPLEMENTED</div>`). Never fail silently by returning null or leaving a hidden `// TODO` comment. Fix: Raise a NotImplementedError or render a visible placeholder. Never return null or leave a hidden TODO.', // totem-ignore — lesson content, not code
  },
  {
    heading: 'Monolithic file generation',
    tags: ['architecture', 'ai-agent', 'universal'],
    body: 'When generating new features, actively resist dumping all logic into a single 500+ line file. If a file grows beyond a single distinct responsibility, you must immediately extract its sub-components or utilities into sibling files before proceeding with the feature. Fix: Split files at responsibility boundaries. Extract utilities, types, and sub-components into sibling files before the file exceeds 300 lines.',
  },
  {
    heading: 'Destructive architectural refactoring without permission',
    tags: ['workflow', 'safety', 'universal'],
    body: 'Never alter the fundamental architecture of the project (e.g., switching from App Router to Pages Router, changing the ORM paradigm, or moving directories) as a side-effect of fulfilling a smaller feature request. Architectural shifts require explicit human approval. Fix: Ask the user for explicit approval before changing core frameworks, routing paradigms, or database schemas.',
  },
];

/**
 * Pre-rendered markdown string for writing to `.totem/lessons/baseline.md`.
 * Format matches `parseLessonsFile()` expectations so lessons index correctly.
 */
export const UNIVERSAL_BASELINE_MARKDOWN = [
  UNIVERSAL_BASELINE_MARKER,
  '',
  ...UNIVERSAL_BASELINE_LESSONS.map(
    (l) => `## Lesson — ${l.heading}\n\n**Tags:** ${l.tags.join(', ')}\n\n${l.body}`,
  ),
].join('\n\n');
