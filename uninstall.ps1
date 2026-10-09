[CmdletBinding()]
param([string]$Profile = 'web', [switch]$DryRun, [switch]$Force, [switch]$Help)
$ErrorActionPreference = 'Stop'
$taskArguments = @((Join-Path $PSScriptRoot 'scripts/uninstall.mjs'), '--profile', $Profile)
if ($DryRun) { $taskArguments += '--dry-run' }
if ($Force) { $taskArguments += '--force' }
if ($Help) { $taskArguments += '--help' }
& node @taskArguments
exit $LASTEXITCODE
