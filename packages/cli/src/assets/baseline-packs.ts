/**
 * Language-specific baseline packs — curated lessons for each ecosystem.
 * Combined with core lessons during `totem init` based on detected project type.
 *
 * @see #835 (language-specific baseline packs)
 * @see ADR-067 (ecosystem agnosticism)
 */

export type Ecosystem = 'javascript' | 'python' | 'rust' | 'go';

export interface BaselineLesson {
  heading: string;
  tags: string[];
  body: string;
}

export const ECOSYSTEMS: readonly Ecosystem[] = ['javascript', 'python', 'rust', 'go'] as const;

// ─── Python Pack ────────────────────────────────────

export const PYTHON_BASELINE: BaselineLesson[] = [
  {
    heading: 'Mutable default arguments persist across function calls',
    tags: ['python', 'gotcha'],
    body: 'Default mutable arguments (lists, dicts) in Python function signatures are created once and shared across all calls. `def append(item, lst=[])` accumulates items across invocations. Fix: Use `None` as the default and create a new object inside the function body: `if lst is None: lst = []`.',
  },
  {
    heading: 'Bare except clauses hide real errors',
    tags: ['python', 'error-handling'],
    body: 'Using `except:` or `except Exception:` without specifying the error type catches everything including KeyboardInterrupt and SystemExit. This masks bugs and makes debugging impossible. Fix: Always catch specific exception types. Use `except ValueError:` or `except (TypeError, KeyError):` instead of bare except.',
  },
  {
    heading: 'Import side effects in __init__.py cause circular imports',
    tags: ['python', 'architecture'],
    body: 'Heavy imports in `__init__.py` files create circular dependency chains that crash at import time with `ImportError: cannot import name`. Fix: Keep `__init__.py` files minimal. Use lazy imports or move imports inside functions when circular dependencies arise.',
  },
  {
    heading: 'String concatenation in loops creates O(n²) performance',
    tags: ['python', 'performance'],
    body: 'Building strings with `+=` in a loop creates a new string object on every iteration because Python strings are immutable. For large loops this is O(n²). Fix: Collect strings in a list and use `"".join(parts)` at the end.',
  },
  {
    heading: 'Type hints are not enforced at runtime',
    tags: ['python', 'typing'],
    body: 'Python type hints (`def foo(x: int) -> str`) are documentation only — they are not enforced at runtime. Passing a string where int is annotated will not raise an error. Fix: Use mypy or pyright in CI for static type checking. Do not assume type hints prevent runtime type errors.',
  },
  {
    heading: 'Global interpreter lock blocks true parallelism for CPU tasks',
    tags: ['python', 'concurrency'],
    body: 'The GIL prevents multiple threads from executing Python bytecode simultaneously. Threading works for I/O-bound tasks but provides no speedup for CPU-bound work. Fix: Use `multiprocessing` for CPU-bound parallelism or `asyncio` for I/O-bound concurrency.',
  },
  {
    heading: 'Virtual environments must be activated per project',
    tags: ['python', 'tooling'],
    body: 'Installing packages globally with `pip install` pollutes the system Python and causes version conflicts across projects. Fix: Always use `python -m venv .venv` and activate it before installing dependencies. Use `requirements.txt` or `pyproject.toml` to pin versions.',
  },
  {
    heading: 'f-strings with expressions can execute arbitrary code',
    tags: ['python', 'security'],
    body: 'f-strings evaluate expressions at runtime: `f"{os.system(cmd)}"` executes shell commands. Never construct f-strings from untrusted user input. Fix: Use `.format()` or template strings for user-controlled content. Reserve f-strings for developer-authored strings only.',
  },
];

// ─── Rust Pack ──────────────────────────────────────

export const RUST_BASELINE: BaselineLesson[] = [
  {
    heading: 'Unwrap in production code causes unrecoverable panics',
    tags: ['rust', 'error-handling'],
    body: '`.unwrap()` and `.expect()` on `Result` or `Option` cause a panic if the value is `Err` or `None`. In library code and production services, this crashes the process. Fix: Use `?` operator to propagate errors, or `match`/`if let` to handle `None`/`Err` gracefully. Reserve `.unwrap()` for tests only.',
  },
  {
    heading: 'Clone to satisfy the borrow checker is a code smell',
    tags: ['rust', 'performance'],
    body: 'Calling `.clone()` to make the borrow checker happy often masks a design problem. Cloning large structs in hot loops destroys performance. Fix: Restructure code to use references, lifetimes, or `Rc`/`Arc` for shared ownership. Only clone when the data is small and the alternative is significantly more complex.',
  },
  {
    heading: 'Deadlocks from nested Mutex locks',
    tags: ['rust', 'concurrency'],
    body: 'Locking a `Mutex` while already holding another lock can deadlock if another thread acquires them in reverse order. Rust prevents data races but does NOT prevent deadlocks. Fix: Always acquire locks in a consistent order across all threads. Consider using `parking_lot::Mutex` which has deadlock detection in debug mode.',
  },
  {
    heading: 'String vs str confusion causes unnecessary allocations',
    tags: ['rust', 'performance'],
    body: '`String` is an owned, heap-allocated string. `&str` is a borrowed reference. Functions that only read strings should accept `&str`, not `String`, to avoid forcing callers to allocate. Fix: Use `&str` for function parameters that only read string data. Use `String` only when ownership transfer is needed.',
  },
  {
    heading: 'Cargo.lock must be committed for binaries but not libraries',
    tags: ['rust', 'tooling'],
    body: 'For binary crates (applications), `Cargo.lock` ensures reproducible builds and must be committed. For library crates, it should be gitignored because downstream consumers generate their own lockfile. Fix: Commit `Cargo.lock` for `[[bin]]` targets. Add it to `.gitignore` for `[lib]` crates.',
  },
  {
    heading: 'Unsafe blocks require safety invariant documentation',
    tags: ['rust', 'safety'],
    body: 'Every `unsafe` block must document why it is safe — what invariants the programmer is guaranteeing that the compiler cannot verify. Undocumented unsafe is a ticking UB bomb. Fix: Add a `// SAFETY: ...` comment above every `unsafe` block explaining the invariant being upheld.',
  },
  {
    heading: 'Missing error context in the ? operator chain',
    tags: ['rust', 'error-handling'],
    body: 'Using `?` to propagate errors loses context about what operation failed. `file.read_to_string(&mut s)?` produces "No such file" with no indication of which file. Fix: Use `anyhow::Context` or `map_err` to add context: `file.read_to_string(&mut s).context("reading config.toml")?`.',
  },
  {
    heading: 'Derive macros on large structs slow compilation',
    tags: ['rust', 'performance'],
    body: 'Deriving `Debug`, `Clone`, `Serialize`, `Deserialize` on large structs with many fields generates significant code at compile time. In hot-rebuild inner loops this adds seconds. Fix: Only derive what you need. Consider manual implementations for large structs in performance-critical crates.',
  },
];

// ─── Go Pack ────────────────────────────────────────

export const GO_BASELINE: BaselineLesson[] = [
  {
    heading: 'Goroutine leaks from unbounded channel sends',
    tags: ['go', 'concurrency'],
    body: 'A goroutine blocked on `ch <- value` when no receiver exists leaks forever. This is the most common goroutine leak in Go. Fix: Always use buffered channels or `select` with `context.Done()` to ensure goroutines can exit. Use `goleak` in tests to detect leaks.',
  },
  {
    heading: 'Error strings should not be capitalized or end with punctuation',
    tags: ['go', 'style'],
    body: 'Go convention: error strings are lowercase and do not end with punctuation, because they are often wrapped with `fmt.Errorf("failed to connect: %w", err)`. A capitalized inner error produces "failed to connect: Connection refused." Fix: Use `errors.New("connection refused")` not `errors.New("Connection refused.")`.',
  },
  {
    heading: 'nil interface values are not equal to nil',
    tags: ['go', 'gotcha'],
    body: 'An interface holding a nil pointer is NOT nil itself. `var p *MyStruct = nil; var i interface{} = p; i == nil` is FALSE. This causes subtle bugs in error returns. Fix: Return `nil` directly, not a typed nil pointer. Use `if err != nil` checks only on the interface value.',
  },
  {
    heading: 'defer in loops delays cleanup until function returns',
    tags: ['go', 'gotcha'],
    body: '`defer` runs at function exit, not loop iteration exit. Deferring `file.Close()` inside a loop opens all files before closing any, causing file descriptor exhaustion. Fix: Extract the loop body into a separate function so defer runs per iteration, or close explicitly without defer.',
  },
  {
    heading: 'Race conditions in map access require sync.Mutex or sync.Map',
    tags: ['go', 'concurrency'],
    body: 'Go maps are not safe for concurrent access. Reading and writing a map from multiple goroutines without synchronization causes a fatal runtime panic (not just bad data). Fix: Protect map access with `sync.Mutex` or use `sync.Map` for simple key-value concurrent access.',
  },
  {
    heading: 'Context cancellation must be checked in long-running operations',
    tags: ['go', 'concurrency'],
    body: 'Long-running loops and I/O operations must check `ctx.Done()` periodically. Ignoring context cancellation makes services unresponsive to shutdown signals and timeouts. Fix: Add `select { case <-ctx.Done(): return ctx.Err() }` in loops and before expensive operations.',
  },
  {
    heading: 'Exported functions must have doc comments',
    tags: ['go', 'style'],
    body: 'Go convention enforced by `golint` and `go vet`: every exported function, type, and variable must have a doc comment starting with its name. `// Foo does X` not `// does X`. Fix: Add doc comments to all exported identifiers. The comment must start with the identifier name.',
  },
  {
    heading: 'go.sum must always be committed',
    tags: ['go', 'tooling'],
    body: '`go.sum` contains cryptographic checksums of dependencies. It must be committed to ensure reproducible builds and detect supply chain tampering. Fix: Always commit both `go.mod` and `go.sum`. Run `go mod tidy` before committing to clean up unused entries.',
  },
];
