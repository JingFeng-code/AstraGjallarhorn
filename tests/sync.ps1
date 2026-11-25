$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$root = Join-Path ([IO.Path]::GetTempPath()) ("astra-sync-" + [guid]::NewGuid().ToString('N'))
$piHome = Join-Path $root '.pi'
$agent = Join-Path $piHome 'agent'
$state = Join-Path $root 'appdata'
$settings = Join-Path $agent 'settings.json'
$originalAppData = $env:LOCALAPPDATA

function Invoke-Check([string]$Name, [int]$Expected, [hashtable]$Arguments) {
    & (Join-Path $repo "scripts/$Name.ps1") -PiHome $piHome @Arguments | Out-Host
    if ($LASTEXITCODE -ne $Expected) { throw "$Name returned $LASTEXITCODE, expected $Expected" }
}

try {
    New-Item -ItemType Directory -Path $agent, $state -Force | Out-Null
    $env:LOCALAPPDATA = $state
    $initial = '{"packages":[{"source":"npm:pi-agnes-tools","extensions":[],"custom":"keep"},"npm:pi-ollama-cloud"],"unknown":{"keep":true}}'
    Set-Content -LiteralPath $settings -Value $initial
    $initialHash = (Get-FileHash -LiteralPath $settings).Hash
    foreach ($package in (Get-Content (Join-Path $repo 'manifests/packages.json') -Raw | ConvertFrom-Json).packages) {
        $folder = Join-Path $agent ("npm/node_modules/" + $package.name)
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
        @{ name = $package.name; version = $package.version } | ConvertTo-Json | Set-Content (Join-Path $folder 'package.json')
    }

    Invoke-Check 'apply' 0 @{StrictVersion=$true}
    if ((Get-FileHash $settings).Hash -ne $initialHash -or (Get-ChildItem $state -Force)) { throw 'Dry run wrote state' }
    Invoke-Check 'apply' 0 @{StrictVersion=$true; Apply=$true}
    $result = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
    if ($result.packages[0].source -cne 'npm:pi-agnes-tools@0.3.7' -or
        $result.packages[0].custom -cne 'keep' -or $result.packages[0].extensions.Count -ne 0 -or
        $result.packages[1] -cne 'npm:pi-ollama-cloud@0.13.1' -or !$result.unknown.keep) {
        throw 'Pinned settings did not preserve existing configuration'
    }
    $backup = (Get-ChildItem (Join-Path $state 'pi-config/backups') -Directory).FullName
    $pinnedHash = (Get-FileHash $settings).Hash
    Invoke-Check 'export' 0 @{DryRun=$true; NoDiff=$true}
    $exportRepo = Join-Path $root 'export-repo'
    New-Item -ItemType Directory -Path $exportRepo | Out-Null
    foreach ($name in @('manifests', 'extensions', 'modes', 'agent')) {
        Copy-Item -LiteralPath (Join-Path $repo $name) -Destination $exportRepo -Recurse
    }
    & git -C $exportRepo init --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize disposable export repository' }
    $exportTarget = Join-Path $exportRepo 'extensions/mode-switch.ts'
    Add-Content -LiteralPath $exportTarget -Value '// Uncommitted export target'
    $exportHash = (Get-FileHash $exportTarget).Hash
    Invoke-Check 'export' 3 @{RepoPath=$exportRepo; NoDiff=$true}
    if ((Get-FileHash $exportTarget).Hash -ne $exportHash) { throw 'Export overwrote uncommitted work' }
    Invoke-Check 'verify' 0 @{}
    Set-Content -LiteralPath $settings -Value $initial
    Invoke-Check 'verify' 1 @{}
    $result | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $settings
    $pinnedHash = (Get-FileHash $settings).Hash
    $extension = Join-Path $agent 'extensions/mode-switch.ts'
    Add-Content -LiteralPath $extension -Value '// Local edit that apply must preserve'
    $editedHash = (Get-FileHash $extension).Hash
    Invoke-Check 'apply' 3 @{StrictVersion=$true; Apply=$true}
    if ((Get-FileHash $extension).Hash -ne $editedHash) { throw 'Apply overwrote a local edit' }
    Copy-Item -LiteralPath (Join-Path $repo 'extensions/mode-switch.ts') -Destination $extension -Force
    Invoke-Check 'apply' 0 @{Restore=$true; RestoreFrom=$backup}
    if ((Get-FileHash $settings).Hash -ne $pinnedHash) { throw 'Restore dry run wrote settings' }
    Invoke-Check 'apply' 0 @{Restore=$true; RestoreFrom=$backup; Apply=$true}
    if ((Get-FileHash $settings).Hash -ne $initialHash -or (Test-Path (Join-Path $agent 'extensions/mode-switch.ts'))) {
        throw 'Restore did not recover the original fixture'
    }
    Set-Content -LiteralPath $settings -Value '{"packages":["npm:pi-agnes-tools","npm:pi-agnes-tools@0.3.7"]}'
    $duplicateHash = (Get-FileHash $settings).Hash
    Invoke-Check 'apply' 1 @{StrictVersion=$true; Apply=$true}
    if ((Get-FileHash $settings).Hash -ne $duplicateHash) { throw 'Duplicate declarations were modified' }
    Write-Output 'PASS: apply dry run, version pin merge, export dry run, verify, conflict protection, backup, restore, duplicate protection'
} finally {
    $env:LOCALAPPDATA = $originalAppData
    if (Test-Path -LiteralPath $root) {
        $resolved = (Resolve-Path -LiteralPath $root).Path
        $expectedParent = [IO.Path]::TrimEndingDirectorySeparator((Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path)
        if ((Split-Path -Parent $resolved) -ne $expectedParent -or (Split-Path -Leaf $resolved) -notlike 'astra-sync-*') {
            throw "Unexpected temporary path: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
