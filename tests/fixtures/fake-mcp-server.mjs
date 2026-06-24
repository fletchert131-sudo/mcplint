#!/usr/bin/env node
/** A minimal, dependency-free fake MCP server for testing the stdio connector.
 *  Speaks just enough JSON-RPC over stdio to exercise the handshake. Its
 *  behaviour is selected by the MODE env var so one fixture covers every path:
 *
 *    good      (default) initialize + tools/list with two valid tools
 *    bad-tools tools/list whose tools fail the linter (missing description etc.)
 *    no-tools  a tools/list result that omits the `tools` array entirely
 *    rpc-error tools/list returns a JSON-RPC error object
 *    noise     prints a non-JSON log line to stdout before answering (servers
 *              that wrongly log to stdout must not crash the client)
 *    crash     exits non-zero right after initialize, before tools/list
 *    hang      answers initialize, then never answers tools/list (timeout path)
 *
 *  Real MCP servers use the SDK; this hand-rolls the wire format on purpose so
 *  the test has no dependency on the server side. */
// Mode selects behaviour. A CLI argument takes precedence (used by the
// multi-source view, whose Source carries command + args, not env:
// `node fake-mcp-server.mjs bad-tools`); otherwise the MODE env var (used by
// the connector tests). The arg is checked first on purpose — vitest sets
// MODE=test in its workers, so relying on the env alone would silently force
// the default branch under test.
const MODE = process.argv[2] ?? process.env.MODE ?? "good";

const GOOD_TOOLS = [
  {
    name: "search_invoices",
    description: "Search invoices by customer or status. Use when the user asks to find or filter invoices.",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
  {
    name: "list_customers",
    description: "List all customers, optionally filtered by name. Use to look up a customer before acting on them.",
    inputSchema: { type: "object", properties: { name: { type: "string" } } },
  },
];

const BAD_TOOLS = [
  { name: "do thing", description: "TODO" }, // invalid name + placeholder desc + no schema
  { name: "delete_everything", description: "Deletes everything." }, // destructive, no risk note
];

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function handle(msg) {
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake", version: "0.0.0" },
      },
    });
    if (MODE === "crash") {
      process.exit(3);
    }
    return;
  }

  if (msg.method === "tools/list") {
    if (MODE === "hang") return; // never answer — exercises the client timeout
    if (MODE === "rpc-error") {
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "tools not supported" } });
      return;
    }
    if (MODE === "no-tools") {
      send({ jsonrpc: "2.0", id: msg.id, result: { somethingElse: true } });
      return;
    }
    if (MODE === "noise") {
      process.stdout.write("starting up, listening on stdio...\n"); // stray non-JSON line
    }
    const tools = MODE === "bad-tools" ? BAD_TOOLS : GOOD_TOOLS;
    send({ jsonrpc: "2.0", id: msg.id, result: { tools } });
    return;
  }

  // notifications (no id) and anything else are ignored.
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg);
  }
});
