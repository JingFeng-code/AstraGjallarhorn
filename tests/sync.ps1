$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$root = Join-Path ([IO.Path]::GetTempPath()) ("astra-sync-" + [guid]::NewGuid().ToString('N'))
$piHome = Join-Path $root '.pi'
$agent = Join-Path $piHome 'agent'
$state = Join-Path $root 'appdata'
$settings = Join-Path $agent 'settings.json'
$originalAppData = $env:LOCALAPPDATA
$originalPath = $env:PATH
$originalFixture = $env:ASTRA_TEST_GH_VISIBILITY

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
    $pinnedBytes = [IO.File]::ReadAllBytes($settings)
    $pinnedHash = (Get-FileHash $settings).Hash
    Invoke-Check 'export' 0 @{DryRun=$true; NoDiff=$true}
    Invoke-Check 'export' 1 @{Apply=$true; NoDiff=$true}
    Invoke-Check 'export' 1 @{Apply=$true; DryRun=$true; NoDiff=$true}
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
    # Offline fake gh; only this disposable fixture PATH changes.
    $fixtureBin = Join-Path $root 'fixture-bin'
    New-Item -ItemType Directory -Path $fixtureBin | Out-Null
    @'
@echo off
node "%~dp0gh-fixture.cjs" %*
exit /b %errorlevel%
'@ | Set-Content -LiteralPath (Join-Path $fixtureBin 'gh.cmd') -Encoding ascii
    @'
const args = process.argv.slice(2);
if (JSON.stringify(args) !== JSON.stringify(["api","--hostname","github.com","--method","GET","repos/astra-test/private-fixture"])) process.exit(90);
const mode = process.env.ASTRA_TEST_GH_VISIBILITY;
if (mode === "error") process.exit(1);
if (mode === "invalid") { console.log("not json"); process.exit(0); }
console.log(JSON.stringify({full_name: mode === "mismatch" ? "other/repo" : "astra-test/private-fixture", private: mode !== "public" && mode !== "missing", visibility: mode === "mismatch" ? "private" : mode === "missing" ? undefined : mode}));
'@ | Set-Content -LiteralPath (Join-Path $fixtureBin 'gh-fixture.cjs') -Encoding ascii
    $env:PATH = $fixtureBin + [IO.Path]::PathSeparator + $originalPath
    $env:ASTRA_TEST_GH_VISIBILITY = 'private'
    if ((Get-Command gh -CommandType Application | Select-Object -First 1).Source -ne (Join-Path $fixtureBin 'gh.cmd')) { throw 'Offline gh fixture did not take precedence' }
    Invoke-Check 'export' 0 @{RepoPath=$exportRepo; NoDiff=$true}
    if ((Get-FileHash $exportTarget).Hash -ne $exportHash) { throw 'Default export overwrote target' }
    Invoke-Check 'export' 1 @{RepoPath=$exportRepo; Apply=$true; NoDiff=$true}
    & git -C $exportRepo remote add origin https://github.com/JingFeng-code/AstraGjallarhorn.git
    if ($LASTEXITCODE) { throw 'Could not configure public fixture' }
    Invoke-Check 'export' 1 @{RepoPath=$exportRepo; Apply=$true; NoDiff=$true}
    & git -C $exportRepo remote set-url origin https://github.com/astra-test/private-fixture.git
    if ($LASTEXITCODE) { throw 'Could not configure private fixture' }
    foreach ($visibility in @('public','internal','missing','mismatch','invalid','error')) {
        $env:ASTRA_TEST_GH_VISIBILITY = $visibility
        Invoke-Check 'export' 1 @{RepoPath=$exportRepo; Apply=$true; NoDiff=$true}
        if ((Get-FileHash $exportTarget).Hash -ne $exportHash) { throw "Denied export wrote target: $visibility" }
    }
    $env:ASTRA_TEST_GH_VISIBILITY = 'private'
    & git -C $exportRepo remote set-url origin https://example.invalid/astra-test/private-fixture.git
    if ($LASTEXITCODE) { throw 'Could not configure unsupported host fixture' }
    Invoke-Check 'export' 1 @{RepoPath=$exportRepo; Apply=$true; NoDiff=$true}
    & git -C $exportRepo remote set-url origin https://github.com/astra-test/private-fixture.git
    if ($LASTEXITCODE) { throw 'Could not restore private fixture' }
    & git -C $exportRepo remote set-url --push origin https://github.com/astra-test/other.git
    if ($LASTEXITCODE) { throw 'Could not configure mismatched push fixture' }
    Invoke-Check 'export' 1 @{RepoPath=$exportRepo; Apply=$true; NoDiff=$true}
    & git -C $exportRepo remote set-url --push origin git@github.com:astra-test/private-fixture.git
    if ($LASTEXITCODE) { throw 'Could not configure matching push fixture' }
    & git -C $exportRepo remote add second https://github.com/astra-test/other.git
    if ($LASTEXITCODE) { throw 'Could not configure additional remote fixture' }
    Invoke-Check 'export' 1 @{RepoPath=$exportRepo; Apply=$true; NoDiff=$true}
    & git -C $exportRepo remote remove second
    if ($LASTEXITCODE) { throw 'Could not remove fixture remote' }
    Invoke-Check 'export' 3 @{RepoPath=$exportRepo; Apply=$true; NoDiff=$true}
    if ((Get-FileHash $exportTarget).Hash -ne $exportHash) { throw 'Export overwrote uncommitted work' }
    # Commit only synthetic disposable files, then exercise the verified write path.
    & git -C $exportRepo add --all
    if ($LASTEXITCODE) { throw 'Could not stage disposable fixture' }
    & git -C $exportRepo -c user.name='Synthetic Fixture' -c user.email='fixture@example.invalid' -c commit.gpgsign=false -c "core.hooksPath=$fixtureBin" commit --quiet -m 'Synthetic export baseline'
    if ($LASTEXITCODE) { throw 'Could not commit disposable fixture' }
    Invoke-Check 'export' 0 @{RepoPath=$exportRepo; Apply=$true; NoDiff=$true}
    if ((Get-FileHash $exportTarget).Hash -eq $exportHash) { throw 'Authorized private fixture did not update target' }
    $env:PATH = $originalPath
    $env:ASTRA_TEST_GH_VISIBILITY = $originalFixture
    Invoke-Check 'verify' 0 @{}
    Set-Content -LiteralPath $settings -Value $initial
    Invoke-Check 'verify' 1 @{}
    [IO.File]::WriteAllBytes($settings, $pinnedBytes)
    $extension = Join-Path $agent 'extensions/mode-switch.ts'
    Add-Content -LiteralPath $extension -Value '// Local edit that apply must preserve'
    $editedHash = (Get-FileHash $extension).Hash
    Invoke-Check 'apply' 3 @{StrictVersion=$true; Apply=$true}
    if ((Get-FileHash $extension).Hash -ne $editedHash) { throw 'Apply overwrote a local edit' }
    Invoke-Check 'apply' 3 @{Restore=$true; RestoreFrom=$backup; Apply=$true}
    if ((Get-FileHash $extension).Hash -ne $editedHash -or (Get-FileHash $settings).Hash -ne $pinnedHash) {
        throw 'Restore changed files despite a conflict'
    }
    Copy-Item -LiteralPath (Join-Path $repo 'extensions/mode-switch.ts') -Destination $extension -Force
    Add-Content -LiteralPath $settings -Value ' '
    $editedSettingsHash = (Get-FileHash $settings).Hash
    Invoke-Check 'apply' 3 @{Restore=$true; RestoreFrom=$backup; Apply=$true}
    if (!(Test-Path $extension) -or (Get-FileHash $settings).Hash -ne $editedSettingsHash) {
        throw 'Restore overwrote settings or removed an extension despite a settings conflict'
    }
    [IO.File]::WriteAllBytes($settings, $pinnedBytes)
    Invoke-Check 'apply' 0 @{Restore=$true; RestoreFrom=$backup}
    if ((Get-FileHash $settings).Hash -ne $pinnedHash) { throw 'Restore dry run wrote settings' }
    $backupManifest = Join-Path $backup 'backup.json'
    $backupManifestBytes = [IO.File]::ReadAllBytes($backupManifest)
    $legacyBackup = Get-Content -LiteralPath $backupManifest -Raw | ConvertFrom-Json
    foreach ($record in $legacyBackup.files) { $record.PSObject.Properties.Remove('appliedHash') }
    $legacyBackup | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $backupManifest
    Invoke-Check 'apply' 0 @{Restore=$true; RestoreFrom=$backup}
    Invoke-Check 'apply' 3 @{Restore=$true; RestoreFrom=$backup; Apply=$true}
    if (!(Test-Path $extension) -or (Get-FileHash $settings).Hash -ne $pinnedHash) {
        throw 'A legacy backup without applied hashes changed live files'
    }
    [IO.File]::WriteAllBytes($backupManifest, $backupManifestBytes)
    Invoke-Check 'apply' 0 @{Restore=$true; RestoreFrom=$backup; Apply=$true}
    if ((Get-FileHash $settings).Hash -ne $initialHash -or (Test-Path (Join-Path $agent 'extensions/mode-switch.ts'))) {
        throw 'Restore did not recover the original fixture'
    }
    Set-Content -LiteralPath $settings -Value '{"packages":["npm:pi-agnes-tools","npm:pi-agnes-tools@0.3.7"]}'
    $duplicateHash = (Get-FileHash $settings).Hash
    Invoke-Check 'apply' 1 @{StrictVersion=$true; Apply=$true}
    if ((Get-FileHash $settings).Hash -ne $duplicateHash) { throw 'Duplicate declarations were modified' }
    Write-Output 'PASS: apply dry run, version pin merge, export dry run, fail-closed private destination, authorized export, verify, apply and restore conflict protection, backup, restore, duplicate protection'
} finally {
    $env:LOCALAPPDATA = $originalAppData
    $env:PATH = $originalPath
    $env:ASTRA_TEST_GH_VISIBILITY = $originalFixture
    if (Test-Path -LiteralPath $root) {
        $resolved = (Resolve-Path -LiteralPath $root).Path
        $expectedParent = [IO.Path]::TrimEndingDirectorySeparator((Resolve-Path -LiteralPath ([IO.Path]::GetTempPath())).Path)
        if ((Split-Path -Parent $resolved) -ne $expectedParent -or (Split-Path -Leaf $resolved) -notlike 'astra-sync-*') {
            throw "Unexpected temporary path: $resolved"
        }
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
