#requires -Version 5.1
[CmdletBinding()]
param(
  [ValidateSet('Signing', 'Cloudflare', 'Both')]
  [string]$Type = 'Signing'
)

$ErrorActionPreference = 'Stop'

$secretDir = Join-Path ($env:USERPROFILE) 'Documents\GomokuSecrets'
New-Item -ItemType Directory -Path $secretDir -Force | Out-Null

function Protect-SecretPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  $currentSid = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value
  & icacls.exe $Path /inheritance:r `
    /grant:r "*$($currentSid):F" "*S-1-5-18:F" "*S-1-5-32-544:F" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "无法收紧本机凭据文件权限：$Path"
  }
}

function Save-DpapiSecret {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [Parameter(Mandatory = $true)][string]$FileName
  )

  $secure = Read-Host $Prompt -AsSecureString
  if ($secure.Length -eq 0) {
    throw '凭据不能为空。'
  }

  $encrypted = ConvertFrom-SecureString -SecureString $secure
  $target = Join-Path $secretDir $FileName
  $temporary = "$target.$PID.tmp"
  try {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temporary, $encrypted, $utf8NoBom)
    Move-Item -LiteralPath $temporary -Destination $target -Force
    Protect-SecretPath -Path $target
    Write-Host "已保存本机加密凭据：$target"
  }
  finally {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
    Remove-Variable secure -ErrorAction SilentlyContinue
  }
}

if ($Type -in @('Signing', 'Both')) {
  Save-DpapiSecret `
    -Prompt '首次设置签名密码（输入内容不会显示）' `
    -FileName 'keystore-password.dpapi'
}

if ($Type -in @('Cloudflare', 'Both')) {
  Save-DpapiSecret `
    -Prompt '首次设置 Cloudflare API Token（输入内容不会显示）' `
    -FileName 'cloudflare-api-token.dpapi'
}

Write-Host '完成。以后 build_apk.js、publish.js、deploy_worker.js 和 admin.js 会自动读取本机凭据。'
