// The viewer's Copy and Show-in-folder buttons: put a finished file on the laptop's clipboard (a picture pastes as
// a picture into WhatsApp, Canva or an email; a video pastes as a file), or show it selected in Explorer / Finder.
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { CaptureStop } from './site.mjs';

const run = (cmd, args, env) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, { env: { ...process.env, ...env }, timeout: 20000, windowsHide: true }, (e, _out, err) => (e ? reject(new Error(String(err || e.message).trim())) : resolve())),
  );

// Windows: the file itself (pastes into folders and WhatsApp Desktop) plus, for pictures, the image (pastes into
// browsers and Office). The path comes in through the environment, so no quoting can go wrong.
const WINDOWS = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  '$f = $env:MS_CLIP_FILE',
  '$d = New-Object System.Windows.Forms.DataObject',
  '$list = New-Object System.Collections.Specialized.StringCollection',
  '[void]$list.Add($f)',
  '$d.SetFileDropList($list)',
  "if ($env:MS_CLIP_IMAGE -eq '1') {",
  '  $bytes = [System.IO.File]::ReadAllBytes($f)',
  '  $d.SetImage([System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream(,$bytes))))',
  "  $d.SetData('PNG', (New-Object System.IO.MemoryStream(,$bytes)))",
  '}',
  '[System.Windows.Forms.Clipboard]::SetDataObject($d, $true)',
].join('\n');

export async function copyFile(file) {
  const image = /\.(png|jpe?g)$/i.test(file);
  try {
    if (process.platform === 'win32') await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', WINDOWS], { MS_CLIP_FILE: file, MS_CLIP_IMAGE: image ? '1' : '0' });
    else if (process.platform === 'darwin') {
      const set = image && /\.png$/i.test(file) ? 'set the clipboard to (read (POSIX file (item 1 of argv)) as «class PNGf»)' : image ? 'set the clipboard to (read (POSIX file (item 1 of argv)) as JPEG picture)' : 'set the clipboard to (POSIX file (item 1 of argv))';
      await run('osascript', ['-e', 'on run argv', '-e', set, '-e', 'end run', file]);
    } else await run('xclip', ['-selection', 'clipboard', '-t', image ? (/\.png$/i.test(file) ? 'image/png' : 'image/jpeg') : 'text/uri-list', '-i', file]);
  } catch (e) {
    throw new CaptureStop(`Couldn't copy it on this laptop (${e.message.split('\n')[0]}). Use Download or Show in folder instead.`);
  }
  return image ? 'picture' : 'file';
}

export function revealFile(file) {
  try {
    if (process.platform === 'win32') spawn('explorer.exe', [`/select,"${file}"`], { stdio: 'ignore', detached: true, windowsVerbatimArguments: true }).unref();
    else if (process.platform === 'darwin') spawn('open', ['-R', file], { stdio: 'ignore', detached: true }).unref();
    else spawn('xdg-open', [path.dirname(file)], { stdio: 'ignore', detached: true }).unref();
  } catch (e) {
    throw new CaptureStop(`Couldn't open the folder (${e.message}). The file is at ${file}`);
  }
}
