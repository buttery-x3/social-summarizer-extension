param([string]$NodePath)
. (Join-Path $PSScriptRoot 'host-common.ps1')
Assert-Windows

if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
$NodePath = (Resolve-Path -LiteralPath $NodePath).Path
$hostEntry = Join-Path $script:ProjectRoot 'dist/host/index.cjs'
$builtManifest = Join-Path $script:ProjectRoot 'dist/extension/manifest.json'
if (-not (Test-Path -LiteralPath $hostEntry) -or -not (Test-Path -LiteralPath $builtManifest)) {
    throw 'Run npm ci and npm run build first.'
}
$version = & $NodePath --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v24\.') { throw "Node 24 required; got $version" }
$sourceManifest = Get-Content -LiteralPath (Join-Path $script:ProjectRoot 'src/extension/manifest.json') -Raw | ConvertFrom-Json
$extensionManifest = Get-Content -LiteralPath $builtManifest -Raw | ConvertFrom-Json
if ($sourceManifest.key -ne $extensionManifest.key) { throw 'Manifest key changed. Rebuild first.' }
$extensionId = Get-ProjectExtensionId
foreach ($value in @($NodePath, $hostEntry, $script:HostDirectory)) {
    if ($value -match '[%"\r\n]') { throw 'The CMD launcher cannot use paths containing percent signs, quotes, or newlines.' }
}
Assert-RegistrationOwnership

New-Item -ItemType Directory -Path $script:HostDirectory -Force | Out-Null
$launcherPath = Join-Path $script:HostDirectory 'launch-host.cmd'
# Chrome supplies only its origin and parent-window arguments. The protocol never runs commands.
$launcher = '@echo off' + "`r`n" + 'setlocal DisableDelayedExpansion' + "`r`n" + '"' + $NodePath + '" "' + $hostEntry + '" %*' + "`r`n"
[IO.File]::WriteAllText($launcherPath, $launcher, [Text.UTF8Encoding]::new($false))
$hostManifest = [ordered]@{
    name = $script:HostName
    description = 'Flamehorn Native Messaging feasibility helper'
    path = $launcherPath
    type = 'stdio'
    allowed_origins = @("chrome-extension://$extensionId/")
}
[IO.File]::WriteAllText($script:ManifestPath, ($hostManifest | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
foreach ($view in $script:RegistryViews) {
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try {
        $key = $baseKey.CreateSubKey($script:RegistryPath)
        try { $key.SetValue('', $script:ManifestPath, [Microsoft.Win32.RegistryValueKind]::String) }
        finally { $key.Dispose() }
    } finally { $baseKey.Dispose() }
}
Write-Output "Registered $script:HostName for extension $extensionId (HKCU, both registry views)."
Write-Output "Node: $version at $NodePath"
Write-Output "Manifest: $script:ManifestPath"
