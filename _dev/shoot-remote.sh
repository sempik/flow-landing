#!/bin/bash
# Снимает скриншоты страницы headless-Chrome на VPS, чтобы не грузить домашний ПК.
# usage: shoot-remote.sh <dir> <W> <H> <budget_ms> <query>...
# В <dir> должен лежать index.html; результат — <dir>/out/*.jpg и *.log
set -u
DIR=$1; W=$2; H=$3; B=$4; shift 4
cd "$DIR" || exit 1
rm -rf out; mkdir -p out
# один Chrome за раз на всю машину, ядра 1-4 (ядро 0 остаётся сервисам), минимальный приоритет
exec 9>/tmp/flow-shots.lock
flock 9
for q in "$@"; do
  name="$(printf '%s' "$q" | sed 's/[^A-Za-z0-9._-]/_/g')_${W}x${H}"
  nice -n 19 taskset -c 1-4 timeout 120 google-chrome --headless=new \
    --use-angle=swiftshader --enable-unsafe-swiftshader \
    --hide-scrollbars --no-first-run --no-default-browser-check \
    --user-data-dir=/tmp/flow-shot-profile --enable-logging=stderr --v=0 \
    --window-size="$W,$H" --virtual-time-budget="$B" \
    --screenshot="out/$name.png" "file://$PWD/index.html?$q" 2> "out/$name.raw"
  grep -E 'CONSOLE|Uncaught|Error' "out/$name.raw" | grep -v 'dbus\|Fontconfig\|gcm\|viz_main' > "out/$name.log"
  rm -f "out/$name.raw"
  if [ -f "out/$name.png" ]; then
    nice -n 19 taskset -c 1-4 ffmpeg -loglevel error -y -i "out/$name.png" -q:v 2 "out/$name.jpg" && rm -f "out/$name.png"
  fi
  echo "$q -> $name.jpg (console: $(wc -l < "out/$name.log"))"
done
