# Скриншоты страницы в нужных точках скролла + лог консоли.
# Рендер идёт НА VPS (headless Chrome, ядра 1-4, nice 19, по одному), домашний ПК не грузится.
# Пример: .\shoot.ps1 -Query "ch=1","ch=8" -W 1600 -H 900
# Каждый query даёт <OutDir>\<имя>.jpg и <имя>.log (консоль страницы, ошибки JS)
# Вызов снаружи (powershell -File shoot.ps1 -Query "ch=1","ch=8") передаёт массив одной строкой "ch=1,ch=8" —
# поэтому -Query дополнительно режется по запятым: можно писать и -Query "ch=1,ch=8"
param(
  [string]$Page = "dist\index.html",
  [string[]]$Query = @("ch=1"),
  [int]$W = 1600,
  [int]$H = 900,
  [string]$OutDir = "_shots",
  [int]$Budget = 7000,
  [string]$Suffix = ""
)
$Query = @($Query | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$root = $PSScriptRoot
. (Join-Path $root "remote.local.ps1")   # $vps, $key, $base
$pagePath = (Resolve-Path (Join-Path $root $Page)).Path
$outPath = Join-Path $root $OutDir
New-Item -ItemType Directory -Force $outPath | Out-Null
$remote = "$base/" + ($OutDir -replace '[^\w]', '_')

& ssh -i $key -o BatchMode=yes $vps "mkdir -p $remote"
& scp -q -i $key -o BatchMode=yes $pagePath "${vps}:$remote/index.html"
& scp -q -i $key -o BatchMode=yes (Join-Path $root "_dev\shoot-remote.sh") "${vps}:$base/shoot-remote.sh"
$qs = ($Query | ForEach-Object { "'" + $_ + "'" }) -join ' '
& ssh -i $key -o BatchMode=yes $vps "bash $base/shoot-remote.sh $remote $W $H $Budget $qs"

$tmp = Join-Path $outPath "_incoming"
New-Item -ItemType Directory -Force $tmp | Out-Null
& scp -q -i $key -o BatchMode=yes "${vps}:$remote/out/*" $tmp
Get-ChildItem $tmp -File | ForEach-Object {
  $dest = Join-Path $outPath ($_.BaseName + $Suffix + $_.Extension)
  Move-Item $_.FullName $dest -Force
  if ($_.Extension -eq '.jpg') { Write-Host "-> $dest" }
}
Remove-Item $tmp -Recurse -Force
