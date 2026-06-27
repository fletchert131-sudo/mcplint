# mcplint as an MCP server, for Glama's introspection check.
# mcplint-mcp is a dependency-free stdio JSON-RPC server exposing the free
# `lint_tools` tool. Glama starts this container, runs initialize + tools/list,
# and scores the listing — no Dockerfile build args or secrets needed.
FROM node:20-alpine
RUN npm install -g @tomfletcher2929/mcplint
ENTRYPOINT ["mcplint-mcp"]
