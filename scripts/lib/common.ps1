<#
.SYNOPSIS
    pi-config 共用函式庫。

.DESCRIPTION
    由 export.ps1 / apply.ps1 / verify.ps1 以 dot-source 方式載入。
    提供：路徑解析、JSON 讀寫、正規化雜湊、敏感資訊掃描、硬編碼使用者路徑偵測、
    Skills 相依檔案檢查、Pi RPC 指令清單查詢。

    設計原則：
      * 不寫死任何使用者名稱或安裝路徑（一律由 $HOME / $env:USERPROFILE 推導）。
      * 只讀不必要時不動檔案；所有寫入函式都由呼叫端明確觸發。
      * 掃描結果只回報「檔案:行號 + 規則名稱」，不輸出比對到的內容。
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# 主控台輸出
# ---------------------------------------------------------------------------

function Initialize-PiConfigConsole {
    try {
        $utf8 = New-Object System.Text.UTF8Encoding($false)
        [Console]::OutputEncoding = $utf8
        $global:OutputEncoding = $utf8
    } catch {
        # 部份主控台（例如重導向）不支援，忽略即可。
    }
}

function Write-Section {
    param([string]$Text)
    Write-Host ''
    Write-Host "== $Text ==" -ForegroundColor Cyan
}

function Write-InfoLine {
    param([string]$Text)
    Write-Host "  $Text"
}

function Write-OkLine {
    param([string]$Text)
    Write-Host "  [PASS] $Text" -ForegroundColor Green
}

function Write-WarnLine {
    param([string]$Text)
    Write-Host "  [WARN] $Text" -ForegroundColor Yellow
}

function Write-FailLine {
    param([string]$Text)
    Write-Host "  [FAIL] $Text" -ForegroundColor Red
}

function Write-SkipLine {
    param([string]$Text)
    Write-Host "  [SKIP] $Text" -ForegroundColor DarkGray
}

function Write-ManualLine {
    param([string]$Text)
    Write-Host "  [MANUAL] $Text" -ForegroundColor Magenta
}

# ---------------------------------------------------------------------------
# 通用小工具
# ---------------------------------------------------------------------------

function Get-Prop {
    <# 安全取得物件屬性；不存在時回傳預設值（避免 StrictMode 例外）。 #>
    param(
        $Object,
        [string]$Name,
        $Default = $null
    )
    if ($null -eq $Object) { return $Default }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $Default }
    return $prop.Value
}

function Join-RepoPath {
    param([string]$Base, [string]$Relative)
    if ([string]::IsNullOrWhiteSpace($Relative)) { return $Base }
    $rel = $Relative -replace '/', [System.IO.Path]::DirectorySeparatorChar
    return [System.IO.Path]::GetFullPath((Join-Path $Base $rel))
}

function Get-RelativeSubPath {
    <# 取得 $Path 相對於 $Base 的路徑，一律使用正斜線。 #>
    param([string]$Base, [string]$Path)
    $baseFull = [System.IO.Path]::GetFullPath($Base).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    if (-not $pathFull.StartsWith($baseFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "路徑 '$Path' 不在 '$Base' 之下，拒絕處理。"
    }
    return $pathFull.Substring($baseFull.Length).Replace('\', '/')
}

function Test-IsReparsePoint {
    <# Junction / SymbolicLink 都屬於 reparse point。 #>
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($null -eq $item) { return $false }
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
    $linkType = Get-Prop $item 'LinkType'
    return -not [string]::IsNullOrWhiteSpace([string]$linkType)
}

function Get-ReparseTarget {
    param([string]$Path)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    if ($null -eq $item) { return '' }
    $target = Get-Prop $item 'Target'
    if ($null -eq $target) { return '' }
    if ($target -is [array]) { return ($target -join '; ') }
    return [string]$target
}

# ---------------------------------------------------------------------------
# 路徑解析（可攜式：一律從 $HOME 推導）
# ---------------------------------------------------------------------------

function Get-PiHomePath {
    param([string]$PiHome)
    if (-not [string]::IsNullOrWhiteSpace($PiHome)) {
        return ([System.IO.Path]::GetFullPath($PiHome)).TrimEnd('\', '/')
    }
    $userHome = [System.Environment]::GetFolderPath('UserProfile')
    if ([string]::IsNullOrWhiteSpace($userHome)) { $userHome = $HOME }
    return (Join-Path $userHome '.pi')
}

function Get-UserHomePath {
    param([string]$PiHome)
    $pi = Get-PiHomePath $PiHome
    return Split-Path -Parent $pi
}

function Get-AgentDirPath {
    param([string]$PiHome)
    return (Join-Path (Get-PiHomePath $PiHome) 'agent')
}

function Get-PiConfigStateDir {
    <# 本機狀態（備份、套用帳）放在使用者本機應用資料夾，不進版控。 #>
    $base = $env:LOCALAPPDATA
    if ([string]::IsNullOrWhiteSpace($base)) {
        $base = [System.Environment]::GetFolderPath('LocalApplicationData')
    }
    if ([string]::IsNullOrWhiteSpace($base)) {
        $base = Join-Path (Get-UserHomePath '') '.pi-config'
    }
    return (Join-Path $base 'pi-config')
}

function Get-HomeStateKey {
    <# 以 Pi 家目錄產生穩定、可讀的檔名鍵（不寫死使用者名稱）。 #>
    param([string]$PiHomePath)
    $normalized = ([System.IO.Path]::GetFullPath($PiHomePath)).ToLowerInvariant()
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalized))
    } finally {
        $sha.Dispose()
    }
    $hex = ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    $label = ($normalized -replace '[^a-z0-9]+', '-').Trim('-', '\', '/')
    if ($label.Length -gt 40) { $label = $label.Substring($label.Length - 40) }
    return ('{0}-{1}' -f $label, $hex.Substring(0, 8))
}

function Get-ProviderBaselinePath {
    param([string]$PiHomePath)
    return (Join-Path (Get-PiConfigStateDir) ('baseline-{0}.json' -f (Get-HomeStateKey $PiHomePath)))
}

# ---------------------------------------------------------------------------
# JSON
# ---------------------------------------------------------------------------

function ConvertTo-JsonStringLiteral {
    param([string]$Value)
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($ch in $Value.ToCharArray()) {
        $code = [int][char]$ch
        switch ($ch) {
            '"' { [void]$sb.Append('\"'); continue }
            '\' { [void]$sb.Append('\\'); continue }
            "`n" { [void]$sb.Append('\n'); continue }
            "`r" { [void]$sb.Append('\r'); continue }
            "`t" { [void]$sb.Append('\t'); continue }
            default {
                if ($code -lt 32) {
                    [void]$sb.Append(('\u{0:x4}' -f $code))
                } else {
                    [void]$sb.Append($ch)
                }
            }
        }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function ConvertTo-StableJson {
    <#
        與 PowerShell 版本無關的 JSON 輸出（固定 2 空白縮排、保留屬性順序）。
        ConvertTo-Json 在 Windows PowerShell 5.1 與 PowerShell 7 的縮排/轉義不同，
        會造成跨電腦的假差異，因此一律使用此函式。
    #>
    param($Value, [int]$Level = 0)

    $indent = ' ' * ($Level * 2)
    $childIndent = ' ' * (($Level + 1) * 2)

    if ($null -eq $Value) { return 'null' }
    if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
    if ($Value -is [string]) { return (ConvertTo-JsonStringLiteral $Value) }
    if ($Value -is [datetime]) { return (ConvertTo-JsonStringLiteral ($Value.ToString('yyyy-MM-ddTHH:mm:ssK'))) }
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal] -or $Value -is [single]) {
        return ([System.Convert]::ToString($Value, [System.Globalization.CultureInfo]::InvariantCulture))
    }

    if ($Value -is [System.Collections.IDictionary]) {
        if ($Value.Count -eq 0) { return '{}' }
        $parts = @()
        foreach ($key in $Value.Keys) {
            $parts += ('{0}{1}: {2}' -f $childIndent, (ConvertTo-JsonStringLiteral ([string]$key)), (ConvertTo-StableJson -Value $Value[$key] -Level ($Level + 1)))
        }
        return ("{`n" + ($parts -join ",`n") + "`n" + $indent + '}')
    }

    if ($Value -is [System.Collections.IEnumerable]) {
        $items = @()
        foreach ($item in $Value) { $items += (ConvertTo-StableJson -Value $item -Level ($Level + 1)) }
        if ($items.Count -eq 0) { return '[]' }
        $wrapped = @()
        foreach ($item in $items) { $wrapped += ($childIndent + $item) }
        return ("[`n" + ($wrapped -join ",`n") + "`n" + $indent + ']')
    }

    $properties = $Value.PSObject.Properties
    if ($null -ne $properties -and @($properties).Count -gt 0) {
        $parts = @()
        foreach ($prop in $properties) {
            $parts += ('{0}{1}: {2}' -f $childIndent, (ConvertTo-JsonStringLiteral $prop.Name), (ConvertTo-StableJson -Value $prop.Value -Level ($Level + 1)))
        }
        return ("{`n" + ($parts -join ",`n") + "`n" + $indent + '}')
    }

    return (ConvertTo-JsonStringLiteral ([string]$Value))
}

function Read-JsonFile {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "找不到 JSON 檔：$Path"
    }
    $raw = [System.IO.File]::ReadAllText($Path)
    if ([string]::IsNullOrWhiteSpace($raw)) {
        throw "JSON 檔為空：$Path"
    }
    return ($raw | ConvertFrom-Json)
}

function Write-Utf8NoBom {
    param([string]$Path, [string]$Text)
    $dir = [System.IO.Path]::GetDirectoryName($Path)
    if (-not [string]::IsNullOrWhiteSpace($dir) -and -not (Test-Path -LiteralPath $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

function Write-JsonFile {
    param([string]$Path, $Object)
    $json = ConvertTo-StableJson -Value $Object
    Write-Utf8NoBom -Path $Path -Text ($json + "`n")
}

# ---------------------------------------------------------------------------
# 檔案雜湊（文字檔先正規化 CRLF -> LF，避免跨電腦假差異）
# ---------------------------------------------------------------------------

function Test-TextBytes {
    param([byte[]]$Bytes)
    $limit = [Math]::Min($Bytes.Length, 8192)
    for ($i = 0; $i -lt $limit; $i++) {
        if ($Bytes[$i] -eq 0) { return $false }
    }
    return $true
}

function Get-NormalizedHash {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    if (Test-TextBytes $bytes) {
        $text = [System.Text.Encoding]::UTF8.GetString($bytes)
        if ($text.Length -gt 0 -and $text[0] -eq [char]0xFEFF) { $text = $text.Substring(1) }
        $text = $text -replace "`r`n", "`n"
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    }
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $hash = $sha.ComputeHash($bytes)
    } finally {
        $sha.Dispose()
    }
    return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
}

function Test-FileContentEqual {
    param([string]$Left, [string]$Right)
    if (-not (Test-Path -LiteralPath $Left -PathType Leaf)) { return $false }
    if (-not (Test-Path -LiteralPath $Right -PathType Leaf)) { return $false }
    return ((Get-NormalizedHash $Left) -eq (Get-NormalizedHash $Right))
}

# ---------------------------------------------------------------------------
# 敏感資訊掃描
# ---------------------------------------------------------------------------

function Get-SecretPatterns {
    # 只回報規則名稱，永不輸出比對內容。
    return @(
        @{ Name = 'API key（sk- 形式）'; Regex = 'sk-[A-Za-z0-9_\-]{16,}' },
        @{ Name = 'GitHub Token'; Regex = 'gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}' },
        @{ Name = 'AWS Access Key'; Regex = 'AKIA[0-9A-Z]{16}' },
        @{ Name = 'Google API Key'; Regex = 'AIza[0-9A-Za-z_\-]{30,}' },
        @{ Name = 'Slack Token'; Regex = 'xox[baprs]-[A-Za-z0-9\-]{10,}' },
        @{ Name = 'Private Key 區塊'; Regex = '-----BEGIN [A-Z ]*PRIVATE KEY-----' },
        @{ Name = 'JWT'; Regex = 'eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.' },
        @{ Name = 'Bearer Token'; Regex = '(?i)Bearer\s+[A-Za-z0-9._\-]{20,}' },
        @{ Name = 'Cloudflare Access 標頭'; Regex = '(?i)CF-Access-Client-(Id|Secret)' },
        @{ Name = '金鑰/密碼指派'; Regex = '(?i)(api[_-]?key|access[_-]?token|secret[_-]?key|client[_-]?secret|auth[_-]?token|password)\s*[:=]\s*["''][A-Za-z0-9_\-\.\/\+=]{16,}["'']' }
    )
}

function Invoke-SecretScan {
    <#
        掃描指定檔案內容是否含憑證樣式。
        回傳 @{ Path; Line; Rule } 陣列（不包含比對到的字串）。
    #>
    param([string[]]$Paths)

    $patterns = Get-SecretPatterns
    $findings = New-Object System.Collections.ArrayList

    foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        $lines = [System.IO.File]::ReadAllLines($path)
        for ($i = 0; $i -lt $lines.Length; $i++) {
            $line = $lines[$i]
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            foreach ($pattern in $patterns) {
                if ($line -match $pattern.Regex) {
                    [void]$findings.Add([pscustomobject]@{
                        Path = $path
                        Line = $i + 1
                        Rule = $pattern.Name
                    })
                }
            }
        }
    }
    return $findings
}

function Invoke-HardcodedPathScan {
    <#
        偵測硬編碼的使用者家目錄路徑（跨電腦會失效）。
        允許 ~ 開頭的可攜式寫法。
    #>
    param([string[]]$Paths, [string]$UserHome)

    $rules = @(
        @{ Name = 'Windows 使用者家目錄'; Regex = '(?i)[A-Z]:\\Users\\[A-Za-z0-9._\-]+' },
        @{ Name = 'Linux 家目錄'; Regex = '(?i)(^|[^A-Za-z0-9._\-])/home/[A-Za-z0-9._\-]+/' },
        @{ Name = 'macOS 家目錄'; Regex = '(?i)(^|[^A-Za-z0-9._\-])/Users/[A-Za-z0-9._\-]+/' },
        @{ Name = 'USERPROFILE 變數'; Regex = ('(?i)%USER' + 'PROFILE' + '%') }
    )

    $findings = New-Object System.Collections.ArrayList
    foreach ($path in $Paths) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        $lines = [System.IO.File]::ReadAllLines($path)
        for ($i = 0; $i -lt $lines.Length; $i++) {
            $line = $lines[$i]
            if ([string]::IsNullOrWhiteSpace($line)) { continue }
            $matched = $false
            foreach ($rule in $rules) {
                if ($line -match $rule.Regex) {
                    [void]$findings.Add([pscustomobject]@{
                        Path = $path
                        Line = $i + 1
                        Rule = $rule.Name
                    })
                    $matched = $true
                }
            }
            if (-not $matched -and -not [string]::IsNullOrWhiteSpace($UserHome)) {
                $normalizedLine = $line -replace '/', '\'
                if ($normalizedLine.IndexOf($UserHome, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
                    [void]$findings.Add([pscustomobject]@{
                        Path = $path
                        Line = $i + 1
                        Rule = '目前使用者的家目錄字串'
                    })
                }
            }
        }
    }
    return $findings
}

function Invoke-SkillDependencyScan {
    <#
        檢查 Skills 是否引用不存在的附屬檔案（例如 scripts/、references/、assets/），
        並列出實際存在、需要額外解譯器的腳本檔。
        回傳 @{ Skill; Kind; Detail } 陣列。
    #>
    param([string]$SkillsDir)

    $findings = New-Object System.Collections.ArrayList
    if (-not (Test-Path -LiteralPath $SkillsDir -PathType Container)) { return $findings }

    $referenceRegex = '(?i)(scripts|references|assets|templates|resources)/[A-Za-z0-9._\-/]+'
    $scriptExtensions = @('.sh', '.ps1', '.py', '.js', '.mjs', '.cjs', '.ts', '.bat', '.cmd')

    $skillDirs = Get-ChildItem -LiteralPath $SkillsDir -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') -PathType Leaf }

    foreach ($skillDir in $skillDirs) {
        $skillFile = Join-Path $skillDir.FullName 'SKILL.md'
        $text = [System.IO.File]::ReadAllText($skillFile)
        $matches = [regex]::Matches($text, $referenceRegex)
        $seen = @{}
        foreach ($match in $matches) {
            $rel = $match.Value.TrimEnd('.', ',', ';', ')', '`')
            if ($seen.ContainsKey($rel)) { continue }
            $seen[$rel] = $true
            $full = Join-Path $skillDir.FullName ($rel -replace '/', '\')
            if (-not (Test-Path -LiteralPath $full)) {
                [void]$findings.Add([pscustomobject]@{
                    Skill  = $skillDir.Name
                    Kind   = 'missing-reference'
                    Detail = $rel
                })
            }
        }

        $extraFiles = Get-ChildItem -LiteralPath $skillDir.FullName -Recurse -File -ErrorAction SilentlyContinue |
            Where-Object { ($_.Name -ne 'SKILL.md') -and ($scriptExtensions -contains $_.Extension.ToLowerInvariant()) }
        foreach ($file in $extraFiles) {
            [void]$findings.Add([pscustomobject]@{
                Skill  = $skillDir.Name
                Kind   = 'executable-script'
                Detail = Get-RelativeSubPath -Base $skillDir.FullName -Path $file.FullName
            })
        }
    }
    return $findings
}

# ---------------------------------------------------------------------------
# 同步清單（manifest -> 實際檔案）
# ---------------------------------------------------------------------------

function Read-Manifest {
    param([string]$RepoPath)
    $manifestPath = Join-Path $RepoPath 'manifests/pi-config.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "找不到 manifest：$manifestPath（請確認 -RepoPath 指向 pi-config 儲存庫）"
    }
    return (Read-JsonFile $manifestPath)
}

function Test-ExcludedName {
    param([string]$Name, $Excluded)
    foreach ($item in $Excluded) {
        if ($Name -ieq [string]$item) { return $true }
    }
    return $false
}

function Expand-LiveEntries {
    <#
        由「本機 Pi 家目錄」展開要同步的檔案清單。
        回傳 @{ LivePath; PiRel; RepoRel }, 依 RepoRel 排序。
    #>
    param($Manifest, [string]$PiHome)

    $entries = @()
    $excluded = @(Get-Prop $Manifest 'excludeNames' @())
    $sensitive = @(Get-Prop $Manifest 'sensitiveNames' @())

    foreach ($entry in $Manifest.entries) {
        $sourceRel = [string]$entry.source
        $targetRel = [string]$entry.target
        $type = [string]$entry.type
        $sourcePath = Join-RepoPath -Base $PiHome -Relative $sourceRel

        if (-not (Test-Path -LiteralPath $sourcePath)) {
            throw "同步來源不存在：$sourceRel（實際：$sourcePath）"
        }
        if (Test-IsReparsePoint $sourcePath) {
            throw "同步來源是符號連結或 Junction，拒絕跟隨：$sourceRel -> $(Get-ReparseTarget $sourcePath)"
        }

        if ($type -eq 'file') {
            $name = [System.IO.Path]::GetFileName($sourcePath)
            foreach ($s in $sensitive) {
                if ($name -ieq [string]$s) { throw "來源檔名屬於敏感清單，拒絕同步：$sourceRel" }
            }
            $entries += [pscustomobject]@{
                LivePath = $sourcePath
                PiRel    = $sourceRel
                RepoRel  = $targetRel
            }
            continue
        }

        if ($type -eq 'tree') {
            $rootItem = Get-Item -LiteralPath $sourcePath -Force
            if (-not $rootItem.PSIsContainer) { throw "manifest 標示為 tree 但來源不是目錄：$sourceRel" }
            $files = Get-ChildItem -LiteralPath $sourcePath -Recurse -File -Force -ErrorAction SilentlyContinue
            foreach ($file in $files) {
                $childRel = Get-RelativeSubPath -Base $sourcePath -Path $file.FullName
                $segments = $childRel.Split('/')
                $skip = $false
                foreach ($segment in $segments) {
                    if (Test-ExcludedName -Name $segment -Excluded $excluded) { $skip = $true }
                    foreach ($s in $sensitive) {
                        if ($segment -ieq [string]$s) { $skip = $true }
                    }
                }
                if ($skip) { continue }
                if (Test-IsReparsePoint $file.FullName) {
                    throw "同步來源含符號連結，拒絕跟隨：$sourceRel/$childRel -> $(Get-ReparseTarget $file.FullName)"
                }
                if ($file.PSIsContainer) { continue }
                $entries += [pscustomobject]@{
                    LivePath = $file.FullName
                    PiRel    = ($sourceRel.TrimEnd('/') + '/' + $childRel)
                    RepoRel  = ($targetRel.TrimEnd('/') + '/' + $childRel)
                }
            }
            continue
        }

        throw "manifest entry type 不支援：$type"
    }

    return @($entries | Sort-Object RepoRel)
}

function Expand-RepoEntries {
    <#
        由「儲存庫工作目錄」展開要套用/驗證的檔案清單。
        與 Expand-LiveEntries 使用同一份 manifest。
    #>
    param($Manifest, [string]$RepoPath)

    $entries = @()
    $sensitive = @(Get-Prop $Manifest 'sensitiveNames' @())

    foreach ($entry in $Manifest.entries) {
        $sourceRel = [string]$entry.source
        $targetRel = [string]$entry.target
        $type = [string]$entry.type
        $targetPath = Join-RepoPath -Base $RepoPath -Relative $targetRel

        if (-not (Test-Path -LiteralPath $targetPath)) {
            throw "儲存庫缺少檔案：$targetRel（實際：$targetPath）"
        }

        if ($type -eq 'file') {
            $name = [System.IO.Path]::GetFileName($targetPath)
            foreach ($s in $sensitive) {
                if ($name -ieq [string]$s) { throw "儲存庫檔名屬於敏感清單，拒絕套用：$targetRel" }
            }
            $entries += [pscustomobject]@{
                LivePath = ''
                PiRel    = $sourceRel
                RepoRel  = $targetRel
                RepoPath = $targetPath
            }
            continue
        }

        if ($type -eq 'tree') {
            $files = Get-ChildItem -LiteralPath $targetPath -Recurse -File -Force -ErrorAction SilentlyContinue
            foreach ($file in $files) {
                $childRel = Get-RelativeSubPath -Base $targetPath -Path $file.FullName
                $entries += [pscustomobject]@{
                    LivePath = ''
                    PiRel    = ($sourceRel.TrimEnd('/') + '/' + $childRel)
                    RepoRel  = ($targetRel.TrimEnd('/') + '/' + $childRel)
                    RepoPath = $file.FullName
                }
            }
            continue
        }

        throw "manifest entry type 不支援：$type"
    }

    return @($entries | Sort-Object RepoRel)
}

# ---------------------------------------------------------------------------
# Pi 版本 / 套件
# ---------------------------------------------------------------------------

function Get-PiVersion {
    try {
        $raw = & pi --version 2>$null
    } catch {
        return $null
    }
    if ($null -eq $raw) { return $null }
    $text = ([string]($raw -join ' ')).Trim()
    if ($text -match '(\d+\.\d+\.\d+)') { return $Matches[1] }
    return $null
}

function Get-InstalledPackageVersion {
    param([string]$PiHome, [string]$PackageName)
    $path = Join-Path (Get-AgentDirPath $PiHome) ("npm/node_modules/{0}/package.json" -f $PackageName)
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    $pkg = Read-JsonFile $path
    return [string](Get-Prop $pkg 'version' '')
}

function Get-SettingsPackages {
    param([string]$PiHome)
    $settingsPath = Join-Path (Get-AgentDirPath $PiHome) 'settings.json'
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) { return @() }
    $settings = Read-JsonFile $settingsPath
    $packages = Get-Prop $settings 'packages' @()
    if ($null -eq $packages) { return @() }
    return @($packages)
}

function Get-PackageSource {
    param($Entry)
    if ($Entry -is [string]) { return $Entry }
    return [string](Get-Prop $Entry 'source' '')
}

function ConvertTo-PackageName {
    <# 'npm:pi-agnes-tools@0.3.7' -> 'pi-agnes-tools' #>
    param([string]$Spec)
    $value = [string]$Spec
    if ($value.StartsWith('npm:')) { $value = $value.Substring(4) }
    if ($value.StartsWith('@')) {
        $slash = $value.IndexOf('/')
        if ($slash -lt 0) { return $value }
        $at = $value.IndexOf('@', $slash)
        if ($at -lt 0) { return $value }
        return $value.Substring(0, $at)
    }
    $at = $value.IndexOf('@')
    if ($at -gt 0) { return $value.Substring(0, $at) }
    return $value
}

# ---------------------------------------------------------------------------
# Pi RPC：取得可發現的指令與 Skills（不需要 TTY、不呼叫模型）
# ---------------------------------------------------------------------------

function Invoke-PiGetCommands {
    param(
        [Parameter(Mandatory = $true)][string]$AgentDir,
        [Parameter(Mandatory = $true)][string]$UserHome,
        [string]$WorkingDirectory,
        [int]$TimeoutSeconds = 120
    )

    if ([string]::IsNullOrWhiteSpace($WorkingDirectory)) {
        $WorkingDirectory = $UserHome
    }
    if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
        throw "RPC 工作目錄不存在：$WorkingDirectory"
    }

    $comSpec = $env:ComSpec
    if ([string]::IsNullOrWhiteSpace($comSpec)) { $comSpec = 'cmd.exe' }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $comSpec
    $psi.Arguments = '/d /c pi --mode rpc --no-session --offline'
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = $WorkingDirectory
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $psi.StandardOutputEncoding = $utf8
    $psi.StandardErrorEncoding = $utf8
    $psi.EnvironmentVariables['PI_CODING_AGENT_DIR'] = $AgentDir
    $psi.EnvironmentVariables['USERPROFILE'] = $UserHome
    $psi.EnvironmentVariables['HOME'] = $UserHome

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    [void]$proc.Start()
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()
    try {
        $proc.StandardInput.WriteLine('{"id":"1","type":"get_commands"}')
        $proc.StandardInput.Flush()
    } catch {
        # 程序可能已結束，交給下方逾時處理。
    }
    try { $proc.StandardInput.Close() } catch { }

    if (-not $proc.WaitForExit($TimeoutSeconds * 1000)) {
        try { $proc.Kill() } catch { }
        throw "pi RPC 逾時（${TimeoutSeconds}s）：$AgentDir"
    }
    $stdout = $stdoutTask.Result
    $stderr = $stderrTask.Result

    foreach ($line in ($stdout -split "`n")) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '') { continue }
        try {
            $record = $trimmed | ConvertFrom-Json
        } catch {
            continue
        }
        if ((Get-Prop $record 'type') -eq 'response' -and (Get-Prop $record 'command') -eq 'get_commands') {
            $data = Get-Prop $record 'data'
            $commands = Get-Prop $data 'commands' @()
            return @($commands)
        }
    }

    $stderrTail = ''
    if (-not [string]::IsNullOrWhiteSpace($stderr)) {
        $stderrTail = ($stderr -split "`n" | Select-Object -Last 5) -join ' | '
    }
    throw "pi RPC 未回傳 get_commands 結果。stderr：$stderrTail"
}

function Get-SkillCommandNames {
    param($Commands)
    $names = @()
    foreach ($command in $Commands) {
        if ((Get-Prop $command 'source') -ne 'skill') { continue }
        $name = [string](Get-Prop $command 'name' '')
        if ($name.StartsWith('skill:')) { $name = $name.Substring(6) }
        $names += $name
    }
    return @($names)
}
