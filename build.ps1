# Собирает один самодостаточный html: index.src.html + styles.css + headphones.js + app.js
# Маркеры в шаблоне: /*@@STYLES@@*/ внутри <style>, //@@SCRIPT@@ внутри <script type="module">
param(
  [string]$Template = "index.src.html",
  [string]$Styles = "styles.css",
  [string]$Headphones = "headphones.js",
  [string]$App = "app.js",
  [string]$Out = "dist\index.html"
)
$root = $PSScriptRoot
function Resolve-Src([string]$p, [string]$stub) {
  $full = Join-Path $root $p
  if (Test-Path $full) { return $full }
  # в CI заглушка недопустима: иначе на Pages молча уедет пустой сайт
  if ($env:GITHUB_ACTIONS) { throw "нет $p" }
  $s = Join-Path $root $stub
  Write-Host "нет $p, беру заглушку $stub"
  return $s
}
$tplPath = Resolve-Src $Template "_dev\index-stub.html"
$cssPath = Resolve-Src $Styles "_dev\styles-stub.css"
$hpPath = Resolve-Src $Headphones "_dev\headphones-stub.js"
$appPath = Resolve-Src $App "_dev\app-stub.js"

$enc = New-Object System.Text.UTF8Encoding $false
$tpl = [IO.File]::ReadAllText($tplPath, $enc)
$css = [IO.File]::ReadAllText($cssPath, $enc)
$js = [IO.File]::ReadAllText($hpPath, $enc) + "`n`n" + [IO.File]::ReadAllText($appPath, $enc)

if (-not $tpl.Contains("/*@@STYLES@@*/")) { throw "в шаблоне нет /*@@STYLES@@*/" }
if (-not $tpl.Contains("//@@SCRIPT@@")) { throw "в шаблоне нет //@@SCRIPT@@" }
$html = $tpl.Replace("/*@@STYLES@@*/", $css).Replace("//@@SCRIPT@@", $js)

$outPath = Join-Path $root $Out
New-Item -ItemType Directory -Force (Split-Path $outPath) | Out-Null
[IO.File]::WriteAllText($outPath, $html, $enc)
Write-Host "OK -> $outPath ($([math]::Round($html.Length / 1kb)) KB)"
