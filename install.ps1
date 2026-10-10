[CmdletBinding()]
param(
  [string]$Profile = 'SourceFerry',
  [string]$GatewayUrl,
  [switch]$KeepNative,
  [switch]$Verify,
  [switch]$Help
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24+ (including npm), then rerun this command.' }
$taskArguments = @((Join-Path $PSScriptRoot 'scripts/install.mjs'), '--profile', $Profile)
if ($GatewayUrl) { $taskArguments += @('--gateway-url', $GatewayUrl) }
if ($KeepNative) { $taskArguments += '--keep-native' }
if ($Verify) { $taskArguments += '--verify' }
if ($Help) { $taskArguments += '--help' }
& node @taskArguments
exit $LASTEXITCODE
