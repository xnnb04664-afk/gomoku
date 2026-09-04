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
    throw "Could not restrict local credential file permissions: $Path"
  }
}

function Save-DpapiSecret {
  param(
    [Parameter(Mandatory = $true)][string]$Prompt,
    [Parameter(Mandatory = $true)][string]$FileName
  )

  $secure = Read-Host $Prompt -AsSecureString
  if ($secure.Length -eq 0) {
    throw 'Credential cannot be empty.'
  }

  $encrypted = ConvertFrom-SecureString -SecureString $secure
  $target = Join-Path $secretDir $FileName
  $temporary = "$target.$PID.tmp"
  try {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($temporary, $encrypted, $utf8NoBom)
    Move-Item -LiteralPath $temporary -Destination $target -Force
    Protect-SecretPath -Path $target
    Write-Host "Saved encrypted local credential: $target"
  }
  finally {
    if (Test-Path -LiteralPath $temporary) {
      Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
    Remove-Variable secure -ErrorAction SilentlyContinue
  }
}

if (($Type -eq 'Signing') -or ($Type -eq 'Both')) {
  Save-DpapiSecret -Prompt 'Enter signing password (input is hidden)' -FileName 'keystore-password.dpapi'
}

if (($Type -eq 'Cloudflare') -or ($Type -eq 'Both')) {
  Save-DpapiSecret -Prompt 'Enter Cloudflare API Token (input is hidden)' -FileName 'cloudflare-api-token.dpapi'
}

Write-Host 'Done. Build and deployment scripts will read these local credentials automatically.'
