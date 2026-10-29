# Функциональный автотест (реальный скролл, клики, ресайз, мобилка, шрифты, консоль).
# Гоняется НА VPS, домашний ПК не грузится. Тестирует уже собранный dist\index.html — сначала .\build.ps1
# Результат: _test\report.txt (FAIL/WARN/NOTE), _test\report.json, _test\*.jpg
param([string]$Page = "dist\index.html", [string]$OutDir = "_test")
$root = $PSScriptRoot
. (Join-Path $root "remote.local.ps1")   # $vps, $key, $base
$remote = "$base/test_" + ($OutDir -replace '[^\w]', '_')
$outPath = Join-Path $root $OutDir
if (Test-Path $outPath) { Remove-Item $outPath -Recurse -Force }
New-Item -ItemType Directory -Force $outPath | Out-Null

& ssh -i $key -o BatchMode=yes $vps "mkdir -p $remote"
& scp -q -i $key -o BatchMode=yes (Resolve-Path (Join-Path $root $Page)).Path "${vps}:$remote/index.html"
& scp -q -i $key -o BatchMode=yes (Join-Path $root "_dev\test-remote.js") "${vps}:$base/test-remote.js"
# один браузер на всю машину (общий замок со скриншотами), ядра 1-4, минимальный приоритет
& ssh -i $key -o BatchMode=yes $vps "cd $base && flock /tmp/flow-shots.lock nice -n 19 taskset -c 1-4 timeout 900 node test-remote.js $remote"
& scp -q -i $key -o BatchMode=yes "${vps}:$remote/out/*" $outPath
Write-Host "отчёт: $outPath\report.txt"
