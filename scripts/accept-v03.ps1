# Windows acceptance entry; no installation, formal configuration write, model pull or deployment.
[CmdletBinding()]
param(
    [string]$PiCli,
    [string]$Model = 'mimo-v2.6-agent32k:latest',
    [switch]$SkipModel
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$pin = Get-Content -LiteralPath (Join-Path $repo 'manifests/packages.json') -Raw | ConvertFrom-Json
if (-not $IsWindows) { throw 'This acceptance entry currently targets Windows + PowerShell 7.' }
if (-not $PiCli) {
    $PiCli = Join-Path $HOME (".pi/agent/install/releases/" + $pin.pi.version + "/node_modules/" + $pin.pi.package + "/dist/cli.js")
}
if (-not (Test-Path -LiteralPath $PiCli -PathType Leaf)) {
    throw "Pinned Pi CLI not found: $PiCli. Use -PiCli with an existing matching CLI. No installation or upgrade is performed."
}
$PiCli = (Resolve-Path -LiteralPath $PiCli -ErrorAction Stop).Path
foreach ($cmd in @('node','git','pi','pwsh')) { Get-Command $cmd -ErrorAction Stop | Out-Null }
$nodeVersion = (& node --version).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw 'Use existing Node.js 24.x; no automatic upgrade.' }
$piVersion = (& node $PiCli --version).Trim()
if ($LASTEXITCODE -ne 0 -or $piVersion -notmatch ('(^|\s)' + [regex]::Escape([string]$pin.pi.version) + '($|\s)')) { throw "Pinned Pi CLI version mismatch: detected '$piVersion', expected '$($pin.pi.version)'. No automatic upgrade." }
$installedPi = (& pi --version).Trim()
if ($LASTEXITCODE -ne 0 -or $installedPi -notmatch ('(^|\s)' + [regex]::Escape([string]$pin.pi.version) + '($|\s)')) { throw "The existing pi command reports '$installedPi', but sync tests require '$($pin.pi.version)'. Do not downgrade or alter PATH solely to pass this check." }
if (-not $SkipModel) {
    if (!$Model -or $Model -match 'cloud|remote') { throw 'Select an already downloaded local model, not cloud.' }
    $tags = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5
    $local = @($tags.models | Where-Object { ($_.name -ceq $Model -or $_.name -ceq ($Model + ':latest')) -and $_.size -gt 0 -and -not $_.remote_model -and -not $_.remote_host })
    if ($local.Count -ne 1) { throw 'Local model not found or ambiguous. No model is downloaded.' }
}
$evidence = Join-Path ([IO.Path]::GetTempPath()) ('astra-v03-accept-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $evidence | Out-Null
$results = [System.Collections.Generic.List[object]]::new()
function Run-Check([string]$Name,[string]$Command,[string[]]$Arguments) {
    Write-Host "=== $Name ==="
    $log = Join-Path $evidence ($Name + '.log')
    & $Command @Arguments 2>&1 | Tee-Object -FilePath $log | Out-Host
    $code = $LASTEXITCODE
    $results.Add([pscustomobject]@{ name=$Name; exitCode=$code; status= $(if ($code -eq 0) {'PASS'} else {'FAIL'}) })
    if ($code -ne 0) { throw "$Name returned $code; review $log" }
}
$failed = $false
Push-Location $repo
try {
    $commit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify checkout.' }
    $units = @('checkpoint','retry-limit','task-recovery','tool-profile','verification-evidence','diff-review','handoff')
    $unitPaths = @($units | ForEach-Object { "tests/$_.test.mjs" })
    Run-Check 'core-unit' 'node' (@('--test') + $unitPaths)
    foreach ($test in @('mode-rpc','skill-discovery-rpc','retry-limit-rpc','natural-recovery-rpc','verification-evidence-rpc','checkpoint-rpc','command-guard-rpc','diff-review-rpc','handoff-rpc','task-recovery-rpc')) {
        Run-Check $test 'node' @("tests/$test.mjs", $PiCli)
    }
    Run-Check 'sync-restore-dry-run-fixtures' 'pwsh' @('-NoProfile','-File','tests/sync.ps1')
    if ($SkipModel) {
        $results.Add([pscustomobject]@{ name='local-model'; exitCode=$null; status='SKIP' })
    } else {
        Run-Check 'local-model' 'node' @('tests/real-model/autonomous.mjs',$PiCli,$Model)
    }
} catch {
    $failed = $true
    Write-Host $_.Exception.Message -ForegroundColor Red
} finally {
    Pop-Location
    [pscustomobject]@{
        commit=$commit; node=$nodeVersion; pi=$piVersion; launcherPi=$installedPi; model= $(if ($SkipModel) {$null} else {$Model});
        status= $(if ($failed) {'FAIL_OR_BLOCKED'} elseif ($SkipModel) {'CORE_PASS_MODEL_SKIPPED'} else {'CORE_AND_ONE_MODEL_CASE_PASS'});
        checks=@($results.ToArray()); limitations=@('Not a release gate for all stacks/models','Roslyn and dependency restore not run here','Formal Pi/TTY/Herdr and second-machine acceptance pending','Model test is not an OS sandbox')
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $evidence 'summary.json') -Encoding utf8
    Write-Host "Evidence: $evidence"
}
if ($failed) { exit 1 }
exit 0
