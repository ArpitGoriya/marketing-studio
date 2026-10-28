// The viewer's Copy, Copy all, Copy caption and Show-in-folder buttons: put finished files on the laptop's clipboard
// (one picture pastes as a picture into WhatsApp, Canva or an email; several files or a video paste as files), put the
// caption text on it, or show a file selected in Explorer / Finder.
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { CaptureStop } from './site.mjs';

const run = (cmd, args, env, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { env: { ...process.env, ...env }, timeout: 20000, windowsHide: true }, (e, _out, err) => (e ? reject(new Error(String(err || e.message).trim())) : resolve()));
    if (input != null) child.stdin.end(input);
  });

// Windows: the files themselves (paste into folders and WhatsApp Desktop) plus, for a single picture, the image (pastes
// into browsers and Office). Paths and text come in through the environment, so no quoting can go wrong.
const WINDOWS_FILES = [
  "$ErrorActionPreference = 'Stop'",
  'Add-Type -AssemblyName System.Windows.Forms',
  'Add-Type -AssemblyName System.Drawing',
  '$d = New-Object System.Windows.Forms.DataObject',
  '$list = New-Object System.Collections.Specialized.StringCollection',
  "foreach ($f in ($env:MS_CLIP_FILES -split '\\|')) { [void]$list.Add($f) }",
  '$d.SetFileDropList($list)',
  "if ($env:MS_CLIP_IMAGE -eq '1') {",
  '  $bytes = [System.IO.File]::ReadAllBytes($list[0])',
  '  $d.SetImage([System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream(,$bytes))))',
  "  $d.SetData('PNG', (New-Object System.IO.MemoryStream(,$bytes)))",
  '}',
  '[System.Windows.Forms.Clipboard]::SetDataObject($d, $true)',
].join('\n');
const WINDOWS_TEXT = ["$ErrorActionPreference = 'Stop'", 'Add-Type -AssemblyName System.Windows.Forms', '[System.Windows.Forms.Clipboard]::SetText($env:MS_CLIP_TEXT)'].join('\n');
// Mac: several files go on the pasteboard as file URLs
const MAC_FILES = 'ObjC.import("AppKit"); function run(argv) { const pb = $.NSPasteboard.generalPasteboard; pb.clearContents; const a = $.NSMutableArray.array; for (const p of argv) a.addObject($.NSURL.fileURLWithPath(p)); pb.writeObjects(a); }';

const powershell = (script, env) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-Command', script], env);
const couldnt = (e) => new CaptureStop(`Couldn't copy it on this laptop (${e.message.split('\n')[0]}). Use Show in folder instead.`);

// returns what went on the clipboard: 'picture' (one image), 'file' (one video) or 'files'
export async function copyFiles(files) {
  const image = files.length === 1 && /\.(png|jpe?g)$/i.test(files[0]);
  try {
    if (process.platform === 'win32') await powershell(WINDOWS_FILES, { MS_CLIP_FILES: files.join('|'), MS_CLIP_IMAGE: image ? '1' : '0' });
    else if (process.platform === 'darwin') {
      if (image) {
        const as = /\.png$/i.test(files[0]) ? '«class PNGf»' : 'JPEG picture';
        await run('osascript', ['-e', 'on run argv', '-e', `set the clipboard to (read (POSIX file (item 1 of argv)) as ${as})`, '-e', 'end run', files[0]]);
      } else await run('osascript', ['-l', 'JavaScript', '-e', MAC_FILES, ...files]);
    } else if (image) await run('xclip', ['-selection', 'clipboard', '-t', /\.png$/i.test(files[0]) ? 'image/png' : 'image/jpeg', '-i', files[0]]);
    else await run('xclip', ['-selection', 'clipboard', '-t', 'text/uri-list'], {}, files.map((f) => `file://${encodeURI(f)}`).join('\r\n'));
  } catch (e) {
    throw couldnt(e);
  }
  return image ? 'picture' : files.length > 1 ? 'files' : 'file';
}

export async function copyText(text) {
  try {
    if (process.platform === 'win32') await powershell(WINDOWS_TEXT, { MS_CLIP_TEXT: text });
    else if (process.platform === 'darwin') await run('pbcopy', [], { LANG: 'en_US.UTF-8' }, text);
    else await run('xclip', ['-selection', 'clipboard'], {}, text);
  } catch (e) {
    throw couldnt(e);
  }
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
