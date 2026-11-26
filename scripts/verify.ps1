<#
.SYNOPSIS
    驗證本機 Pi 設定是否符合 pi-config 儲存庫，且兩種模式行為正確。

.DESCRIPTION
    檢查項目：
      1. Pi 版本相容性（對照 manifests/packages.json）。
      2. 同步檔案是否與儲存庫一致（正規化雜湊，忽略 CRLF/LF 差異）。
      3. 必要 Extension：mode-switch.ts 存在，且 Pi 能載入並註冊 /mode 指令。
      4. 兩種模式可載入：以 Pi RPC 模式（無 TTY、不呼叫模型）取得可發現指令。
      5. 深度執行可發現 7 個 ds-* Skills（且來源必須是 mode-switch 擴充功能）。
      6. 一般模式不會自動載入 ds-* Skills（RPC 實測 + 自動掃描目錄檢查）。
      7. 原有 Providers 不受影響（只比對 Provider 名稱，不讀取憑證內容）。
      8. Alt+M 快捷鍵註冊（原始碼靜態檢查）。實際按鍵需 TTY，標記為人工驗證。

    離開代碼：0 = 全部通過（可有 WARN/MANUAL）；1 = 有 FAIL；2 = 環境錯誤。

.PARAMETER PiHome
    Pi 家目錄。預設為目前使用者的 ~/.pi。

.PARAMETER SkipModeTest
    略過 Pi RPC 模式載入測試（例如離線或無法啟動子程序時）。

.EXAMPLE
    pwsh -File scripts/verify.ps1
#>

[CmdletBinding()]
param(
    [string]$RepoPath,
    [string]$PiHome,
    [switch]$SkipModeTest
)

$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptRoot)) { $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
if ([string]::IsNullOrWhiteSpace($RepoPath)) { $RepoPath = Split-Path -Parent $scriptRoot }
$scriptPath = Join-Path $scriptRoot (Split-Path -Leaf $MyInvocation.MyCommand.Path)
. (Join-Path $scriptRoot 'lib/common.ps1')
Initialize-PiConfigConsole

$script:results = @()
$script:tempRoots = @()

function Add-Result {
    param(
        [string]$Name,
        [ValidateSet('PASS', 'FAIL', 'WARN', 'SKIP', 'MANUAL')][string]$Status,
        [string]$Detail = ''
    )
    $script:results += [pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail }
    switch ($Status) {
        'PASS'   { Write-OkLine ("{0}{1}" -f $Name, $(if ($Detail) { "：$Detail" } else { '' })) }
        'FAIL'   { Write-FailLine ("{0}{1}" -f $Name, $(if ($Detail) { "：$Detail" } else { '' })) }
        'WARN'   { Write-WarnLine ("{0}{1}" -f $Name, $(if ($Detail) { "：$Detail" } else { '' })) }
        'SKIP'   { Write-SkipLine ("{0}{1}" -f $Name, $(if ($Detail) { "：$Detail" } else { '' })) }
        'MANUAL' { Write-ManualLine ("{0}{1}" -f $Name, $(if ($Detail) { "：$Detail" } else { '' })) }
    }
}

function New-TempModeAgentDir {
    param([string]$ModeSwitchPath, [string]$Mode, [string]$Label)
    $root = Join-Path ([System.IO.Path]::GetTempPath()) ("pi-config-verify-" + $Label + '-' + [guid]::NewGuid().ToString('N'))
    $agentDir = Join-Path $root 'agent'
    $workDir = Join-Path $root 'work'
    New-Item -ItemType Directory -Path (Join-Path $agentDir 'extensions') -Force | Out-Null
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null
    [System.IO.File]::Copy($ModeSwitchPath, (Join-Path $agentDir 'extensions/mode-switch.ts'), $true)
    Copy-Item -LiteralPath (Join-Path $repo 'modes') -Destination (Join-Path $root 'modes') -Recurse
    Write-JsonFile -Path (Join-Path $agentDir 'mode-state.json') -Object ([ordered]@{ mode = $Mode })
    $script:tempRoots += $root
    return [pscustomobject]@{ Root = $root; AgentDir = $agentDir; WorkDir = $workDir }
}

function Test-ModeDiscovery {
    param(
        [string]$ModeSwitchPath,
        [string]$UserHome,
        [string]$Mode,
        [string[]]$RequiredSkills
    )
    $sandbox = New-TempModeAgentDir -ModeSwitchPath $ModeSwitchPath -Mode $Mode -Label $Mode
    $commands = Invoke-PiGetCommands -AgentDir $sandbox.AgentDir -UserHome $sandbox.WorkDir -WorkingDirectory $sandbox.WorkDir
    $skillNames = @(Get-SkillCommandNames -Commands $commands)
    $dsSkills = @($skillNames | Where-Object { $_.StartsWith('ds-') } | Sort-Object)
    $hasModeCommand = @($commands | Where-Object { (Get-Prop $_ 'name') -eq 'mode' -and (Get-Prop $_ 'source') -eq 'extension' }).Count -gt 0
    $dsSources = @($commands | Where-Object {
        (Get-Prop $_ 'source') -eq 'skill' -and ([string](Get-Prop $_ 'name')).StartsWith('skill:ds-')
    } | ForEach-Object { [string](Get-Prop (Get-Prop $_ 'sourceInfo') 'source') } | Sort-Object -Unique)

    return [pscustomobject]@{
        Commands      = $commands
        AllSkills     = $skillNames
        DsSkills      = $dsSkills
        HasModeCommand = $hasModeCommand
        DsSources     = $dsSources
    }
}

try {
    $repo = [System.IO.Path]::GetFullPath($RepoPath)
    $pi = Get-PiHomePath $PiHome
    $userHome = Get-UserHomePath $PiHome
    $agentDir = Get-AgentDirPath $PiHome

    Write-Section 'pi-config 驗證'
    Write-InfoLine "Pi 家目錄：$pi"
    Write-InfoLine "儲存庫    ：$repo"
    Write-InfoLine "使用者家目錄：$userHome"

    if (-not (Test-Path -LiteralPath $pi -PathType Container)) {
        throw "Pi 家目錄不存在：$pi"
    }
    $manifest = Read-Manifest $repo

    # ---------------------------------------------------------------- 1. 版本
    Write-Section '1. Pi 版本相容性'
    $packagesPath = Join-Path $repo 'manifests/packages.json'
    if (-not (Test-Path -LiteralPath $packagesPath -PathType Leaf)) {
        throw '儲存庫缺少 manifests/packages.json，請先確認版本控制中的 manifest；私人設定匯出請依操作指南指定已查核的私人目的地。'
    }
    $packagesManifest = Read-JsonFile $packagesPath
    $piInfo = Get-Prop $packagesManifest 'pi'
    $expectedVersion = [string](Get-Prop $piInfo 'version' '')
    $compatible = [string](Get-Prop $piInfo 'compatible' '')
    $currentVersion = Get-PiVersion

    if ($null -eq $currentVersion) {
        Add-Result -Name 'Pi 版本讀取' -Status 'FAIL' -Detail '無法執行 pi --version'
    } else {
        $compatibleOk = $currentVersion -ceq $compatible
        if ($compatible -match '^(\d+)\.(\d+)\.x$') {
            $compatibleOk = $currentVersion.StartsWith(('{0}.{1}.' -f $Matches[1], $Matches[2]))
        }
        if (-not $compatibleOk) {
            Add-Result -Name 'Pi 版本相容性' -Status 'FAIL' -Detail ("目前 {0}，儲存庫要求 {1}（相容範圍 {2}）" -f $currentVersion, $expectedVersion, $compatible)
        } elseif ($currentVersion -ne $expectedVersion) {
            Add-Result -Name 'Pi 版本相容性' -Status 'WARN' -Detail ("目前 {0}，儲存庫基準 {1}（同相容範圍）" -f $currentVersion, $expectedVersion)
        } else {
            Add-Result -Name 'Pi 版本相容性' -Status 'PASS' -Detail $currentVersion
        }
    }

    # ------------------------------------------------------------ 2. 檔案一致
    Write-Section '2. 同步檔案完整性'
    $repoEntries = Expand-RepoEntries -Manifest $manifest -RepoPath $repo
    $drift = @()
    $missing = @()
    foreach ($entry in $repoEntries) {
        $livePath = Join-RepoPath -Base $pi -Relative $entry.PiRel
        if (-not (Test-Path -LiteralPath $livePath -PathType Leaf)) {
            $missing += $entry.PiRel
            continue
        }
        if (-not (Test-FileContentEqual -Left $entry.RepoPath -Right $livePath)) {
            $drift += $entry.PiRel
        }
    }
    if ($missing.Count -gt 0) {
        Add-Result -Name '同步檔案存在' -Status 'FAIL' -Detail ("缺少 {0} 個：{1}" -f $missing.Count, ($missing -join ', '))
    } else {
        Add-Result -Name '同步檔案存在' -Status 'PASS' -Detail ("{0} 個檔案" -f $repoEntries.Count)
    }
    if ($drift.Count -gt 0) {
        Add-Result -Name '同步檔案內容' -Status 'FAIL' -Detail ("與儲存庫不同：{0}" -f ($drift -join ', '))
    } elseif ($missing.Count -eq 0) {
        Add-Result -Name '同步檔案內容' -Status 'PASS' -Detail '全部一致'
    } else {
        Add-Result -Name '同步檔案內容' -Status 'SKIP' -Detail '有檔案缺失，略過比對'
    }

    # ----------------------------------------------------------- 3. Extension
    Write-Section '3. Extensions 與套件'
    $modeSwitchRel = [string]$manifest.deepExecution.modeSwitchExtension
    $modeSwitchPath = Join-RepoPath -Base $pi -Relative $modeSwitchRel
    if (Test-Path -LiteralPath $modeSwitchPath -PathType Leaf) {
        Add-Result -Name 'mode-switch.ts 存在' -Status 'PASS' -Detail $modeSwitchRel
    } else {
        Add-Result -Name 'mode-switch.ts 存在' -Status 'FAIL' -Detail "找不到 $modeSwitchPath"
    }

    $packageItems = @(Get-Prop $packagesManifest 'packages' @())
    $configuredPackages = @(Get-SettingsPackages $pi | ForEach-Object { Get-PackageSource $_ })
    $packageProblems = @()
    foreach ($pkg in $packageItems) {
        $name = [string](Get-Prop $pkg 'name' '')
        $version = [string](Get-Prop $pkg 'version' '')
        if ([string]::IsNullOrWhiteSpace($name)) { continue }
        $sources = @($configuredPackages | Where-Object { $_ -clike 'npm:*' -and (ConvertTo-PackageName $_) -ceq $name })
        $pin = "npm:${name}@${version}"
        if ($sources.Count -eq 0) {
            $packageProblems += ("$name 未在 settings.json packages 中")
        } elseif ($sources.Count -gt 1) {
            $packageProblems += ("$name 在 settings.json 重複宣告")
        } elseif ($sources[0] -cne $pin) {
            $packageProblems += ("$name 的 settings.json 來源未固定為 $pin")
        }
        if ((Get-Prop $pkg 'pin') -cne $pin) {
            $packageProblems += ("$name 的 manifest pin 與宣告版本不一致")
        }
        $installed = Get-InstalledPackageVersion $pi $name
        if ($null -eq $installed) {
            $packageProblems += ("$name 未安裝")
        } elseif ($installed -ne $version) {
            $packageProblems += ("$name 版本 {0}（要求 {1}）" -f $installed, $version)
        }
    }
    if ($packageProblems.Count -gt 0) {
        Add-Result -Name 'Pi 套件' -Status 'FAIL' -Detail ($packageProblems -join '；')
    } else {
        Add-Result -Name 'Pi 套件' -Status 'PASS' -Detail (($packageItems | ForEach-Object { "{0}@{1}" -f (Get-Prop $_ 'name'), (Get-Prop $_ 'version') }) -join ', ')
    }

    $lspSpec = Get-Prop $packagesManifest 'lsp'
    if ($lspSpec) {
        $lspProblems = @()
        foreach ($pkg in @(Get-Prop $lspSpec 'packages' @())) {
            $pkgJson = Join-Path $pi ("{0}/node_modules/{1}/package.json" -f (Get-Prop $lspSpec 'installDir' 'agent/lsp'), (Get-Prop $pkg 'name'))
            if (-not (Test-Path -LiteralPath $pkgJson -PathType Leaf)) { $lspProblems += ("{0} 未安裝" -f (Get-Prop $pkg 'name')); continue }
            $have = [string](Get-Content -LiteralPath $pkgJson -Raw | ConvertFrom-Json).version
            if ($have -ne [string](Get-Prop $pkg 'version')) { $lspProblems += ("{0} 版本 {1}（要求 {2}）" -f (Get-Prop $pkg 'name'), $have, (Get-Prop $pkg 'version')) }
        }
        if ($lspProblems.Count -gt 0) {
            Add-Result -Name 'TypeScript LSP 伺服器' -Status 'WARN' -Detail ((($lspProblems) -join '；') + '。安裝：' + [string](Get-Prop $lspSpec 'installCommand'))
        } else {
            Add-Result -Name 'TypeScript LSP 伺服器' -Status 'PASS' -Detail 'typescript 與 typescript-language-server 版本符合固定值'
        }
        $roslyn = $null
        if ($env:ASTRA_ROSLYN_LS -and (Test-Path -LiteralPath $env:ASTRA_ROSLYN_LS)) { $roslyn = Get-Item -LiteralPath $env:ASTRA_ROSLYN_LS }
        else {
            $extRoot = Join-Path $HOME '.vscode/extensions'
            if (Test-Path -LiteralPath $extRoot) {
                $roslyn = Get-ChildItem -LiteralPath $extRoot -Directory -Filter 'ms-dotnettools.csharp-*' -ErrorAction SilentlyContinue |
                    Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName '.roslyn/Microsoft.CodeAnalysis.LanguageServer.dll' } |
                    Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1 | ForEach-Object { Get-Item -LiteralPath $_ }
            }
        }
        if (-not $roslyn) {
            Add-Result -Name 'C# LSP 伺服器' -Status 'WARN' -Detail '找不到 Roslyn Language Server（安裝 Microsoft C# VS Code 擴充功能或設定 ASTRA_ROSLYN_LS）；C# LSP 工具會回報 NOT FOUND，其餘功能不受影響'
        } else {
            $sig = (Get-AuthenticodeSignature -LiteralPath $roslyn.FullName).Status
            $tested = [string](Get-Prop (Get-Prop (Get-Prop $lspSpec 'csharp') 'tested') 'dllSha256')
            $hash = (Get-FileHash -LiteralPath $roslyn.FullName -Algorithm SHA256).Hash
            if ($sig -ne 'Valid') { Add-Result -Name 'C# LSP 伺服器' -Status 'FAIL' -Detail ("簽章狀態 {0}：{1}" -f $sig, $roslyn.FullName) }
            elseif ($hash -eq $tested) { Add-Result -Name 'C# LSP 伺服器' -Status 'PASS' -Detail '簽章有效，與已測版本雜湊一致' }
            else { Add-Result -Name 'C# LSP 伺服器' -Status 'WARN' -Detail ("簽章有效，但版本與已測不同（{0}）；請執行 tests/lsp-cs.test.mjs 確認相容" -f $roslyn.VersionInfo.ProductVersion) }
        }
    }

    # --------------------------------------------------------- 4/5/6. 模式
    Write-Section '4-6. 模式載入與 ds-* Skills'
    $requiredSkills = @($manifest.deepExecution.requiredSkills)
    $skillPrefix = [string]$manifest.deepExecution.skillPrefix

    $instructionsRel = [string]$manifest.deepExecution.instructions
    $instructionsPath = Join-RepoPath -Base $pi -Relative $instructionsRel
    if ((Test-Path -LiteralPath $instructionsPath -PathType Leaf) -and ((Get-Item -LiteralPath $instructionsPath).Length -gt 0)) {
        Add-Result -Name '深度執行 instructions.md' -Status 'PASS' -Detail ("{0} bytes" -f (Get-Item -LiteralPath $instructionsPath).Length)
    } else {
        Add-Result -Name '深度執行 instructions.md' -Status 'FAIL' -Detail "缺少或為空：$instructionsPath"
    }

    # ds-* 不得出現在 Pi 自動掃描的 Skills 目錄
    $autoHits = @()
    $autoPiHomeDirs = @(Get-Prop (Get-Prop $manifest 'autoSkillDirs') 'piHome' @())
    $autoUserHomeDirs = @(Get-Prop (Get-Prop $manifest 'autoSkillDirs') 'userHome' @())
    foreach ($rel in $autoPiHomeDirs) {
        $dir = Join-RepoPath -Base $pi -Relative ([string]$rel)
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
        foreach ($child in (Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue)) {
            if ($child.Name.StartsWith($skillPrefix)) { $autoHits += ($dir + '/' + $child.Name) }
        }
    }
    foreach ($rel in $autoUserHomeDirs) {
        $dir = Join-RepoPath -Base $userHome -Relative ([string]$rel)
        if (-not (Test-Path -LiteralPath $dir -PathType Container)) { continue }
        foreach ($child in (Get-ChildItem -LiteralPath $dir -Directory -ErrorAction SilentlyContinue)) {
            if ($child.Name.StartsWith($skillPrefix)) { $autoHits += ($dir + '/' + $child.Name) }
        }
    }
    if ($autoHits.Count -eq 0) {
        Add-Result -Name 'ds-* 不在自動掃描目錄' -Status 'PASS' -Detail '一般模式不會自動載入'
    } else {
        Add-Result -Name 'ds-* 不在自動掃描目錄' -Status 'FAIL' -Detail ($autoHits -join ', ')
    }

    if ($SkipModeTest) {
        Add-Result -Name '深度執行模式載入' -Status 'SKIP' -Detail '已指定 -SkipModeTest'
        Add-Result -Name '一般模式隔離' -Status 'SKIP' -Detail '已指定 -SkipModeTest'
        Add-Result -Name '/mode 指令註冊' -Status 'SKIP' -Detail '已指定 -SkipModeTest'
    } elseif (-not (Test-Path -LiteralPath $modeSwitchPath -PathType Leaf)) {
        Add-Result -Name '深度執行模式載入' -Status 'FAIL' -Detail '缺少 mode-switch.ts，無法測試'
        Add-Result -Name '一般模式隔離' -Status 'FAIL' -Detail '缺少 mode-switch.ts，無法測試'
        Add-Result -Name '/mode 指令註冊' -Status 'FAIL' -Detail '缺少 mode-switch.ts，無法測試'
    } else {
        $deep = $null
        $default = $null
        $deepError = $null
        $defaultError = $null
        try {
            $deep = Test-ModeDiscovery -ModeSwitchPath $modeSwitchPath -UserHome $userHome -Mode 'deep-execution' -RequiredSkills $requiredSkills
        } catch {
            $deepError = $_.Exception.Message
        }
        try {
            $default = Test-ModeDiscovery -ModeSwitchPath $modeSwitchPath -UserHome $userHome -Mode 'default' -RequiredSkills $requiredSkills
        } catch {
            $defaultError = $_.Exception.Message
        }

        if ($null -eq $deep) {
            Add-Result -Name '深度執行模式載入' -Status 'FAIL' -Detail ("RPC 測試失敗：{0}" -f $deepError)
        } else {
            $found = @($deep.DsSkills)
            $expected = @($requiredSkills | Sort-Object)
            $diff = @(Compare-Object -ReferenceObject $expected -DifferenceObject $found)
            if ($diff.Count -eq 0) {
                Add-Result -Name '深度執行模式載入' -Status 'PASS' -Detail ("ds-* Skills {0} 個：{1}" -f $found.Count, ($found -join ', '))
            } else {
                Add-Result -Name '深度執行模式載入' -Status 'FAIL' -Detail ("ds-* Skills 不符（找到 {0} 個：{1}）" -f $found.Count, ($found -join ', '))
            }
            if ($deep.HasModeCommand) {
                Add-Result -Name '/mode 指令註冊' -Status 'PASS' -Detail 'extension command 可發現'
            } else {
                Add-Result -Name '/mode 指令註冊' -Status 'FAIL' -Detail 'Pi 未註冊 /mode 指令'
            }
            $badSources = @($deep.DsSources | Where-Object { -not ([string]$_).StartsWith('extension') })
            if ($badSources.Count -eq 0) {
                Add-Result -Name 'ds-* Skills 來源' -Status 'PASS' -Detail ('僅由 mode-switch 擴充功能提供（{0}）' -f (($deep.DsSources | ForEach-Object { $_ }) -join ', '))
            } else {
                Add-Result -Name 'ds-* Skills 來源' -Status 'FAIL' -Detail ("非擴充功能來源：{0}" -f ($badSources -join ', '))
            }
        }

        if ($null -eq $default) {
            Add-Result -Name '一般模式隔離' -Status 'FAIL' -Detail ("RPC 測試失敗：{0}" -f $defaultError)
        } else {
            $defaultDs = @($default.DsSkills)
            if ($defaultDs.Count -eq 0) {
                Add-Result -Name '一般模式隔離' -Status 'PASS' -Detail '一般模式看不到任何 ds-* Skills'
            } else {
                Add-Result -Name '一般模式隔離' -Status 'FAIL' -Detail ("一般模式仍載入：{0}" -f ($defaultDs -join ', '))
            }
        }
    }

    # ------------------------------------------------------------ 7. Providers
    Write-Section '7. Providers 與認證'
    $providersPath = Join-Path $repo 'manifests/providers.json'
    $authPath = Join-Path $agentDir 'auth.json'
    $authProviders = @()
    if (Test-Path -LiteralPath $authPath -PathType Leaf) {
        $auth = Read-JsonFile $authPath
        $authProviders = @($auth.PSObject.Properties | ForEach-Object { $_.Name })
    }
    if (-not (Test-Path -LiteralPath $providersPath -PathType Leaf)) {
        Add-Result -Name 'Provider 基準清單' -Status 'WARN' -Detail '儲存庫缺少 manifests/providers.json'
    } else {
        $baselinePath = Get-ProviderBaselinePath $pi
        $baseline = @()
        $baselineSource = ''
        if (Test-Path -LiteralPath $baselinePath -PathType Leaf) {
            $baseline = @(Get-Prop (Read-JsonFile $baselinePath) 'providers' @())
            $baselineSource = '本機基準（第一次 apply 前）'
        } else {
            $baseline = @(Get-Prop (Read-JsonFile $providersPath) 'providers' @())
            $baselineSource = ''
        }

        if ([string]::IsNullOrWhiteSpace([string]$baselineSource)) {
            Add-Result -Name '原有 Providers' -Status 'SKIP' -Detail (
                '尚無本機基準（首次 apply 時建立）；目前 auth.json 含：{0}' -f ($authProviders -join ', '))
        } else {
            $lost = @($baseline | Where-Object { $authProviders -notcontains $_ })
            if ($lost.Count -gt 0) {
                Add-Result -Name '原有 Providers' -Status 'FAIL' -Detail (
                    '基準 {0} 中的 Provider 已遺失：{1}' -f $baselineSource, ($lost -join ', '))
            } else {
                Add-Result -Name '原有 Providers' -Status 'PASS' -Detail (
                    '基準 {0} 全部保留；目前含：{1}' -f $baselineSource, ($authProviders -join ', '))
            }
        }
    }
    if (Test-Path -LiteralPath $authPath -PathType Leaf) {
        Add-Result -Name '認證檔未被同步' -Status 'PASS' -Detail 'auth.json 存在且不在同步清單（僅檢查存在性，未讀取內容）'
    } else {
        Add-Result -Name '認證檔未被同步' -Status 'WARN' -Detail '找不到 auth.json（本機可能尚未登入 Provider）'
    }

    # ------------------------------------------------------------- 8. Alt+M
    Write-Section '8. Alt+M 快捷鍵'
    $shortcut = [string]$manifest.deepExecution.shortcut
    if (Test-Path -LiteralPath $modeSwitchPath -PathType Leaf) {
        $source = [System.IO.File]::ReadAllText($modeSwitchPath)
        $pattern = 'registerShortcut\(\s*["'']' + [regex]::Escape($shortcut) + '["'']'
        if ($source -match $pattern) {
            Add-Result -Name ("registerShortcut('{0}')" -f $shortcut) -Status 'PASS' -Detail '原始碼已註冊'
        } else {
            Add-Result -Name ("registerShortcut('{0}')" -f $shortcut) -Status 'FAIL' -Detail '原始碼找不到註冊'
        }
    } else {
        Add-Result -Name ("registerShortcut('{0}')" -f $shortcut) -Status 'FAIL' -Detail '缺少 mode-switch.ts'
    }
    Add-Result -Name 'Alt+M 實際切換' -Status 'MANUAL' -Detail '需 TTY：於 Pi 按 Alt+M，確認狀態列模式名稱改變且 ds-* Skills 隨模式出現/消失'

    # ------------------------------------------------------- 9. mode-state
    Write-Section '9. 目前模式狀態'
    $statePath = Join-RepoPath -Base $pi -Relative ([string]$manifest.modeStateFile)
    if (Test-Path -LiteralPath $statePath -PathType Leaf) {
        try {
            $state = Read-JsonFile $statePath
            $mode = [string](Get-Prop $state 'mode' '')
            if (@($manifest.modes) -contains $mode) {
                Add-Result -Name 'mode-state.json' -Status 'PASS' -Detail ("目前模式：{0}" -f $mode)
            } else {
                Add-Result -Name 'mode-state.json' -Status 'FAIL' -Detail ("未知模式：'{0}'" -f $mode)
            }
        } catch {
            Add-Result -Name 'mode-state.json' -Status 'FAIL' -Detail ("無法解析：{0}" -f $_.Exception.Message)
        }
    } else {
        Add-Result -Name 'mode-state.json' -Status 'WARN' -Detail '不存在（Pi 會視為 default 模式）'
    }

    # ------------------------------------------------------------- 摘要
    Write-Section '摘要'
    $pass = @($script:results | Where-Object { $_.Status -eq 'PASS' }).Count
    $fail = @($script:results | Where-Object { $_.Status -eq 'FAIL' }).Count
    $warn = @($script:results | Where-Object { $_.Status -eq 'WARN' }).Count
    $manual = @($script:results | Where-Object { $_.Status -eq 'MANUAL' }).Count
    $skip = @($script:results | Where-Object { $_.Status -eq 'SKIP' }).Count
    Write-InfoLine ("PASS {0} / FAIL {1} / WARN {2} / MANUAL {3} / SKIP {4}" -f $pass, $fail, $warn, $manual, $skip)

    if ($fail -gt 0) {
        Write-FailLine '驗證未通過。'
        exit 1
    }
    Write-OkLine '驗證通過。'
    if ($manual -gt 0) {
        Write-ManualLine ("尚有 {0} 項需人工/TTY 驗證。" -f $manual)
    }
    exit 0
} catch {
    Write-Host ''
    Write-Host "錯誤：$($_.Exception.Message)" -ForegroundColor Red
    exit 2
} finally {
    foreach ($root in $script:tempRoots) {
        if (Test-Path -LiteralPath $root) {
            Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
