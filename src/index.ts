/** mcplint public library API. The MIT-licensed engine — import and embed. */
export { lint, parseTools, McpLintError } from "./core/lint.js";
export { scoreFindings, estimateTokens, WEIGHT } from "./core/score.js";
export { rules } from "./core/rules.js";
export type { McpTool, Finding, LintResult, Severity, Rule, JsonSchema } from "./core/types.js";

/** Live-server linting: spawn an MCP server and fetch its tools over stdio,
 *  then feed the result through `parseTools` + `lint` like any file. */
export { fetchToolsOverStdio, McpConnectError } from "./connect/stdio.js";
export type { ConnectOptions } from "./connect/stdio.js";

/** Watch mode (Pro): the bounded, debounced, non-overlapping re-run loop and the
 *  fs/interval driver that feeds it. Embed to re-lint on change in your own tool. */
export { WatchLoop } from "./watch/loop.js";
export type { WatchLoopOptions } from "./watch/loop.js";
export { startWatch } from "./watch/source.js";
export type { WatchTarget, WatchHandle, StartWatchOptions } from "./watch/source.js";

/** MCP server (dogfood): expose mcplint's lint over stdio. `handleRequest` is the
 *  pure JSON-RPC handler; `runStdioServer` is the stdio runtime; `LINT_TOOLS_TOOL`
 *  is the exposed tool definition (which itself passes mcplint's rules). */
export { handleRequest, runStdioServer, LINT_TOOLS_TOOL } from "./serve/server.js";
