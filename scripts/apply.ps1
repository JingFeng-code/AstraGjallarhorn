<#
.SYNOPSIS
    將 pi-config 儲存庫中的設定套用到本機 Pi。

.DESCRIPTION
    安全設計：
      * 預設 Dry Run：必須加 -Apply 才會實際寫入。
      * 套用前備份所有會被寫入的檔案（含 settings.json）到本機備份目錄。
      * 衝突即停止：目標檔案存在、內容不同、且不在上次套用紀錄中（或已被本機修改）
        視為衝突，除非加 -Force，否則不覆寫。
      * 不碰認證：auth.json 不在同步清單，且被敏感檔名守門機制擋下。
      * 不動 Provider 憑證、不動 mode-state.json、不動 Session。
      * 不升級 Pi 核心；版本不相容時預設警告，-StrictVersion 時中止。
      * 支援 -Restore 還原（從備份目錄回寫，並刪除當時不存在的新增檔案）。

.PARAMETER Apply
    實際寫入。未指定時為 Dry Run。

.PARAMETER InstallPackages
    對版本不符的套件執行 `pi install <pin>`（固定版本）。預設只提示、不安裝。

.PARAMETER Force
    遇到衝突時仍覆寫（仍會先備份）。

.PARAMETER Restore
    還原模式。搭配 -RestoreLatest 或 -RestoreFrom 使用。

.PARAMETER RestoreLatest
    使用最近一次備份還原。

.PARAMETER RestoreFrom
    指定備份目錄（例如 ...\pi-config\backups\20260101-120000）還原。

.EXAMPLE
    pwsh -File scripts/apply.ps1

.EXAMPLE
    pwsh -File scripts/apply.ps1 -Apply

.EXAMPLE
    pwsh -File scripts/apply.ps1 -Restore -RestoreLatest -Apply
#>

[CmdletBinding()]
param(
    [string]$RepoPath,
    [string]$PiHome,
    [switch]$Apply,
    [switch]$InstallPackages,
    [switch]$Force,
    [switch]$StrictVersion,
    [switch]$Restore,
    [switch]$RestoreLatest,
    [string]$RestoreFrom
)

$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptRoot)) { $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($RepoPath)) { $RepoPath = Split-Path -Parent $scriptRoot }
$scriptPath = Join-Path $scriptRoot (Split-Path -Leaf $MyInvocation.MyCommand.Path)
. (Join-Path $scriptRoot 'lib/common.ps1')
Initialize-PiConfigConsole

# ---------------------------------------------------------------------------
# 本機狀態（備份 / 套用紀錄）
# ---------------------------------------------------------------------------

function Get-LedgerPath {
    return (Join-Path (Get-PiConfigStateDir) 'applied.json')
}

function Read-LedgerEntries {
    param([string]$PiHomePath)
    $path = Get-LedgerPath
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return @{} }
    $ledger = Read-JsonFile $path
    $homes = Get-Prop $ledger 'homes'
    if ($null -eq $homes) { return @{} }
    $homeEntry = $homes.PSObject.Properties[$PiHomePath]
    if ($null -eq $homeEntry) { return @{} }
    $files = Get-Prop $homeEntry.Value 'files'
    $map = @{}
    if ($null -ne $files) {
        foreach ($prop in $files.PSObject.Properties) {
            $map[$prop.Name] = [string]$prop.Value
        }
    }
    return $map
}

function Save-LedgerEntries {
    param([string]$PiHomePath, [hashtable]$Entries)
    $path = Get-LedgerPath
    $homesMap = [ordered]@{}
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        $ledger = Read-JsonFile $path
        $homes = Get-Prop $ledger 'homes'
        if ($null -ne $homes) {
            foreach ($prop in $homes.PSObject.Properties) {
                if ($prop.Name -eq $PiHomePath) { continue }
                $filesMap = [ordered]@{}
                $files = Get-Prop $prop.Value 'files'
                if ($null -ne $files) {
                    foreach ($fileProp in $files.PSObject.Properties) {
                        $filesMap[$fileProp.Name] = [string]$fileProp.Value
                    }
                }
                $homesMap[$prop.Name] = [ordered]@{
                    appliedAt = [string](Get-Prop $prop.Value 'appliedAt' '')
                    files     = $filesMap
                }
            }
        }
    }
    $filesOut = [ordered]@{}
    foreach ($key in ($Entries.Keys | Sort-Object)) {
        $filesOut[$key] = [string]$Entries[$key]
    }
    $homesMap[$PiHomePath] = [ordered]@{
        appliedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
        files     = $filesOut
    }
    Write-JsonFile -Path $path -Object ([ordered]@{ schemaVersion = 1; homes = $homesMap })
}

function New-Backup {
    param([string]$PiHomePath, $Items)
    $timestamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $root = Join-Path (Get-PiConfigStateDir) ("backups/" + $timestamp)
    $filesRoot = Join-Path $root 'files'
    New-Item -ItemType Directory -Path $filesRoot -Force | Out-Null

    $records = @()
    foreach ($item in $Items) {
        $livePath = $item.LivePath
        $existed = Test-Path -LiteralPath $livePath -PathType Leaf
        $hash = $null
        if ($existed) {
            $dest = Join-RepoPath -Base $filesRoot -Relative $item.PiRel
            $destDir = [System.IO.Path]::GetDirectoryName($dest)
            if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
            [System.IO.File]::Copy($livePath, $dest, $true)
            $hash = Get-NormalizedHash $livePath
        }
        $records += ([ordered]@{
            piRel   = $item.PiRel
            existed = [bool]$existed
            hash    = $hash
        })
    }

    $manifestPath = Join-Path $root 'backup.json'
    Write-JsonFile -Path $manifestPath -Object ([ordered]@{
        schemaVersion = 1
        createdAt     = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
        piHome        = $PiHomePath
        files         = @($records)
    })

    return $root
}

function Invoke-Restore {
    param([string]$PiHomePath, [string]$BackupRoot)

    if (-not (Test-Path -LiteralPath $BackupRoot -PathType Container)) {
        throw "找不到備份目錄：$BackupRoot"
    }
    $manifestPath = Join-Path $BackupRoot 'backup.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "備份目錄缺少 backup.json：$BackupRoot"
    }
    $backup = Read-JsonFile $manifestPath
    $backupPiHome = [string](Get-Prop $backup 'piHome' '')
    if (-not [string]::IsNullOrWhiteSpace($backupPiHome) -and $backupPiHome -ne $PiHomePath) {
        throw "備份來自 '$backupPiHome'，與目前 Pi 家目錄 '$PiHomePath' 不同，拒絕還原。"
    }

    $records = @(Get-Prop $backup 'files' @())
    $filesRoot = Join-Path $BackupRoot 'files'
    $ledger = Read-LedgerEntries -PiHomePath $PiHomePath
    $restoreCount = 0
    $deleteCount = 0

    foreach ($record in $records) {
        $piRel = [string](Get-Prop $record 'piRel' '')
        if ([string]::IsNullOrWhiteSpace($piRel)) { continue }
        $existed = [bool](Get-Prop $record 'existed' $false)
        $livePath = Join-RepoPath -Base $PiHomePath -Relative $piRel

        if ($existed) {
            $source = Join-RepoPath -Base $filesRoot -Relative $piRel
            if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
                Write-WarnLine "備份缺少檔案，跳過：$piRel"
                continue
            }
            $destDir = [System.IO.Path]::GetDirectoryName($livePath)
            if (-not (Test-Path -LiteralPath $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
            if ($Apply) {
                [System.IO.File]::Copy($source, $livePath, $true)
                $ledger[$piRel] = [string](Get-NormalizedHash $livePath)
            }
            Write-OkLine ("還原 {0}" -f $piRel)
            $restoreCount++
        } else {
            if (Test-Path -LiteralPath $livePath -PathType Leaf) {
                if ($Apply) {
                    Remove-Item -LiteralPath $livePath -Force
                    # 清掉因此變空、且不屬於 Pi 家目錄本身的父目錄
                    $parent = [System.IO.Path]::GetDirectoryName($livePath)
                    while (-not [string]::IsNullOrWhiteSpace($parent) -and
                        $parent.Length -gt $PiHomePath.Length -and
                        (Test-Path -LiteralPath $parent -PathType Container) -and
                        @(Get-ChildItem -LiteralPath $parent -Force -ErrorAction SilentlyContinue).Count -eq 0) {
                        Remove-Item -LiteralPath $parent -Force
                        $parent = [System.IO.Path]::GetDirectoryName($parent)
                    }
                }
                if ($ledger.ContainsKey($piRel)) { $ledger.Remove($piRel) }
            }
            Write-OkLine ("移除（備份時不存在）{0}" -f $piRel)
            $deleteCount++
        }
    }

    if ($Apply) {
        Save-LedgerEntries -PiHomePath $PiHomePath -Entries $ledger
    }
    return [pscustomobject]@{ Restored = $restoreCount; Removed = $deleteCount }
}

# ---------------------------------------------------------------------------
# settings.json 套件合併（只補缺少的項目，不覆寫其他設定）
# ---------------------------------------------------------------------------

function Merge-SettingsPackages {
    param([string]$PiHomePath, $Packages)

    $settingsPath = Join-Path (Get-AgentDirPath $PiHomePath) 'settings.json'
    $settings = $null
    if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
        $settings = Read-JsonFile $settingsPath
    } else {
        $settings = New-Object psobject
    }

    $existing = @(Get-Prop $settings 'packages' @())
    $existingNames = @()
    foreach ($item in $existing) { $existingNames += (ConvertTo-PackageName ([string]$item)) }

    $added = @()
    $kept = @()
    foreach ($pkg in $Packages) {
        $name = [string](Get-Prop $pkg 'name' '')
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        if ($existingNames -contains $name) {
            $kept += $name
            continue
        }
        $existing += [string](Get-Prop $pkg 'pin' ("npm:{0}" -f $name))
        $added += $name
    }

    if ($added.Count -eq 0) {
        return [pscustomobject]@{ Changed = $false; Added = @(); Kept = $kept; SettingsPath = $settingsPath }
    }

    $settings | Add-Member -NotePropertyName 'packages' -NotePropertyValue @($existing) -Force
    if ($Apply) {
        Write-JsonFile -Path $settingsPath -Object $settings
    }
    return [pscustomobject]@{ Changed = $true; Added = $added; Kept = $kept; SettingsPath = $settingsPath }
}

function Save-ProviderBaselineOnce {
    <#
        第一次實際套用前，記錄本機既有的 Provider 名稱（不含任何憑證）。
        之後 verify 以此判斷「原有 Providers 未被破壞」，而不是拿來源電腦的清單硬比。
    #>
    param([string]$PiHomePath)
    $path = Get-ProviderBaselinePath $PiHomePath
    if (Test-Path -LiteralPath $path -PathType Leaf) { return $false }

    $authPath = Join-Path (Get-AgentDirPath $PiHomePath) 'auth.json'
    $providers = @()
    if (Test-Path -LiteralPath $authPath -PathType Leaf) {
        $auth = Read-JsonFile $authPath
        $providers = @($auth.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
    }
    Write-JsonFile -Path $path -Object ([ordered]@{
        schemaVersion = 1
        piHome        = $PiHomePath
        capturedAt    = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ssK')
        providers     = @($providers)
    }) -Depth 8
    return $true
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

try {
    $repo = [System.IO.Path]::GetFullPath($RepoPath)
    $pi = Get-PiHomePath $PiHome
    $agentDir = Get-AgentDirPath $PiHome
    $stateDir = Get-PiConfigStateDir

    Write-Section 'pi-config 套用'
    Write-InfoLine "Pi 家目錄：$pi"
    Write-InfoLine "儲存庫    ：$repo"
    Write-InfoLine "本機狀態  ：$stateDir"
    Write-InfoLine "模式      ：$(if ($Apply) { '實際寫入' } else { 'Dry Run（預設，不寫入）' })"

    # --- 還原模式 -----------------------------------------------------------
    if ($Restore -or $RestoreLatest -or -not [string]::IsNullOrWhiteSpace($RestoreFrom)) {
        if ($RestoreLatest -and -not [string]::IsNullOrWhiteSpace($RestoreFrom)) {
            throw '-RestoreLatest 與 -RestoreFrom 不可同時使用。'
        }
        $backupRoot = $RestoreFrom
        if ($RestoreLatest) {
            $backupsDir = Join-Path $stateDir 'backups'
            if (-not (Test-Path -LiteralPath $backupsDir -PathType Container)) {
                throw "沒有可用的備份目錄：$backupsDir"
            }
            $latest = Get-ChildItem -LiteralPath $backupsDir -Directory | Sort-Object Name -Descending | Select-Object -First 1
            if ($null -eq $latest) { throw "備份目錄是空的：$backupsDir" }
            $backupRoot = $latest.FullName
        }
        if ([string]::IsNullOrWhiteSpace($backupRoot)) {
            throw '請指定 -RestoreLatest 或 -RestoreFrom <備份目錄>。'
        }
        Write-Section '還原'
        Write-InfoLine "備份來源：$backupRoot"
        $result = Invoke-Restore -PiHomePath $pi -BackupRoot $backupRoot
        Write-InfoLine ("待還原 {0} 個檔案、移除 {1} 個新增檔案" -f $result.Restored, $result.Removed)
        if (-not $Apply) {
            Write-Section 'Dry Run 結束（未還原任何檔案；加上 -Apply 才會執行）'
        } else {
            Write-Section '還原完成'
            Write-InfoLine '請重新啟動 Pi 或執行 /reload。'
        }
        exit 0
    }

    if (-not (Test-Path -LiteralPath $pi -PathType Container)) {
        throw "Pi 家目錄不存在：$pi（請先安裝 Pi Agent）"
    }

    $manifest = Read-Manifest $repo

    # 第一次實際套用前，先記錄本機既有 Provider 名稱（不含憑證），供 verify 比對。
    if ($Apply) {
        if (Save-ProviderBaselineOnce -PiHomePath $pi) {
            Write-InfoLine '已建立本機 Provider 基準（供 verify 比對）'
        }
    }

    # --- 版本相容性 ---------------------------------------------------------
    Write-Section '版本相容性'
    $packagesPath = Join-Path $repo 'manifests/packages.json'
    if (-not (Test-Path -LiteralPath $packagesPath -PathType Leaf)) {
        throw '儲存庫缺少 manifests/packages.json，請先在來源電腦執行 export.ps1。'
    }
    $packagesManifest = Read-JsonFile $packagesPath
    $piInfo = Get-Prop $packagesManifest 'pi'
    $expectedVersion = [string](Get-Prop $piInfo 'version' '')
    $compatible = [string](Get-Prop $piInfo 'compatible' '')
    $currentVersion = Get-PiVersion

    Write-InfoLine ("目前 Pi 版本：{0}；儲存庫基準：{1}（相容：{2}）" -f $(if ($null -ne $currentVersion) { $currentVersion } else { '無法取得' }), $expectedVersion, $compatible)

    $versionOk = $true
    if ($null -ne $currentVersion -and $compatible -match '^(\d+)\.(\d+)\.x$') {
        $want = ('{0}.{1}.' -f $Matches[1], $Matches[2])
        if (-not $currentVersion.StartsWith($want)) { $versionOk = $false }
    }
    if (-not $versionOk) {
        if ($StrictVersion) {
            Write-FailLine 'Pi 版本與儲存庫不相容，且指定了 -StrictVersion，中止。'
            exit 4
        }
        Write-WarnLine 'Pi 版本與儲存庫基準不同；本腳本不會升級 Pi 核心。請自行確認相容性。'
    } else {
        Write-OkLine 'Pi 版本落在相容範圍'
    }

    # --- 建立計畫 -----------------------------------------------------------
    $repoEntries = Expand-RepoEntries -Manifest $manifest -RepoPath $repo
    $ledger = Read-LedgerEntries -PiHomePath $pi

    $plan = @()
    foreach ($entry in $repoEntries) {
        $livePath = Join-RepoPath -Base $pi -Relative $entry.PiRel
        $repoHash = Get-NormalizedHash $entry.RepoPath
        $liveHash = Get-NormalizedHash $livePath

        $status = 'add'
        if ($null -ne $liveHash) {
            if ($liveHash -eq $repoHash) {
                $status = 'same'
            } elseif ($ledger.ContainsKey($entry.RepoRel) -and $ledger[$entry.RepoRel] -eq $liveHash) {
                $status = 'update'
            } elseif ($ledger.ContainsKey($entry.RepoRel)) {
                $status = 'conflict-local-modified'
            } else {
                $status = 'conflict-unmanaged'
            }
        }

        $plan += [pscustomobject]@{
            RepoRel  = $entry.RepoRel
            RepoPath = $entry.RepoPath
            PiRel    = $entry.PiRel
            LivePath = $livePath
            RepoHash = $repoHash
            LiveHash = $liveHash
            Status   = $status
        }
    }

    # --- 儲存庫內容安全掃描（防呆）-----------------------------------------
    Write-Section '儲存庫內容掃描'
    $payloadPaths = @($plan | ForEach-Object { $_.RepoPath })
    $secretFindings = @(Invoke-SecretScan -Paths $payloadPaths)
    if ($secretFindings.Count -gt 0) {
        foreach ($finding in $secretFindings) {
            Write-FailLine ("儲存庫含疑似憑證：{0}:{1}（{2}）" -f $finding.Path, $finding.Line, $finding.Rule)
        }
        Write-FailLine '拒絕套用含憑證的儲存庫內容。'
        exit 2
    }
    Write-OkLine "憑證掃描：$($payloadPaths.Count) 個檔案，未發現憑證樣式"

    # --- 衝突檢查 -----------------------------------------------------------
    Write-Section '套用計畫'
    $conflicts = @($plan | Where-Object { $_.Status -like 'conflict-*' })
    $labelMap = @{
        'add'                     = @('新增', 'Green')
        'update'                  = @('更新', 'Yellow')
        'same'                    = @('相同', 'DarkGray')
        'conflict-local-modified' = @('衝突（本機已修改）', 'Red')
        'conflict-unmanaged'      = @('衝突（非 pi-config 管理）', 'Red')
    }
    foreach ($status in @('add', 'update', 'conflict-local-modified', 'conflict-unmanaged', 'same')) {
        foreach ($item in ($plan | Where-Object { $_.Status -eq $status })) {
            $label = $labelMap[$status][0]
            Write-Host ("  [{0}] {1}" -f $label, $item.PiRel) -ForegroundColor $labelMap[$status][1]
        }
    }

    $pending = @($plan | Where-Object { $_.Status -eq 'add' -or $_.Status -eq 'update' })
    Write-InfoLine ''
    Write-InfoLine ("合計：新增 {0}、更新 {1}、相同 {2}、衝突 {3}" -f `
        @($plan | Where-Object { $_.Status -eq 'add' }).Count, `
        @($plan | Where-Object { $_.Status -eq 'update' }).Count, `
        @($plan | Where-Object { $_.Status -eq 'same' }).Count, `
        $conflicts.Count)

    if ($conflicts.Count -gt 0) {
        foreach ($item in $conflicts) {
            Write-FailLine ("{0}：目標檔案已存在且內容不同（{1}）" -f $item.PiRel, $item.LivePath)
        }
        if (-not $Force) {
            Write-FailLine '偵測到衝突，已停止。請先手動確認/備份，或使用 -Force（仍會先備份）。'
            exit 3
        }
        Write-WarnLine '已指定 -Force：衝突檔案會被覆寫（備份後）。'
        $pending = @($plan | Where-Object { $_.Status -ne 'same' })
    }

    if ($pending.Count -eq 0) {
        Write-Section '沒有需要套用的變更'
        exit 0
    }

    # --- 套件 ---------------------------------------------------------------
    $packageItems = @(Get-Prop $packagesManifest 'packages' @())
    $packageActions = @()
    foreach ($pkg in $packageItems) {
        $name = [string](Get-Prop $pkg 'name' '')
        $version = [string](Get-Prop $pkg 'version' '')
        $pin = [string](Get-Prop $pkg 'pin' ("npm:{0}@{1}" -f $name, $version))
        $installed = Get-InstalledPackageVersion $pi $name
        $packageActions += [pscustomobject]@{
            Name      = $name
            Wanted    = $version
            Installed = $(if ($null -ne $installed) { $installed } else { '(未安裝)' })
            Pin       = $pin
            NeedInstall = ($null -eq $installed) -or ($installed -ne $version)
        }
    }

    Write-Section '套件狀態'
    foreach ($pkg in $packageActions) {
        if ($pkg.NeedInstall) {
            Write-WarnLine ("{0}：目前 {1}，儲存庫要求 {2}" -f $pkg.Name, $pkg.Installed, $pkg.Wanted)
        } else {
            Write-OkLine ("{0}：{1}（符合）" -f $pkg.Name, $pkg.Installed)
        }
    }

    if (-not $Apply) {
        Write-Section 'Dry Run 結束（未寫入任何檔案）'
        Write-InfoLine '確認無誤後，加上 -Apply 執行：'
        Write-InfoLine "  pwsh -File `"$scriptPath`" -Apply"
        exit 0
    }

    # --- 備份 ---------------------------------------------------------------
    Write-Section '備份現有設定'
    $backupItems = @($pending | ForEach-Object { [pscustomobject]@{ PiRel = $_.PiRel; LivePath = $_.LivePath } })
    $settingsLive = Join-Path $agentDir 'settings.json'
    $backupItems += [pscustomobject]@{ PiRel = 'agent/settings.json'; LivePath = $settingsLive }
    $backupRoot = New-Backup -PiHomePath $pi -Items $backupItems
    Write-OkLine "備份完成：$backupRoot"
    Write-InfoLine '還原指令：'
    Write-InfoLine ("  pwsh -File `"$scriptPath`" -Restore -RestoreFrom `"$backupRoot`" -Apply")

    # --- 套用檔案 -----------------------------------------------------------
    Write-Section '寫入檔案'
    $applied = 0
    foreach ($item in $pending) {
        $destDir = [System.IO.Path]::GetDirectoryName($item.LivePath)
        if (-not (Test-Path -LiteralPath $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        [System.IO.File]::Copy($item.RepoPath, $item.LivePath, $true)
        $ledger[$item.RepoRel] = Get-NormalizedHash $item.LivePath
        Write-OkLine ("{0} -> {1}" -f $item.RepoRel, $item.PiRel)
        $applied++
    }

    # --- settings.json 套件合併 ---------------------------------------------
    Write-Section '設定檔套件清單'
    $merge = Merge-SettingsPackages -PiHomePath $pi -Packages $packageItems
    if ($merge.Changed) {
        Write-OkLine ("已補上套件宣告：{0}" -f ($merge.Added -join ', '))
    } else {
        Write-OkLine 'settings.json 已含必要套件，未變更'
    }

    Save-LedgerEntries -PiHomePath $pi -Entries $ledger

    # --- 選用：安裝套件 -----------------------------------------------------
    $needInstall = @($packageActions | Where-Object { $_.NeedInstall })
    if ($needInstall.Count -gt 0) {
        Write-Section '套件安裝'
        if ($InstallPackages) {
            foreach ($pkg in $needInstall) {
                Write-InfoLine ("執行 pi install {0}" -f $pkg.Pin)
                & pi install $pkg.Pin
                if ($LASTEXITCODE -ne 0) {
                    Write-WarnLine ("pi install 失敗（exit {0}）：{1}" -f $LASTEXITCODE, $pkg.Pin)
                }
            }
        } else {
            Write-WarnLine '有套件版本不符。未自動安裝（未指定 -InstallPackages）。'
            foreach ($pkg in $needInstall) {
                Write-InfoLine ("  pi install {0}" -f $pkg.Pin)
            }
        }
    }

    Write-Section '完成'
    Write-InfoLine ("已寫入 {0} 個檔案" -f $applied)
    Write-InfoLine '下一步：pwsh -File scripts/verify.ps1'
    Write-InfoLine '若模式未生效：重新啟動 Pi，或於 Pi 內執行 /reload。'
    exit 0
} catch {
    Write-Host ''
    Write-Host "錯誤：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
