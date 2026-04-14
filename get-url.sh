#!/bin/bash
# Prints the current Cloudflare Quick Tunnel URL.
# Usage: ./get-url.sh
URL=$(docker compose logs tunnel 2>/dev/null | grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' | tail -1)
if [ -z "$URL" ]; then
  echo "No tunnel URL found. Check: docker compose logs tunnel"
  exit 1
fi
echo "$URL"
