#!/bin/bash

echo "=== Testing Commands.com Integration ==="
echo

# Test 1: Direct server health
echo "1. Direct server health check:"
curl -s https://research-engine-server-production.up.railway.app/health | jq .
echo

# Test 2: MCP discovery
echo "2. MCP discovery endpoint:"
curl -s https://research-engine-server-production.up.railway.app/.well-known/mcp.json | jq .
echo

# Test 3: Commands.com proxy without auth
echo "3. Commands.com proxy (no auth):"
curl -s -w "\nHTTP Status: %{http_code}\n" https://api.commands.com/mcp/kyle/research-engine
echo

# Test 4: Commands.com proxy with Bearer token
echo "4. Commands.com proxy (with Bearer):"
curl -s -w "\nHTTP Status: %{http_code}\n" \
  -H "Authorization: Bearer test-token" \
  https://api.commands.com/mcp/kyle/research-engine
echo

# Test 5: Check if there's a registration endpoint
echo "5. Check commands.com registration status:"
curl -s https://api.commands.com/mcp/kyle/research-engine/status \
  -w "\nHTTP Status: %{http_code}\n"
echo

# Test 6: Initialize via commands.com
echo "6. Initialize via commands.com proxy:"
curl -X POST https://api.commands.com/mcp/kyle/research-engine \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -d '{"jsonrpc": "2.0", "method": "initialize", "params": {}, "id": 1}' \
  -s -w "\nHTTP Status: %{http_code}\n"
echo

echo "=== Test complete ==="