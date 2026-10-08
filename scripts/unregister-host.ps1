. (Join-Path $PSScriptRoot 'host-common.ps1')
Assert-Windows
Assert-RegistrationOwnership

# Delete only the exact project subkey, never NativeMessagingHosts or any other host.
foreach ($view in $script:RegistryViews) {
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, $view)
    try { $baseKey.DeleteSubKey($script:RegistryPath, $false) }
    finally { $baseKey.Dispose() }
}
# Deliberately leave generated files in place: no recursive file deletion is needed.
Write-Output "Unregistered $script:HostName for this checkout (HKCU only)."
