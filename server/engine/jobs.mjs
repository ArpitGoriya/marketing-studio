// Every slow tool runs as a job inside the extension while Claude checks on it: the tool waits up to ~25 s and answers
// with the result, or with "still working" and the job's id, and Claude calls `wait` until it's done. So no call ever
// blocks for minutes (chat apps give up on a call after a while, and a bridge in between may give up sooner).
// A job that runs past its limit is stopped: its browser pages are closed and it fails with what it was doing.
// reset stops every running job at once.
import { AsyncLocalStorage } from 'node:async_hooks';
import os from 'node:os';
import { resetBrowser } from './browser.mjs';
import { crashed, freeMb, giveBack, makeRoom } from './memory.mjs';
import { CaptureStop } from './site.mjs';

// a word on memory when it's low (diagnostics.mjs logs it; this tells Claude, who tells the person)
const memoryNote = () => {
  const free = os.freemem() / 1048576;
  return free < 700 ? ` The laptop is low on memory (${Math.round(free)} MB free), which slows everything down: closing other apps (browser tabs, games, other Claude windows) helps.` : '';
};

const jobs = new Map();
// the job whose work is running now, so browser pages opened anywhere inside it can be closed if it's stopped
const inJob = new AsyncLocalStorage();
export const currentJob = () => inJob.getStore();
// how long a tool waits before answering "still working" (MS_JOB_WAIT shortens it for tests)
export const JOB_WAIT = Number(process.env.MS_JOB_WAIT) || 25;
let n = 0;

// Browser jobs take turns: one at a time, so two never fight over a laptop's last few hundred MB. Each makes room
// before it starts (memory.mjs), gets one more try if the browser dies under it (out of memory, most often), and
// gives the browser's memory back afterwards when memory is low. Slower on a busy laptop, but it gets there.
let lane = Promise.resolve();
const say = (m) => console.error(`[marketing-studio] ${m}`);

// run(update, job): update(progress 0..1, message); job.own(context) registers something to close if the job is
// stopped. limit: seconds for the work itself (waiting for its turn or for memory doesn't count).
export function startJob(kind, run, { limit = 600, label = kind, retries = 1 } = {}) {
  const job = { id: `${kind}-${++n}`, kind, label, state: 'running', progress: 0, message: 'starting', result: null, error: null, started: Date.now(), closers: new Set() };
  job.own = (thing) => (thing && job.closers.add(thing), thing);
  const update = (progress, message) => {
    if (progress !== undefined) job.progress = Math.max(0, Math.min(1, progress));
    if (message) job.message = message;
  };
  let release;
  const ahead = lane;
  lane = new Promise((r) => (release = r));
  job.stop = (why) => {
    if (job.state !== 'running') return false;
    job.state = 'failed';
    job.error = new CaptureStop(why);
    clearTimeout(job.timer);
    for (const c of job.closers) Promise.resolve(c.close?.()).catch(() => {});
    release(); // the next job needn't wait for this one to wind down
    return true;
  };
  const work = async () => {
    if (runningJobs().some((j) => j !== job && j.started < job.started)) update(0, 'waiting for the job before it to finish');
    await ahead;
    for (let attempt = 0; ; attempt++) {
      if (job.state !== 'running') return null;
      await makeRoom(update);
      if (job.state !== 'running') return null;
      clearTimeout(job.timer);
      job.timer = setTimeout(() => {
        if (job.stop(`The ${label} took longer than ${Math.round(limit / 60)} min, so it was stopped (it was ${job.message}). Try again with fewer or shorter steps, or check the step with a dry run.`)) say(`${job.id} stopped after ${limit} s: ${job.message}`);
      }, limit * 1000);
      try {
        return await inJob.run(job, () => run(update, job));
      } catch (e) {
        if (job.state !== 'running' || attempt >= retries || !crashed(e)) throw e;
        // the browser died under it: start a fresh one, make room, and run the job again from the start
        say(`${job.id}: the browser stopped (${String(e.message ?? e).split('\n')[0].slice(0, 120)}); trying again with a fresh one (${freeMb()} MB free)`);
        for (const c of job.closers) Promise.resolve(c.close?.()).catch(() => {});
        job.closers.clear();
        await resetBrowser();
        update(0.02, 'the browser ran out of memory, so it is trying again');
      } finally {
        clearTimeout(job.timer);
        await giveBack().catch(() => {});
      }
    }
  };
  job.promise = Promise.resolve()
    .then(work)
    .then(
      (r) => {
        if (job.state !== 'running') return;
        job.state = 'done';
        job.progress = 1;
        job.result = r;
      },
      (e) => {
        if (job.state !== 'running') return;
        job.state = 'failed';
        job.error = e;
        say(`${job.id} failed: ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`);
      },
    )
    .finally(() => {
      clearTimeout(job.timer);
      release();
    });
  jobs.set(job.id, job);
  // finished jobs are kept an hour, for wait and the viewer
  for (const [id, j] of jobs) if (j.state !== 'running' && Date.now() - j.started > 3600e3) jobs.delete(id);
  return job;
}

export const getJob = (id) => jobs.get(id);
export const runningJobs = () => [...jobs.values()].filter((j) => j.state === 'running');

// reset: stop every running job (their pages close); returns the ones stopped
export const stopAll = (why) => runningJobs().filter((j) => j.stop(why));

export async function waitJob(job, seconds) {
  await Promise.race([job.promise, new Promise((r) => setTimeout(r, seconds * 1000))]);
  return job;
}

// start a job and give it JOB_WAIT seconds before answering
export async function quickJob(kind, run, opts) {
  const job = startJob(kind, run, opts);
  await waitJob(job, JOB_WAIT);
  return job;
}

export const busyLine = (j) => `${j.id} (${j.label}: ${Math.round(j.progress * 100)}%, ${j.message}, ${Math.round((Date.now() - j.started) / 1000)} s so far)`;

// what a tool returns for a job: its result when done, otherwise a short "still working" note
export function jobAnswer(job, errorText) {
  if (job.state === 'done') return job.result;
  if (job.state === 'failed') return errorText(job.error);
  const secs = Math.round((Date.now() - job.started) / 1000);
  return {
    content: [
      {
        type: 'text',
        text: `Still working on it (${Math.round(job.progress * 100)}%, ${job.message}, ${secs} s so far). Call the wait tool with job "${job.id}" to get the result.${memoryNote()}`,
      },
    ],
  };
}
