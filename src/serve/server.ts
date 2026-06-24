/** Expose mcplint itself as an MCP server (dogfood). One free tool, `lint_tools`,
 *  takes a tools payload (a raw array or a tools/list envelope) and returns the
 *  score + findings by running the pure engine in `src/core`.
 *
 *  This is the mirror image of `src/connect/stdio.ts`: that module is a
 *  dependency-free JSON-RPC *client* speaking the handshake to someone else's
 *  server; this is a dependency-free JSON-RPC *server* answering that handshake.
 *  We hand-roll the wire format for the same reason — the surface we need
 *  (initialize + tools/list + a single tools/call) is small and well-specified,
 *  so pulling the whole MCP SDK in would be heavier than the thing it serves.
 *
 *  Trust model & stdio discipline: STDOUT carries JSON-RPC frames ONLY — every
 *  diagnostic goes to stderr (`logErr`). The lint tool is free: it never touches
 *  the licence, so scoring works with no key. The handler is pure data-in /
 *  data-out (`handleRequest`); the stdio runtime (`runStdioServer`) is the only
 *  I/O, kept thin so the handler is fully testable with no network or process. */
import { lint, parseTools, McpLintError } from "../core/lint.js";

/** The protocol revision we advertise. We answer the client's requested version
 *  back when it sends one (servers are expected to echo a version they support),
 *  falling back to this when it doesn't. */
const PROTOCOL_VERSION = "2025-06-18";

const SERVER_INFO = { name: "mcplint", version: "0.1.0" } as const;

/** The single tool we expose. Authored to pass mcplint's OWN rules — valid name,
 *  a real >12-char description with when-to-use guidance, and an object schema
 *  whose required param exists in properties. Dogfooding: `mcplint --cmd node --
 *  dist/serve-main.js` must score this 100/100. */
export const LINT_TOOLS_TOOL = {
  name: "lint_tools",
  description:
    "Lint and score an MCP tools payload (a tools array, or a tools/list result " +
    "envelope) for name/schema validity, description quality, token weight, and " +
    "safety annotations. Use before publishing an MCP server to check its tool " +
    "definitions, or to grade another server's tools you fetched via tools/list.",
  inputSchema: {
    type: "object",
    properties: {
      tools: {
        description:
          "The tools to lint: either a raw array of tool definitions, or a " +
          "tools/list result object of the form { tools: [...] }.",
      },
    },
    required: ["tools"],
  },
} as const;

/** Minimal JSON-RPC request shape we read off the wire. */
interface JsonRpcRequest {
  jsonrpc?: unknown;
  id?: number | string | null;
  method?: unknown;
  params?: unknown;
}

/** A response to send back, or `null` for an inbound notification (no id → no
 *  reply, per JSON-RPC). */
type Reply = Record<string, unknown> | null;

/** JSON-RPC error codes we use (subset of the standard set). */
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

/** Handle one parsed JSON-RPC message. Pure: no I/O, no process, no licence —
 *  takes a request, returns the reply (or null for a notification). This is what
 *  the tests drive directly. */
export function handleRequest(req: JsonRpcRequest): Reply {
  const { id, method } = req;
  // A notification (no id) gets no reply — e.g. notifications/initialized.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case "initialize":
      return result(id, {
        protocolVersion: negotiateVersion(req.params),
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "tools/list":
      return result(id, { tools: [LINT_TOOLS_TOOL] });

    case "tools/call":
      return handleToolsCall(id, req.params);

    default:
      // Notifications we don't act on are silently accepted (no reply); unknown
      // *requests* get a proper method-not-found error.
      if (isNotification) return null;
      return error(id, METHOD_NOT_FOUND, `Method not found: ${String(method)}`);
  }
}

function handleToolsCall(id: JsonRpcRequest["id"], params: unknown): Reply {
  const p = (params ?? {}) as { name?: unknown; arguments?: unknown };
  if (p.name !== LINT_TOOLS_TOOL.name) {
    return error(id, METHOD_NOT_FOUND, `Unknown tool: ${String(p.name)}`);
  }
  const args = (p.arguments ?? {}) as { tools?: unknown };
  if (args.tools === undefined) {
    return error(id, INVALID_PARAMS, 'Missing required argument "tools".');
  }

  try {
    const lintResult = lint(parseTools(args.tools));
    // MCP tool results are content blocks. We return the structured result both
    // as machine-readable JSON text and surface `structuredContent` so SDK
    // clients can read it without re-parsing. `isError` stays false — a low
    // score is a successful lint, not a tool failure.
    return result(id, {
      content: [{ type: "text", text: JSON.stringify(lintResult, null, 2) }],
      structuredContent: lintResult,
      isError: false,
    });
  } catch (err) {
    // A malformed payload is a tool-level error (isError: true), not a transport
    // error — the call succeeded, the input was bad. Honest, actionable message.
    const message =
      err instanceof McpLintError ? err.message : err instanceof Error ? err.message : String(err);
    return result(id, {
      content: [{ type: "text", text: `lint_tools could not parse the payload: ${message}` }],
      isError: true,
    });
  }
}

/** Echo the client's requested protocolVersion if it sent a string, else ours. */
function negotiateVersion(params: unknown): string {
  const requested = (params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
  return typeof requested === "string" ? requested : PROTOCOL_VERSION;
}

function result(id: JsonRpcRequest["id"], value: Record<string, unknown>): Reply {
  return { jsonrpc: "2.0", id, result: value };
}

function error(id: JsonRpcRequest["id"], code: number, message: string): Reply {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

/** Diagnostics go to stderr only — STDOUT is reserved for JSON-RPC frames. */
function logErr(message: string): void {
  process.stderr.write(message + "\n");
}

/** Run the server over stdio: read newline-delimited JSON-RPC frames from stdin,
 *  write replies to stdout, log to stderr. The only I/O in this module; the
 *  framing mirrors the client in `src/connect/stdio.ts`. Resolves when stdin
 *  closes. */
export function runStdioServer(): Promise<void> {
  return new Promise((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (chunk: string) => {
      buffer += chunk;
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) onLine(line);
      }
    });

    process.stdin.on("end", () => resolve());

    function onLine(line: string): void {
      let req: JsonRpcRequest;
      try {
        req = JSON.parse(line) as JsonRpcRequest;
      } catch {
        logErr(`mcplint: ignoring non-JSON line on stdin`);
        return;
      }
      let reply: Reply;
      try {
        reply = handleRequest(req);
      } catch (err) {
        // Defensive: the handler is pure and shouldn't throw, but never let one
        // bad frame kill the server — answer with a transport-level error.
        const message = err instanceof Error ? err.message : String(err);
        reply = error(req.id ?? null, INTERNAL_ERROR, message);
      }
      if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
    }

    logErr("mcplint MCP server ready on stdio");
  });
}
