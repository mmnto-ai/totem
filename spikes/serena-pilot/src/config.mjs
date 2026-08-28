// Shared configuration for the serena pilot harness.
//
// Everything machine-specific is resolved here so the measurement scripts stay
// declarative and the pin is stated in exactly one place.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository worktree under measurement (the serena "project root"). */
export const WORKTREE = path.resolve(__dirname, '..', '..', '..');

/** Pilot directories. */
export const PILOT_DIR = path.resolve(__dirname, '..');
export const CONFIG_DIR = path.join(PILOT_DIR, 'config');
export const ARTIFACTS_DIR = path.join(PILOT_DIR, 'artifacts');

/** The ruled pin. */
export const SERENA_TAG = 'v1.7.0';
export const SERENA_GIT = `git+https://github.com/oraios/serena@${SERENA_TAG}`;
/** Commit the tag resolved to, as reported by uv during the build. */
export const SERENA_COMMIT = '949a27ef1e5fda1a6e7b561e777bcece345c6ffd';

/**
 * uv is installed per-user and is not on every shell's PATH. By default `uvx` is
 * resolved from PATH; set TOTEM_UV_SCRIPTS_DIR to the directory that holds it
 * (on Windows, the per-user Python `Scripts` directory) when it is not there, or
 * TOTEM_UVX to name the executable outright. No interpreter version is assumed.
 */
export const UV_SCRIPTS_DIR = process.env.TOTEM_UV_SCRIPTS_DIR ?? '';
export const UVX =
  process.env.TOTEM_UVX ?? (UV_SCRIPTS_DIR ? path.join(UV_SCRIPTS_DIR, 'uvx.exe') : 'uvx');

/** ripgrep, for the baseline arm. */
export const RG = process.env.TOTEM_RG ?? 'rg';

/**
 * SERENA_HOME is redirected away from `~/.serena` so that the pilot writes no
 * global config, no memories and no managed language-server installs into the
 * user's home. The default is a pilot-local scratch directory, which keeps the
 * harness reproducible on any machine; set TOTEM_SERENA_HOME to move it fully
 * outside the checkout (which is how the recorded measurement run was taken).
 */
export const SERENA_HOME =
  process.env.TOTEM_SERENA_HOME ?? path.join(PILOT_DIR, '.scratch', 'serena-home');

/** Tool-name groups used to VERIFY the retrieval-only bound at runtime. */
export const EDITING_TOOLS = [
  'create_text_file',
  'replace_symbol_body',
  'insert_after_symbol',
  'insert_before_symbol',
  'delete_lines',
  'replace_lines',
  'insert_at_line',
  'replace_content',
  'replace_in_files',
  'rename_symbol',
  'safe_delete_symbol',
];
export const SHELL_TOOLS = ['execute_shell_command'];
export const MEMORY_TOOLS = [
  'write_memory',
  'read_memory',
  'delete_memory',
  'edit_memory',
  'rename_memory',
  'list_memories',
  'onboarding',
];

/** Spawn spec for the pinned serena MCP stdio server. */
export function serverSpec() {
  return {
    command: UVX,
    args: [
      '--from',
      SERENA_GIT,
      'serena',
      'start-mcp-server',
      '--transport',
      'stdio',
      '--project',
      WORKTREE,
      '--context',
      'totem-pilot',
      '--mode',
      'planning',
      '--mode',
      'no-memories',
      '--mode',
      'no-onboarding',
      '--enable-web-dashboard',
      'False',
      '--enable-gui-log-window',
      'False',
      '--open-web-dashboard',
      'False',
      '--log-level',
      'INFO',
    ],
    cwd: WORKTREE,
    env: {
      ...process.env,
      SERENA_HOME,
      PATH: UV_SCRIPTS_DIR
        ? `${UV_SCRIPTS_DIR}${path.delimiter}${process.env.PATH ?? ''}`
        : (process.env.PATH ?? ''),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
    },
  };
}
