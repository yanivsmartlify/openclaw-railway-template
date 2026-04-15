#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

# Make app-level Node dependencies discoverable from /data/workspace.
# Node module resolution from /data/workspace climbs to /data/node_modules.
if [ ! -e /data/node_modules ]; then
  ln -s /app/node_modules /data/node_modules
fi

if [ ! -d /data/.linuxbrew ]; then
  cp -a /home/linuxbrew/.linuxbrew /data/.linuxbrew
fi

rm -rf /home/linuxbrew/.linuxbrew
ln -sfn /data/.linuxbrew /home/linuxbrew/.linuxbrew

if [ -n "${ZAPIER_MCP_URL_W_TOKEN:-}" ]; then
  echo "Configuring Zapier MCP server for OpenClaw..."
  gosu openclaw openclaw mcp set zapier "{\"url\":\"${ZAPIER_MCP_URL_W_TOKEN}\"}" || true
fi

exec gosu openclaw node src/server.js
