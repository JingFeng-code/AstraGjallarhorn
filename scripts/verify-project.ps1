[CmdletBinding()]
param(
    [ValidateSet('sql', 'dotnet', 'vue')]
    [string[]]$Suite = @('sql', 'dotnet', 'vue')
)

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

function Invoke-Step([string]$Command, [string[]]$Arguments) {
    Write-Host "==> $Command $($Arguments -join ' ')"
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAIL ($LASTEXITCODE): $Command $($Arguments -join ' ')"
        exit $LASTEXITCODE
    }
}

Push-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
try {
    foreach ($name in $Suite) {
        switch ($name) {
            'sql' {
                Invoke-Step node @('examples/sql/verify.mjs')
                Invoke-Step node @('--test', 'examples/sql/verify.test.mjs')
            }
            'dotnet' {
                $project = 'examples/dotnet/Notes.Tests.csproj'
                Invoke-Step dotnet @('build', $project, '--no-restore')
                Invoke-Step dotnet @('test', $project, '--no-build')
            }
            'vue' {
                Push-Location -LiteralPath 'examples/vue'
                try {
                    Invoke-Step npm @('run', 'lint')
                    Invoke-Step npm @('run', 'typecheck')
                    Invoke-Step npm @('test')
                    Invoke-Step npm @('run', 'build')
                    Invoke-Step npm @('run', 'test:e2e')
                } finally {
                    Pop-Location
                }
            }
        }
        Write-Host "PASS: $name"
    }
} finally {
    Pop-Location
}
