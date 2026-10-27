// Open a folder in Explorer / Finder so the person sees the files (a nicety: never fails a tool)
import { spawn } from 'node:child_process';

export function openFolder(dir) {
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [dir]] : process.platform === 'darwin' ? ['open', [dir]] : ['xdg-open', [dir]];
  if (process.env.MS_NO_OPEN) return;
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* fine: the path is in the answer too */
  }
}
