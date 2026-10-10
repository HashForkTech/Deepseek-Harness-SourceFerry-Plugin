[CmdletBinding()]
param([string]$Profile = 'SourceFerry', [switch]$DryRun, [switch]$Help)
$ErrorActionPreference = 'Stop'
$taskArguments = @((Join-Path $PSScriptRoot 'scripts/uninstall.mjs'), '--profile', $Profile)
if ($DryRun) { $taskArguments += '--dry-run' }
if ($Help) { $taskArguments += '--help' }
& node @taskArguments
exit $LASTEXITCODE
