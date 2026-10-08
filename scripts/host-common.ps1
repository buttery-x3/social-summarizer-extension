Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:HostName = 'com.flamehorn.social_summarizer_spike'
$script:ProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:HostDirectory = Join-Path $script:ProjectRoot '.native-host'
$script:ManifestPath = Join-Path $script:HostDirectory "$script:HostName.json"
$script:RegistryPath = "Software\Google\Chrome\NativeMessagingHosts\$script:HostName"
$script:RegistryViews = @([Microsoft.Win32.RegistryView]::Registry32, [Microsoft.Win32.RegistryView]::Registry64)

function Assert-Windows {
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'Native host registration is Windows-only.'
    }
}

function Get-ProjectExtensionId {
    $manifest = Get-Content -LiteralPath (Join-Path $script:ProjectRoot 'apps/extension/src/manifest.json') -Raw | ConvertFrom-Json
    $hash = [Security.Cryptography.SHA256]::Create()
    try { $digest = $hash.ComputeHash([Convert]::FromBase64String($manifest.key)) }
    finally { $hash.Dispose() }
    $result = ''
    foreach ($byte in $digest[0..15]) {
        $result += [char](97 + ($byte -shr 4))
        $result += [char](97 + ($byte -band 15))
    }
    return $result
}

function Assert-RegistrationOwnership {
    # Check BOTH views before any mutation. Never overwrite another checkout's registration.
    foreach ($view in $script:RegistryViews) {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $key = $baseKey.OpenSubKey($script:RegistryPath)
            if ($null -ne $key) {
                try {
                    $currentPath = $key.GetValue('')
                    if ($currentPath -ne $script:ManifestPath -or $key.GetSubKeyNames().Length -gt 0 -or
                        @($key.GetValueNames() | Where-Object { $_ -ne '' }).Length -gt 0) {
                        throw "Refusing to change $view registration: it is not owned by this checkout ($currentPath)."
                    }
                } finally { $key.Dispose() }
            }
        } finally { $baseKey.Dispose() }
    }
}
