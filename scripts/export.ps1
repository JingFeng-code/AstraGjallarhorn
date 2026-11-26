<#
.SYNOPSIS
    將本機 Pi 設定匯出到 pi-config 儲存庫工作目錄。

.DESCRIPTION
    1. 讀取 manifests/pi-config.json 的同步清單。
    2. 只匯出白名單檔案及 Provider 名稱，不複製憑證、Session、快取或機器狀態。
    3. 拒絕跟隨符號連結 / Junction。
    4. 寫入前掃描敏感資訊與硬編碼使用者路徑，發現即中止（不寫任何檔案）。
    5. 顯示檔案清單與逐檔 Diff。
    6. 產生 manifests/packages.json 與 manifests/providers.json（只含套件名稱/版本、Provider 名稱，不含憑證）。
    7. 預設預覽；實際寫入需要 -Apply、-RepoPath 及確認私人 GitHub 目的地。
    8. 只執行唯讀 Git/gh 查核，不 add / commit / push。

.PARAMETER RepoPath
    預覽可省略；寫入必須指定獨立私人 GitHub repository 的工作樹根目錄。

.PARAMETER PiHome
    Pi 家目錄。預設為目前使用者的 ~/.pi。僅供還原演練或測試使用。

.PARAMETER DryRun
    預設模式；不寫入目標工作樹（暫存 manifest 於結束時清除）。

.PARAMETER Apply
    實際匯出；須明確指定 RepoPath，並透過已認證的 gh 確認私人目的地。

.PARAMETER NoDiff
    不顯示 Diff，只看檔案清單。

.PARAMETER Prune
    刪除儲存庫中已不存在的同步檔案（預設只提示）。

.EXAMPLE
    pwsh -File scripts/export.ps1 -DryRun

.EXAMPLE
    pwsh -File scripts/export.ps1 -RepoPath <private-repo> -Apply
#>

[CmdletBinding()]
param(
    [string]$RepoPath,
    [string]$PiHome,
    [switch]$DryRun,
    [switch]$Apply,
    [switch]$NoDiff,
    [switch]$Prune
)

$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($scriptRoot)) { $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path }
$explicitRepoPath = $PSBoundParameters.ContainsKey('RepoPath') -and -not [string]::IsNullOrWhiteSpace($RepoPath)
if (-not $explicitRepoPath) { $RepoPath = Split-Path -Parent $scriptRoot }
$scriptPath = Join-Path $scriptRoot (Split-Path -Leaf $MyInvocation.MyCommand.Path)
. (Join-Path $scriptRoot 'lib/common.ps1')
Initialize-PiConfigConsole

$exitCode = 0
$staging = $null

# Only a single GitHub.com origin with matching effective fetch/push
# destinations can receive private exports. No offline visibility override.
function Get-ExportGitHubSlug {
    param([string]$Url)
    if ($Url -match '\A(?:https://github\.com/|git@github\.com:|ssh://git@github\.com/)([A-Za-z0-9-]+)/([A-Za-z0-9_.-]+)\z') {
        $owner = $Matches[1]
        $name = $Matches[2] -ireplace '\.git$', ''
        if ($name -and $name -ne '.' -and $name -ne '..') { return "$owner/$name" }
    }
    throw 'Export destination must be a supported GitHub.com URL without embedded credentials.'
}

function Assert-PrivateExportDestination {
    param([string]$Path)
    $git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    $gh = Get-Command gh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $git -or -not $gh) { throw 'Export requires git and authenticated gh; destination visibility is unknown.' }
    foreach ($name in @('GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_CONFIG','GIT_CONFIG_COUNT','GIT_CONFIG_PARAMETERS')) {
        if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($name))) {
            throw 'Git repository/config overrides are not supported for private export.'
        }
    }
    $gitRoot = @(& $git.Source -C $Path rev-parse --show-toplevel 2>$null)
    if ($LASTEXITCODE -ne 0 -or $gitRoot.Count -ne 1) { throw 'Export destination is not a Git working tree.' }
    $comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
    if (-not [string]::Equals([IO.Path]::GetFullPath($gitRoot[0]).TrimEnd('\','/'), [IO.Path]::GetFullPath($Path).TrimEnd('\','/'), $comparison)) {
        throw 'RepoPath must identify the Git working tree root.'
    }
    $remotes = @(& $git.Source -C $Path remote 2>$null)
    if ($LASTEXITCODE -ne 0 -or $remotes.Count -ne 1 -or $remotes[0] -cne 'origin') {
        throw 'Export requires exactly one remote named origin.'
    }
    $fetch = @(& $git.Source -C $Path remote get-url --all origin 2>$null)
    if ($LASTEXITCODE -ne 0 -or $fetch.Count -ne 1) { throw 'Cannot establish a unique origin fetch URL.' }
    $push = @(& $git.Source -C $Path remote get-url --push --all origin 2>$null)
    if ($LASTEXITCODE -ne 0 -or $push.Count -ne 1) { throw 'Cannot establish a unique origin push URL.' }
    $slug = Get-ExportGitHubSlug $fetch[0]
    $pushSlug = Get-ExportGitHubSlug $push[0]
    if ($slug -ine $pushSlug) { throw 'Fetch and push destinations differ; refusing private export.' }
    if ($slug -ieq 'JingFeng-code/AstraGjallarhorn') { throw 'The public AstraGjallarhorn upstream is never a private export destination.' }

    $json = @(& $gh.Source api --hostname github.com --method GET "repos/$slug" 2>$null)
    if ($LASTEXITCODE -ne 0 -or $json.Count -eq 0) { throw 'GitHub visibility lookup failed; no export is permitted.' }
    try { $info = ($json -join "\n") | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'GitHub visibility response is invalid; no export is permitted.' }
    $private = Get-Prop $info 'private'
    if ($private -isnot [bool] -or -not $private -or (Get-Prop $info 'visibility') -cne 'private' -or (Get-Prop $info 'full_name') -ine $slug) {
        throw 'Destination is public, internal, mismatched or unknown; only confirmed private repositories are accepted.'
    }
    return $slug
}

function Assert-ExportDestinationPath {
    param([string]$Root, [string]$Target)
    $base = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
    $full = [IO.Path]::GetFullPath($Target)
    $comparison = if ($IsWindows) { [StringComparison]::OrdinalIgnoreCase } else { [StringComparison]::Ordinal }
    if (-not $full.StartsWith($base + [IO.Path]::DirectorySeparatorChar, $comparison)) { throw 'Export path escapes the destination root.' }
    $current = $full
    while ($current) {
        if (Test-IsReparsePoint $current) { throw 'Export destination includes a symbolic link or junction.' }
        $parent = [IO.Path]::GetDirectoryName($current)
        if (-not $parent -or $parent -eq $current) { break }
        $current = $parent
    }
}

function Show-Diff {
    param([string]$OldPath, [string]$NewPath, [int]$MaxLines = 60)
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-InfoLine '（未安裝 git，略過 Diff 顯示）'
        return
    }
    # Windows PowerShell 5.1 會把原生程式的 stderr 當成錯誤；
    # 且 git 對 LF/CRLF 會印 warning，因此在呼叫期間暫時放寬 ErrorActionPreference。
    $previousEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $diff = & git --no-pager diff --no-index --unified=2 -- $OldPath $NewPath 2>$null
    } catch {
        $diff = $null
    } finally {
        $ErrorActionPreference = $previousEap
    }
    if ($null -eq $diff) { return }
    $lines = @($diff)
    foreach ($line in ($lines | Select-Object -First $MaxLines)) {
        if ($line -match '^\+' -and $line -notmatch '^\+\+\+') {
            Write-Host "      $line" -ForegroundColor Green
        } elseif ($line -match '^-' -and $line -notmatch '^---') {
            Write-Host "      $line" -ForegroundColor Red
        } elseif ($line -match '^@@') {
            Write-Host "      $line" -ForegroundColor DarkGray
        }
    }
    if ($lines.Count -gt $MaxLines) {
        Write-Host ("      ...（其餘 {0} 行已截斷）" -f ($lines.Count - $MaxLines)) -ForegroundColor DarkGray
    }
}

function Get-GeneratedPackagesJson {
    param($Manifest, [string]$PiHome)

    $specs = Get-SettingsPackages $PiHome
    $packages = @()
    $unknown = @()
    foreach ($spec in $specs) {
        $text = Get-PackageSource $spec
        if (-not $text.StartsWith('npm:')) {
            $unknown += $text
            continue
        }
        $name = ConvertTo-PackageName $text
        $version = Get-InstalledPackageVersion $PiHome $name
        if (@($packages | Where-Object { $_.name -ceq $name }).Count -gt 0) {
            throw "settings.json 重複宣告套件：$name"
        }
        if ($version -notmatch '^\d+\.\d+\.\d+(?:[-+][0-9a-z.+-]+)?$') {
            throw "無法確認套件的安裝版本：$name"
        }
        $pin = "npm:${name}@${version}"
        if ($text -cne "npm:$name" -and $text -cne $pin) {
            throw "套件來源與安裝版本不一致：$name"
        }
        $packages += ([ordered]@{
            name    = $name
            version = $version
            pin     = $pin
            source  = $text
        })
    }

    $piVersion = Get-PiVersion
    if ($piVersion -notmatch '^\d+\.\d+\.\d+$') { throw '無法確認 Pi 版本。' }

    $result = [ordered]@{
        schemaVersion = 1
        pi            = [ordered]@{
            package    = '@earendil-works/pi-coding-agent'
            version    = $piVersion
            compatible = $piVersion
        }
        packages      = @($packages)
        excluded      = @(
            'pi-profile-switch（Windows 相容性問題，已改用 extensions/mode-switch.ts，不安裝）'
        )
    }
    if ($unknown.Count -gt 0) {
        $result['unmanagedSources'] = @($unknown)
    }
    return (ConvertTo-StableJson -Value $result)
}

function Get-GeneratedProvidersJson {
    param([string]$PiHome)

    $authPath = Join-Path (Get-AgentDirPath $PiHome) 'auth.json'
    $names = @()
    if (Test-Path -LiteralPath $authPath -PathType Leaf) {
        $auth = Read-JsonFile $authPath
        $names = @($auth.PSObject.Properties | ForEach-Object { $_.Name } | Sort-Object)
    }
    $result = [ordered]@{
        schemaVersion = 1
        note          = '僅記錄 Provider 名稱，用於驗證認證未被同步流程破壞；不含任何憑證內容。'
        providers     = @($names)
    }
    return (ConvertTo-StableJson -Value $result)
}

try {
    if ($Apply -and $DryRun) { throw '-Apply and -DryRun are mutually exclusive.' }
    if ($Apply -and -not $explicitRepoPath) { throw '-Apply requires explicit -RepoPath to a private GitHub repository.' }
    $repo = [System.IO.Path]::GetFullPath($RepoPath)
    $verifiedSlug = $null
    if ($Apply) {
        $verifiedSlug = Assert-PrivateExportDestination $repo
        Assert-ExportDestinationPath -Root $repo -Target (Join-Path $repo 'manifests/pi-config.json')
    }
    $pi = Get-PiHomePath $PiHome
    $userHome = Get-UserHomePath $PiHome
    $manifest = Read-Manifest $repo

    Write-Section 'pi-config 匯出'
    Write-InfoLine "Pi 家目錄：$pi"
    Write-InfoLine "儲存庫    ：$repo"
    Write-InfoLine "Pi 版本   ：$(if ($null -ne (Get-PiVersion)) { Get-PiVersion } else { '無法取得' })"
    Write-InfoLine "執行模式  ：$(if ($Apply) { '寫入（私人目的地已查核）' } else { 'Dry Run（不寫入工作樹）' })"

    if (-not (Test-Path -LiteralPath $pi -PathType Container)) {
        throw "Pi 家目錄不存在：$pi"
    }

    # --- 1. 展開同步清單 -----------------------------------------------------
    $liveEntries = Expand-LiveEntries -Manifest $manifest -PiHome $pi

    # --- 2. 準備產生的 manifest（套件 / Provider）---------------------------
    $staging = Join-Path ([System.IO.Path]::GetTempPath()) ("pi-config-export-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    $packagesJson = Get-GeneratedPackagesJson -Manifest $manifest -PiHome $pi
    $providersJson = Get-GeneratedProvidersJson -PiHome $pi
    $packagesPath = Join-Path $staging 'packages.json'
    $providersPath = Join-Path $staging 'providers.json'
    Write-Utf8NoBom -Path $packagesPath -Text ($packagesJson + "`n")
    Write-Utf8NoBom -Path $providersPath -Text ($providersJson + "`n")

    $liveEntries += [pscustomobject]@{ LivePath = $packagesPath; PiRel = '(generated)'; RepoRel = 'manifests/packages.json' }
    $liveEntries += [pscustomobject]@{ LivePath = $providersPath; PiRel = '(generated)'; RepoRel = 'manifests/providers.json' }

    # --- 3. 寫入前安全掃描 ---------------------------------------------------
    Write-Section '安全掃描（寫入前）'
    $scanTargets = @($liveEntries | ForEach-Object { $_.LivePath })
    $secretFindings = @(Invoke-SecretScan -Paths $scanTargets)
    if ($secretFindings.Count -gt 0) {
        foreach ($finding in $secretFindings) {
            Write-FailLine ("疑似憑證：{0}:{1}（規則：{2}）" -f $finding.Path, $finding.Line, $finding.Rule)
        }
        Write-FailLine '偵測到疑似憑證，已中止匯出，未寫入任何檔案。'
        exit 2
    }
    Write-OkLine "憑證掃描：$($scanTargets.Count) 個檔案，未發現憑證樣式"

    $pathFindings = @(Invoke-HardcodedPathScan -Paths $scanTargets -UserHome $userHome)
    if ($pathFindings.Count -gt 0) {
        foreach ($finding in $pathFindings) {
            Write-FailLine ("硬編碼使用者路徑：{0}:{1}（{2}）" -f $finding.Path, $finding.Line, $finding.Rule)
        }
        Write-FailLine '偵測到硬編碼的使用者家目錄路徑，已中止匯出。'
        exit 2
    }
    Write-OkLine '可攜性掃描：未發現硬編碼的使用者家目錄路徑'

    $skillsDir = Join-Path $pi ([string]$manifest.deepExecution.skillsDir)
    $depFindings = @(Invoke-SkillDependencyScan -SkillsDir $skillsDir)
    $missing = @($depFindings | Where-Object { $_.Kind -eq 'missing-reference' })
    $executables = @($depFindings | Where-Object { $_.Kind -eq 'executable-script' })
    if ($missing.Count -gt 0) {
        foreach ($finding in $missing) {
            Write-FailLine ("Skill 引用檔案不存在：{0} -> {1}" -f $finding.Skill, $finding.Detail)
        }
        Write-FailLine 'Skills 相依檔案不完整，已中止匯出。'
        exit 2
    }
    if ($executables.Count -gt 0) {
        foreach ($finding in $executables) {
            Write-WarnLine ("Skill 含可執行腳本（需確認解譯器）：{0}/{1}" -f $finding.Skill, $finding.Detail)
        }
    } else {
        Write-OkLine 'Skills 相依檢查：無外部腳本、無缺失的引用檔案'
    }

    # --- 4. 比對與清單 -------------------------------------------------------
    $plan = @()
    foreach ($entry in $liveEntries) {
        $repoFile = Join-RepoPath -Base $repo -Relative $entry.RepoRel
        if ($Apply) { Assert-ExportDestinationPath -Root $repo -Target $repoFile }
        $status = 'A'
        if (Test-Path -LiteralPath $repoFile -PathType Leaf) {
            $status = if (Test-FileContentEqual -Left $repoFile -Right $entry.LivePath) { '=' } else { 'M' }
        }
        $plan += [pscustomobject]@{
            RepoRel  = $entry.RepoRel
            RepoPath = $repoFile
            SrcPath  = $entry.LivePath
            PiRel    = $entry.PiRel
            Status   = $status
        }
    }

    # 儲存庫中殘留、已不在同步清單的檔案
    $stale = @()
    foreach ($entry in $manifest.entries) {
        if ([string]$entry.type -ne 'tree') { continue }
        $targetRoot = Join-RepoPath -Base $repo -Relative ([string]$entry.target)
        if ($Apply) { Assert-ExportDestinationPath -Root $repo -Target $targetRoot }
        if (-not (Test-Path -LiteralPath $targetRoot -PathType Container)) { continue }
        $known = @{}
        foreach ($item in $plan) { $known[$item.RepoRel] = $true }
        $files = Get-ChildItem -LiteralPath $targetRoot -Recurse -File -Force -ErrorAction SilentlyContinue
        foreach ($file in $files) {
            $rel = Get-RelativeSubPath -Base $repo -Path $file.FullName
            if (-not $known.ContainsKey($rel)) {
                $stale += [pscustomobject]@{ RepoRel = $rel; RepoPath = $file.FullName }
            }
        }
    }

    Write-Section '待匯出檔案清單'
    $order = @('A', 'M', '=')
    foreach ($status in $order) {
        foreach ($item in ($plan | Where-Object { $_.Status -eq $status })) {
            $label = switch ($status) { 'A' { '新增' } 'M' { '更新' } default { '相同' } }
            $color = switch ($status) { 'A' { 'Green' } 'M' { 'Yellow' } default { 'DarkGray' } }
            Write-Host ("  [{0}] {1,-6} {2}" -f $status, $label, $item.RepoRel) -ForegroundColor $color
        }
    }
    foreach ($item in $stale) {
        Write-Host ("  [D] 移除   {0}" -f $item.RepoRel) -ForegroundColor Red
    }

    $added = @($plan | Where-Object { $_.Status -eq 'A' }).Count
    $modified = @($plan | Where-Object { $_.Status -eq 'M' }).Count
    $unchanged = @($plan | Where-Object { $_.Status -eq '=' }).Count
    Write-InfoLine ''
    Write-InfoLine ("合計：新增 {0}、更新 {1}、相同 {2}、待移除 {3}" -f $added, $modified, $unchanged, $stale.Count)

    # --- 5. Diff -------------------------------------------------------------
    if (-not $NoDiff) {
        $changed = @($plan | Where-Object { $_.Status -eq 'M' })
        if ($changed.Count -gt 0) {
            Write-Section 'Diff（儲存庫 -> 本機）'
            foreach ($item in $changed) {
                Write-Host ("  --- {0} ---" -f $item.RepoRel) -ForegroundColor Cyan
                Show-Diff -OldPath $item.RepoPath -NewPath $item.SrcPath
            }
        }
    }

    if (-not $Apply) {
        Write-Section 'Dry Run 結束（未寫入目標工作樹）'
        exit 0
    }

    # --- 6. 寫入 -------------------------------------------------------------
    $git = Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $targets = @($plan | Where-Object { $_.Status -ne '=' })
    if ($Prune) { $targets += $stale }
    foreach ($item in $targets) {
        $status = & $git.Source -C $repo --literal-pathspecs status --porcelain=v1 --untracked-files=all -- $item.RepoRel
        if ($LASTEXITCODE -ne 0) { throw '無法檢查 Git 工作樹。' }
        if ($status) {
            Write-FailLine ("匯出目標有未提交的變更：{0}" -f $item.RepoRel)
            exit 3
        }
    }
    if ((Assert-PrivateExportDestination $repo) -ine $verifiedSlug) { throw 'Export destination changed during preparation.' }
    foreach ($item in $plan) { Assert-ExportDestinationPath -Root $repo -Target $item.RepoPath }
    if ($Prune) { foreach ($item in $stale) { Assert-ExportDestinationPath -Root $repo -Target $item.RepoPath } }
    Write-Section '寫入儲存庫'
    foreach ($item in $plan) {
        if ($item.Status -eq '=') { continue }
        $destDir = [System.IO.Path]::GetDirectoryName($item.RepoPath)
        if (-not (Test-Path -LiteralPath $destDir)) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
        [System.IO.File]::Copy($item.SrcPath, $item.RepoPath, $true)
        Write-OkLine ("{0}  {1}" -f $item.Status, $item.RepoRel)
    }

    if ($stale.Count -gt 0) {
        if ($Prune) {
            foreach ($item in $stale) {
                Remove-Item -LiteralPath $item.RepoPath -Force
                Write-OkLine ("D  {0}" -f $item.RepoRel)
            }
        } else {
            foreach ($item in $stale) {
                Write-WarnLine ("未移除（加上 -Prune 才會刪除）：{0}" -f $item.RepoRel)
            }
        }
    }

    # --- 7. 寫入後複驗 -------------------------------------------------------
    Write-Section '安全掃描（寫入後）'
    $repoFiles = @($plan | ForEach-Object { $_.RepoPath } | Where-Object { Test-Path -LiteralPath $_ })
    $postSecrets = @(Invoke-SecretScan -Paths $repoFiles)
    if ($postSecrets.Count -gt 0) {
        foreach ($finding in $postSecrets) {
            Write-FailLine ("疑似憑證：{0}:{1}（規則：{2}）" -f $finding.Path, $finding.Line, $finding.Rule)
        }
        Write-FailLine '寫入後掃描發現問題，請勿提交；請先修復。'
        exit 2
    }
    Write-OkLine "憑證掃描：$($repoFiles.Count) 個檔案，未發現憑證樣式"

    $postPaths = @(Invoke-HardcodedPathScan -Paths $repoFiles -UserHome $userHome)
    if ($postPaths.Count -gt 0) {
        foreach ($finding in $postPaths) {
            Write-FailLine ("硬編碼使用者路徑：{0}:{1}" -f $finding.Path, $finding.Line)
        }
        exit 2
    }
    Write-OkLine '可攜性掃描：通過'

    Write-Section '完成'
    Write-InfoLine '只執行唯讀 Git/gh 查核，未 add / commit / push。'
    Write-InfoLine '下一步：git status -> git add -> git diff --cached -> 依安全檢查清單確認後再提交。'
    exit 0
} catch {
    Write-Host ''
    Write-Host "錯誤：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($null -ne $staging -and (Test-Path -LiteralPath $staging)) {
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
}
