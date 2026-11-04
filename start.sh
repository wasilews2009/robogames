#!/bin/sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Встановіть Node.js 18+ з https://nodejs.org"; exit 1; }
( sleep 1; (xdg-open http://localhost:3000 || open http://localhost:3000) >/dev/null 2>&1 ) &
node server.js
