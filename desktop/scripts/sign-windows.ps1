$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:HOWL_CODE_SIGN_PFX_BASE64) -or [string]::IsNullOrWhiteSpace($env:HOWL_CODE_SIGN_PFX_PASSWORD)) {
  throw "HOWL_CODE_SIGN_PFX_BASE64 and HOWL_CODE_SIGN_PFX_PASSWORD are required."
}

$certificatePath = Join-Path $env:RUNNER_TEMP "howl-host-signing.pfx"
[Convert]::FromBase64String($env:HOWL_CODE_SIGN_PFX_BASE64) | Set-Content -Path $certificatePath -AsByteStream

$signTool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin" -Recurse -Filter "signtool.exe" |
  Sort-Object FullName -Descending |
  Select-Object -First 1 -ExpandProperty FullName
if (-not $signTool) { throw "signtool.exe was not found on this Windows runner." }

$artifacts = Get-ChildItem "src-tauri\target\release\bundle" -Recurse -Include *.exe,*.msi
if (-not $artifacts) { throw "No Windows installer artifacts were found to sign." }

foreach ($artifact in $artifacts) {
  & $signTool sign /fd SHA256 /f $certificatePath /p $env:HOWL_CODE_SIGN_PFX_PASSWORD /tr $env:HOWL_TIMESTAMP_URL /td SHA256 /v $artifact.FullName
  if ($LASTEXITCODE -ne 0) { throw "Signing failed for $($artifact.Name)." }
  & $signTool verify /pa /v $artifact.FullName
  if ($LASTEXITCODE -ne 0) { throw "Signature verification failed for $($artifact.Name)." }
}

Remove-Item -LiteralPath $certificatePath -Force
