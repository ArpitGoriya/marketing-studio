// Working on a laptop with little memory to spare: slower, never failing. Measured on the owner's 8 GB laptop, the
// capture browser takes about 180 MB for a preview of the home page and 360 MB in high quality, and closing the
// page gives almost none of it back: only closing the browser does. So:
//   - before a job, when memory is very low, our own browser is closed and the job waits (up to 3 minutes) for
//     memory to come back, instead of starting and crashing halfway;
//   - after a job, when memory is low, the browser is closed so its memory goes back to the laptop at once;
//   - the browser is launched leaner when memory is low (browser.mjs).
import os from 'node:os';
import { resetBrowser } from './browser.mjs';

export const freeMb = () => Math.round(os.freemem() / 1048576);
// below this, the browser is closed after each job (and launched lean, see browser.mjs)
export const LOW_MB = 1200;
// below this, a job waits for memory before it starts
export const TIGHT_MB = 500;
const WAIT_S = 180;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// make room before a job; returns the free memory it starts with
export async function makeRoom(update) {
  let free = freeMb();
  if (free >= TIGHT_MB) return free;
  update?.(undefined, `making room (${free} MB free)`);
  await resetBrowser();
  for (let waited = 0; (free = freeMb()) < TIGHT_MB && waited < WAIT_S; waited += 5) {
    update?.(undefined, `waiting for memory to free up (${free} MB free; closing other apps helps)`);
    await sleep(5000);
  }
  return free;
}

// after a job: give the browser's memory back when it's needed
export async function giveBack() {
  if (freeMb() < LOW_MB) await resetBrowser();
}

// a browser that died under the job (out of memory, most often): worth one more try after making room
export const crashed = (e) => /target crashed|page crashed|crashed|has been closed|target closed|browser has disconnected|browser closed|connection closed|protocol error|out of memory/i.test(String(e?.message ?? e));
