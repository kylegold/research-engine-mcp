#!/bin/bash

echo "=== MCP Server Diagnostic ==="
echo

echo "1. Checking Railway deployment health..."
curl -s https://research-engine-server-production.up.railway.app/health | jq .
echo

echo "2. Checking MCP discovery endpoint..."
curl -s https://research-engine-server-production.up.railway.app/.well-known/mcp.json | jq .
echo

echo "3. Testing JSON-RPC endpoint (should fail with auth error)..."
curl -X POST https://research-engine-server-production.up.railway.app/ \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer invalid-token" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {}, "id": 1}' \
  -s | jq .
echo

echo "4. Checking commands.com proxy (this is what's failing)..."
curl -v https://api.commands.com/mcp/kyle/research-engine \
  -H "Authorization: Bearer test" \
  2>&1 | grep -E "(HTTP/|error|status)"
echo

echo "5. Testing tool list endpoint..."
curl -X GET https://research-engine-server-production.up.railway.app/mcp/tools \
  -H "Authorization: Bearer test" \
  -s | jq .
echo

echo "=== Diagnostic complete ==="