// Minimal zero-dependency MCP stdio client for the serena pilot.
//
// Speaks the MCP framing used over stdio: newline-delimited JSON-RPC 2.0.
// (Serena's fastmcp stdio transport uses line-delimited JSON, not the
// Content-Length header framing of LSP.)
//
// Responsibilities:
//   - spawn the pinned serena MCP server as a child process
//   - initialize -> notifications/initialized -> tools/list -> tools/call
//   - measure, per call, wall time (ms) and response payload size (bytes)
//
// Byte accounting: `bytes` is the UTF-8 length of the CONTENT the server
// returned for the call -- i.e. the text an agent would actually be charged
// for in context -- not the JSON-RPC envelope. The raw envelope length is
// recorded separately as `envelopeBytes` so the report can show both.

import { spawn } from 'node:child_process';

export class McpStdioClient {
  #child = null;
  #buf = '';
  #nextId = 1;
  #pending = new Map();
  #stderr = [];
  #closed = false;
  #exitInfo = null;

  constructor({ command, args, cwd, env }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
  }

  get stderr() {
    return this.#stderr.join('');
  }

  get exitInfo() {
    return this.#exitInfo;
  }

  start() {
    this.#child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.#child.stdout.setEncoding('utf8');
    this.#child.stdout.on('data', (chunk) => this.#onStdout(chunk));

    this.#child.stderr.setEncoding('utf8');
    this.#child.stderr.on('data', (chunk) => {
      this.#stderr.push(chunk);
      // Keep the buffer bounded; language-server bring-up is chatty.
      if (this.#stderr.length > 4000) this.#stderr.splice(0, 2000);
    });

    this.#child.on('exit', (code, signal) => {
      this.#closed = true;
      this.#exitInfo = { code, signal };
      for (const [, p] of this.#pending) {
        p.reject(new Error(`server exited (code=${code} signal=${signal}) with request in flight`));
      }
      this.#pending.clear();
    });

    this.#child.on('error', (err) => {
      this.#closed = true;
      for (const [, p] of this.#pending) p.reject(err);
      this.#pending.clear();
    });
  }

  #onStdout(chunk) {
    this.#buf += chunk;
    let idx;
    while ((idx = this.#buf.indexOf('\n')) >= 0) {
      const line = this.#buf.slice(0, idx).trim();
      this.#buf = this.#buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        // Non-JSON noise on stdout would corrupt the stream; record and skip.
        this.#stderr.push(`\n[client] non-JSON stdout line: ${line.slice(0, 400)}\n`);
        continue;
      }
      if (msg.id !== undefined && this.#pending.has(msg.id)) {
        const p = this.#pending.get(msg.id);
        this.#pending.delete(msg.id);
        p.resolve({ msg, rawLine: line });
      }
      // Server-initiated requests/notifications are ignored: this client is a
      // measurement harness, not an agent loop.
    }
  }

  #send(obj) {
    if (this.#closed) throw new Error('server process is not running');
    this.#child.stdin.write(JSON.stringify(obj) + '\n');
  }

  notify(method, params) {
    this.#send({ jsonrpc: '2.0', method, params });
  }

  /**
   * Issue a JSON-RPC request and time it.
   * @returns {Promise<{result?, error?, ms:number, envelopeBytes:number}>}
   */
  async request(method, params, { timeoutMs = 180000 } = {}) {
    const id = this.#nextId++;
    const started = process.hrtime.bigint();

    let settle;
    const waiter = new Promise((resolve, reject) => {
      settle = { resolve, reject };
    });
    this.#pending.set(id, settle);

    const timer = setTimeout(() => {
      if (this.#pending.has(id)) {
        this.#pending.delete(id);
        const e = new Error(`timeout after ${timeoutMs}ms waiting for ${method}`);
        e.isTimeout = true;
        settle.reject(e);
      }
    }, timeoutMs);

    // #send() throws when the child is already gone. It must run INSIDE the
    // try, or that throw would leave this request's pending entry and timer
    // behind (the finally below is the only thing that clears them).
    try {
      this.#send({ jsonrpc: '2.0', id, method, params });
      const { msg, rawLine } = await waiter;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      return {
        result: msg.result,
        error: msg.error,
        ms,
        envelopeBytes: Buffer.byteLength(rawLine, 'utf8'),
      };
    } finally {
      clearTimeout(timer);
      this.#pending.delete(id);
    }
  }

  async initialize({ clientName = 'totem-serena-pilot', clientVersion = '0.0.0' } = {}) {
    const res = await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: clientName, version: clientVersion },
    });
    if (res.error) throw new Error(`initialize failed: ${JSON.stringify(res.error)}`);
    this.notify('notifications/initialized', {});
    return res;
  }

  async listTools() {
    const res = await this.request('tools/list', {});
    if (res.error) throw new Error(`tools/list failed: ${JSON.stringify(res.error)}`);
    return res;
  }

  /**
   * Call a tool, returning both the measurement and the flattened text content.
   */
  async callTool(name, args, opts = {}) {
    const res = await this.request('tools/call', { name, arguments: args }, opts);
    const text = extractText(res.result);
    return {
      name,
      args,
      ms: res.ms,
      envelopeBytes: res.envelopeBytes,
      bytes: Buffer.byteLength(text, 'utf8'),
      text,
      isError: Boolean(res.error) || Boolean(res.result?.isError),
      error: res.error ?? null,
    };
  }

  async stop() {
    if (!this.#child || this.#closed) return;
    try {
      this.#child.stdin.end();
    } catch {
      /* already gone */
    }
    const exited = new Promise((resolve) => this.#child.once('exit', resolve));
    const t = setTimeout(() => {
      try {
        this.#child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }, 8000);
    await exited;
    clearTimeout(t);
  }
}

/** Flatten an MCP tool result into the text an agent would see. */
export function extractText(result) {
  if (!result) return '';
  const parts = [];
  if (Array.isArray(result.content)) {
    for (const c of result.content) {
      if (typeof c?.text === 'string') parts.push(c.text);
      else parts.push(JSON.stringify(c));
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent));
  }
  if (parts.length === 0) parts.push(JSON.stringify(result));
  return parts.join('\n');
}
