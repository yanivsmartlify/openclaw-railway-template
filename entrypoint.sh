#!/bin/bash
set -e

chown -R openclaw:openclaw /data
chmod 700 /data

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
