. (Join-Path $PSScriptRoot '../scripts/host-common.ps1')
Assert-Windows

# Exercise ownership guards using a unique disposable key, never a real host's key.
$script:RegistryPath = 'Software\Google\Chrome\NativeMessagingHosts\com.flamehorn.spike_test_' + [Guid]::NewGuid().ToString('N')
function Set-TestKey([string]$value, [string]$extraValue = '') {
    foreach ($view in $script:RegistryViews) {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try {
            $key = $baseKey.CreateSubKey($script:RegistryPath)
            try {
                $key.SetValue('', $value)
                if ($extraValue) { $key.SetValue($extraValue, 'must be preserved') }
            } finally { $key.Dispose() }
        } finally { $baseKey.Dispose() }
    }
}
function Assert-Refused {
    try { Assert-RegistrationOwnership } catch {
        if ($_.Exception.Message -match 'Refusing to change') { return }
        throw
    }
    throw 'Ownership guard accepted a registration it should refuse.'
}
try {
    Assert-RegistrationOwnership
    Set-TestKey 'C:\another-checkout\host.json'
    Assert-Refused
    Set-TestKey $script:ManifestPath
    Assert-RegistrationOwnership
    Set-TestKey $script:ManifestPath 'unrelated'
    Assert-Refused
    Write-Output 'PASS: absent/owned registration accepted; another checkout and extra values refused.'
} finally {
    foreach ($view in $script:RegistryViews) {
        $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
        try { $baseKey.DeleteSubKey($script:RegistryPath, $false) }
        finally { $baseKey.Dispose() }
    }
}
