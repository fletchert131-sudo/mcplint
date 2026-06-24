#!/usr/bin/env node
/** Entry point for `mcplint-mcp`: run mcplint as an MCP server over stdio so
 *  agents can lint tools payloads through the engine (roadmap item 5, dogfood).
 *  All logic lives in src/serve/server.ts; this is just the runtime shell. */
import { runStdioServer } from "./serve/server.js";

runStdioServer().catch((err) => {
  process.stderr.write(`mcplint MCP server fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
