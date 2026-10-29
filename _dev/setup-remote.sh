#!/bin/bash
# Разовая установка puppeteer-core на VPS для функциональных тестов (Chrome уже стоит системный)
set -e
# аргумент — рабочая папка на сервере ($base из remote.local.ps1)
mkdir -p "${1:-$HOME/flow-shots}"
cd "${1:-$HOME/flow-shots}"
node -v; npm -v
[ -f package.json ] || echo '{"name":"flow-shots","private":true}' > package.json
PUPPETEER_SKIP_DOWNLOAD=1 nice -n 19 npm i --no-audit --no-fund puppeteer-core@23.11.1 2>&1 | tail -2
node -e 'console.log("puppeteer-core", require("puppeteer-core/package.json").version)'
