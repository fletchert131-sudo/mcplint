/** Connect to a live MCP server over stdio, do the JSON-RPC handshake, and
 *  fetch its `tools/list`. This is the only door to a *running* server (the
 *  file path stays for static linting). It is deliberately dependency-free —
 *  the initialize → tools/list handshake is small and well-specified, so we
 *  speak it directly rather than pulling the whole MCP SDK in just to be a
 *  client.
 *
 *  Trust model: the server is the user's own process, but its STDOUT is still
 *  untrusted bytes. So every boundary is hard-bounded — spawn with no shell
 *  (no injection), an overall timeout (no hangs), and capped stdout/stderr
 *  buffers (no OOM from a server that spews). The child is killed on every
 *  exit path. This mirrors a11ygent's crawler discipline: timeouts, bounded
 *  resources, graceful failure, clean teardown.
 *
 *  Stays out of `src/core/` on purpose: core is pure (no I/O). This module
 *  does the I/O, then hands plain data to the pure engine. */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { delimiter, extname, join } from "node:path";
import { existsSync } from "node:fs";

/** The MCP protocol revision we advertise in `initialize`. Servers negotiate
 *  down to a version they support; we only need `tools/list`, stable since the
 *  first spec, so this is a courtesy, not a hard requirement. */
const PROTOCOL_VERSION = "2025-06-18";

/** Cap on bytes we will buffer from the child's stdout/stderr. A well-behaved
 *  server's initialize + tools/list response is a few KB; 16 MB is generous
 *  headroom for a large tool catalogue while still bounding a server that
 *  streams without end. Hitting the cap is a hard error, not a silent trim —
 *  a truncated JSON-RPC frame would parse wrong or not at all. */
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;

/** Raised for any failure connecting to or talking with a live MCP server.
 *  The CLI maps this to a clean exit code with an actionable message — the
 *  user never sees a raw spawn error or a stack trace. */
export class McpConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConnectError";
  }
}

export interface ConnectOptions {
  /** The server command to run (e.g. "node"). Spawned with `shell: false`. */
  command: string;
  /** Arguments passed to the command (e.g. ["my-server.js"]). */
  args?: string[];
  /** Overall budget for the whole handshake, in ms. Default 30s. */
  timeoutMs?: number;
  /** Working directory for the child. Defaults to the current process cwd. */
  cwd?: string;
  /**
   * Extra environment for the child, merged over the parent env. Defaults to
   * passing the parent env through unchanged — MCP servers routinely need
   * PATH and their own config from the environment to start at all.
   */
  env?: NodeJS.ProcessEnv;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** Spawn the server, run initialize → initialized → tools/list, and return the
 *  raw `tools` array exactly as the server reports it. The caller pipes this
 *  straight into the pure engine's `parseTools` (which re-validates every
 *  field), so we do no trust-the-server normalisation here. */
export async function fetchToolsOverStdio(options: ConnectOptions): Promise<unknown[]> {
  const { command, args = [], timeoutMs = 30_000, cwd, env } = options;
  if (typeof command !== "string" || command.trim() === "") {
    throw new McpConnectError("A server command is required (e.g. --cmd node --args server.js).");
  }

  const child = spawnServer(command, args, cwd, env);
  // From here on, every exit path must go through `cleanup` so we never leak
  // the child or a dangling timer.
  const session = new StdioSession(child, command, timeoutMs);
  try {
    return await session.run();
  } finally {
    session.cleanup();
  }
}

function spawnServer(
  command: string,
  args: string[],
  cwd: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
): ChildProcessWithoutNullStreams {
  const resolved = resolveLaunch(command, args, env ?? process.env);
  try {
    // shell:false is the security boundary — the command and args are passed as
    // an argv array directly to the OS, so a value like "a; rm -rf ~" is a
    // (failing) program name, never a shell metacharacter. We NEVER set
    // shell:true (that would re-parse untrusted args — the cmd.exe injection
    // class, CVE-2024-27980). Windows .cmd/.bat shims that Node can't exec
    // directly are launched via an explicit `cmd.exe /d /s /c` with args still
    // kept as a separate argv array (see resolveLaunch) — no string-built
    // command line, so no interpolation of untrusted args.
    return spawn(resolved.command, resolved.args, {
      cwd,
      env: env ?? process.env,
      shell: false,
      windowsVerbatimArguments: resolved.verbatim,
      stdio: ["pipe", "pipe", "pipe"],
    }) as ChildProcessWithoutNullStreams;
  } catch (err) {
    throw new McpConnectError(`Could not start server "${command}": ${asMessage(err)}`);
  }
}

interface Launch {
  command: string;
  args: string[];
  /** Pass args to Windows untouched (we've already quoted them ourselves). */
  verbatim: boolean;
}

/** Decide how to actually launch the requested command. On non-Windows this is
 *  a pass-through (`shell:false` with the raw argv). On Windows, npm-ecosystem
 *  servers are usually `.cmd` shims (npx.cmd, a package's bin), which Node
 *  refuses to exec directly without a shell (EINVAL). We resolve those shims on
 *  PATH and run them through `cmd.exe /d /s /c`, keeping each user arg as its
 *  own argv entry and quoting it ourselves — so untrusted args are data, never
 *  parsed as a second command. */
function resolveLaunch(command: string, args: string[], env: NodeJS.ProcessEnv): Launch {
  if (process.platform !== "win32") {
    return { command, args, verbatim: false };
  }

  const shimPath = resolveWindowsShim(command, env);
  if (!shimPath) {
    // Either a real .exe (Node execs it fine) or a path Node will resolve
    // itself — leave it to the OS, still shell:false.
    return { command, args, verbatim: false };
  }

  // cmd.exe /d (skip autorun) /s + the surrounding quotes form let us pass a
  // fully-quoted command line that cmd.exe treats literally. Each token is
  // quoted with quoteForCmd so spaces and cmd metacharacters in args can't
  // break out. windowsVerbatimArguments stops Node re-quoting on top of ours.
  const line = [shimPath, ...args].map(quoteForCmd).join(" ");
  return {
    command: process.env.COMSPEC ?? "cmd.exe",
    args: ["/d", "/s", "/c", `"${line}"`],
    verbatim: true,
  };
}

/** Find a `.cmd`/`.bat` shim for `command` on PATH (Windows only). Returns the
 *  absolute path if the resolved target is a batch shim, else null (so real
 *  executables and explicit paths fall through to a normal spawn). */
function resolveWindowsShim(command: string, env: NodeJS.ProcessEnv): string | null {
  const batchExts = [".cmd", ".bat"];
  // An explicit .cmd/.bat path: use it directly.
  if (batchExts.includes(extname(command).toLowerCase()) && existsSync(command)) {
    return command;
  }
  // A bare name (no extension, no separator): probe PATHEXT-style for a shim.
  if (extname(command) === "" && !command.includes("\\") && !command.includes("/")) {
    const dirs = (env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
    for (const dir of dirs) {
      for (const ext of batchExts) {
        const candidate = join(dir, command + ext);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

/** Quote a single token for a cmd.exe command line: wrap in double quotes and
 *  escape embedded quotes and cmd metacharacters. Used only for the Windows
 *  batch-shim path; args remain separate data, never a second command. */
function quoteForCmd(token: string): string {
  // Escape cmd metacharacters with ^ outside quotes is fragile; instead we
  // wrap the whole token in quotes and double any embedded quotes, which cmd
  // treats literally. A trailing backslash before the closing quote is doubled
  // so it doesn't escape the quote.
  const escaped = token.replace(/"/g, '""').replace(/(\\+)$/, "$1$1");
  return `"${escaped}"`;
}

/** One handshake session against a spawned child. Owns the child, the line
 *  buffer, the pending-request map, and the overall timeout — and tears all of
 *  them down exactly once in `cleanup`. */
class StdioSession {
  private nextId = 1;
  /** In-flight requests keyed by id. Each entry can resolve with a response or
   *  reject with the session's fatal error — so a child crash or timeout fails
   *  every waiter promptly instead of hanging. */
  private readonly pending = new Map<
    number,
    { resolve: (res: JsonRpcResponse) => void; reject: (err: Error) => void }
  >();
  private stdoutBytes = 0;
  private stderrTail = "";
  private lineBuffer = "";
  private settled = false;
  private timer: NodeJS.Timeout | undefined;
  private exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  /** Set when the child errors/exits early; makes in-flight calls reject with a
   *  useful reason instead of hanging until the overall timeout. */
  private fatal: McpConnectError | undefined;

  constructor(
    private readonly child: ChildProcessWithoutNullStreams,
    private readonly command: string,
    private readonly timeoutMs: number,
  ) {
    this.attachListeners();
  }

  private attachListeners(): void {
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk: string) => {
      // Keep only a bounded tail of stderr so a noisy server can't grow memory;
      // it's surfaced in error messages to help the user debug a crash.
      this.stderrTail = (this.stderrTail + chunk).slice(-2_000);
    });

    this.child.on("error", (err) => {
      // Fires when the binary doesn't exist or isn't executable.
      this.failFatal(new McpConnectError(`Could not start server "${this.command}": ${asMessage(err)}`));
    });

    this.child.on("exit", (code, signal) => {
      this.exitInfo = { code, signal };
      // A clean early exit during the handshake is still a failure for us —
      // the server died before answering. Pending awaits get a clear reason.
      if (!this.settled) {
        this.failFatal(new McpConnectError(this.describeExit()));
      }
    });
  }

  /** Run the full handshake. Resolves with the raw tools array. */
  async run(): Promise<unknown[]> {
    this.timer = setTimeout(() => {
      this.failFatal(
        new McpConnectError(
          `Server "${this.command}" did not complete the handshake within ${this.timeoutMs}ms.` +
            this.stderrHint(),
        ),
      );
    }, this.timeoutMs);
    // Don't keep the event loop alive just for this timer.
    this.timer.unref?.();

    await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mcplint", version: "0.1.0" },
    });

    // Per spec, the client confirms initialization with a notification (no id,
    // no response). Some servers will not answer tools/list until they see it.
    this.notify("notifications/initialized");

    const listResult = await this.request("tools/list", {});
    return extractTools(listResult);
  }

  /** Send a JSON-RPC request and await its matching response (by id). Rejects
   *  if the server reports an error, exits early, or the overall timeout fires. */
  private async request(method: string, params: unknown): Promise<unknown> {
    if (this.fatal) throw this.fatal;
    const id = this.nextId++;
    const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writeFrame({ jsonrpc: "2.0", id, method, params }, reject);
    });

    if (response.error) {
      throw new McpConnectError(
        `Server returned an error for ${method}: ${response.error.message} (code ${response.error.code}).`,
      );
    }
    return response.result;
  }

  /** Fire-and-forget notification (no id, no awaited response). */
  private notify(method: string): void {
    this.writeFrame({ jsonrpc: "2.0", method });
  }

  private writeFrame(message: object, onError?: (err: Error) => void): void {
    if (this.fatal) {
      onError?.(this.fatal);
      return;
    }
    const line = JSON.stringify(message) + "\n";
    this.child.stdin.write(line, (err) => {
      if (err) {
        const wrapped = new McpConnectError(`Failed writing to server stdin: ${asMessage(err)}`);
        this.failFatal(wrapped);
        onError?.(wrapped);
      }
    });
  }

  private onStdout(chunk: string): void {
    this.stdoutBytes += Buffer.byteLength(chunk, "utf8");
    if (this.stdoutBytes > MAX_BUFFER_BYTES) {
      this.failFatal(
        new McpConnectError(
          `Server "${this.command}" sent more than ${MAX_BUFFER_BYTES} bytes without a complete response — aborting.`,
        ),
      );
      return;
    }
    this.lineBuffer += chunk;
    let nl: number;
    while ((nl = this.lineBuffer.indexOf("\n")) !== -1) {
      const line = this.lineBuffer.slice(0, nl).trim();
      this.lineBuffer = this.lineBuffer.slice(nl + 1);
      if (line) this.onLine(line);
    }
  }

  private onLine(line: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(line) as JsonRpcResponse;
    } catch {
      // Not JSON: a server that wrongly logged to stdout. The spec says stdout
      // is JSON-RPC only, but we tolerate stray lines rather than crash — we
      // only act on frames whose id matches a request we sent.
      return;
    }
    if (msg === null || typeof msg !== "object" || !("id" in msg)) return; // a notification/request from the server — ignore
    const id = msg.id;
    if (typeof id !== "number") return;
    const waiter = this.pending.get(id);
    if (waiter) {
      this.pending.delete(id);
      waiter.resolve(msg);
    }
  }

  private failFatal(err: McpConnectError): void {
    if (this.fatal) return; // first failure wins
    this.fatal = err;
    this.settled = true;
    // Reject every in-flight request so none hangs until the overall timeout.
    const waiters = [...this.pending.values()];
    this.pending.clear();
    for (const w of waiters) w.reject(err);
  }

  private describeExit(): string {
    const { code, signal } = this.exitInfo ?? { code: null, signal: null };
    const how =
      signal !== null
        ? `was killed by signal ${signal}`
        : `exited with code ${code ?? "unknown"}`;
    return `Server "${this.command}" ${how} before completing the handshake.` + this.stderrHint();
  }

  private stderrHint(): string {
    const tail = this.stderrTail.trim();
    return tail ? `\nServer stderr (tail):\n${tail}` : "";
  }

  /** Idempotent teardown: clear the timer and ensure the child is dead. Safe to
   *  call from `finally` even if `run()` resolved cleanly. */
  cleanup(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.settled = true;
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.stdin.end(() => {});
      this.child.kill("SIGTERM");
      // Hard-stop if it ignores SIGTERM; unref so this timer never holds the
      // process open on its own.
      const force = setTimeout(() => {
        if (this.child.exitCode === null && this.child.signalCode === null) {
          this.child.kill("SIGKILL");
        }
      }, 2_000);
      force.unref?.();
    }
  }
}

/** Pull the `tools` array out of a `tools/list` result, validating only the
 *  envelope shape here — the engine's `parseTools` validates each tool. We
 *  reject anything that isn't `{ tools: [...] }` with a clear message rather
 *  than passing garbage downstream. */
function extractTools(result: unknown): unknown[] {
  if (
    result !== null &&
    typeof result === "object" &&
    Array.isArray((result as { tools?: unknown }).tools)
  ) {
    return (result as { tools: unknown[] }).tools;
  }
  throw new McpConnectError(
    "Server's tools/list response had no 'tools' array — it may not expose tools, or it isn't a spec-compliant MCP server.",
  );
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
