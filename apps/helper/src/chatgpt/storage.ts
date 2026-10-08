import { execFile } from 'node:child_process';
import { lstat, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ChatGPTError } from '@siwc/local';

const execute = promisify(execFile);
const aclScript = `
$ErrorActionPreference = 'Stop'
$target = $env:CHATGPT_SPIKE_ACL_TARGET
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$propagate = [System.Security.AccessControl.PropagationFlags]::None
$allow = [System.Security.AccessControl.AccessControlType]::Allow
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', $inherit, $propagate, $allow))
$system = [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($system, 'FullControl', $inherit, $propagate, $allow))
[System.IO.Directory]::SetAccessControl($target, $acl)
`;

export function storageDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const directory = env.CHATGPT_SPIKE_STORAGE_DIR ??
    (env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'SocialSummarizerChatGPTSpike') : undefined);
  if (!directory || !isAbsolute(directory)) {
    throw new ChatGPTError('invalid_config', 'Set an absolute CHATGPT_SPIKE_STORAGE_DIR, or provide LOCALAPPDATA.');
  }
  const result = resolve(directory);
  // ACL changes apply only to a dedicated app directory, never a shared root.
  const shared = [parse(result).root, homedir(), process.cwd(), env.LOCALAPPDATA].filter(Boolean);
  if (shared.some(value => resolve(value!).toLowerCase() === result.toLowerCase())) {
    throw new ChatGPTError('invalid_config', 'Credential storage must be a dedicated app directory.');
  }
  return result;
}

export async function prepareStorage(directory: string): Promise<void> {
  if (process.platform !== 'win32') throw new ChatGPTError('unsupported_platform', 'This feasibility test requires Windows.');
  try {
    await mkdir(directory, { recursive: true });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe directory');
    await execute('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', aclScript], {
      env: { ...process.env, CHATGPT_SPIKE_ACL_TARGET: directory },
      windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024,
    });
  } catch {
    throw new ChatGPTError('storage_permissions_failed', 'Could not protect the dedicated credential directory. Check Windows file permissions.');
  }
}
