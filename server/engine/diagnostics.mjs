// What the extension was doing, written to its log (Claude Desktop puts it in Logs/main.log as "[UtilityProcess
// stderr] [marketing-studio] ..."), so a hang can be traced afterwards: every tool call with how long it took, any
// moment the extension itself froze, and the laptop's free memory when it's low. Agent mode (Cowork) keeps its own
// record of calls out of reach, so this is the only place that shows whether a call was answered.
import os from 'node:os';
import { busyLine, runningJobs } from './jobs.mjs';

const log = (m) => console.error(`[marketing-studio] ${m}`);
const mb = (b) => Math.round(b / 1048576);

// free memory, and whether it is low enough to slow everything down
export function memory() {
  const free = os.freemem();
  return { freeMb: mb(free), totalMb: mb(os.totalmem()), low: free < 700 * 1048576 };
}

// the viewer polls a few tools every second or two: only slow answers from those are worth a line
const QUIET = new Set(['viewer_job', 'viewer_latest', 'viewer_file', 'viewer_copy', 'viewer_folder']);

// wrap every tool registered from now on, and watch for freezes
export function watchServer(server) {
  const register = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) =>
    register(name, config, async (...args) => {
      const t0 = Date.now();
      const quiet = QUIET.has(name);
      if (!quiet) log(`call ${name}${memory().low ? ` (low memory: ${memory().freeMb} MB free)` : ''}`);
      try {
        return await handler(...args);
      } finally {
        const s = (Date.now() - t0) / 1000;
        if (!quiet || s > 5) log(`answered ${name} in ${s.toFixed(1)} s`);
      }
    });

  // the event loop is checked every second; a late tick means the extension itself was frozen
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    const late = now - last - 1000;
    last = now;
    if (late > 2000) {
      const jobs = runningJobs();
      log(`froze for ${(late / 1000).toFixed(1)} s (${jobs.length ? `running ${jobs.map(busyLine).join('; ')}` : 'no job running'}; ${memory().freeMb} MB free)`);
    }
  }, 1000).unref();
}
