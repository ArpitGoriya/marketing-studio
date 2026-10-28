// Every slow tool runs as a job inside the extension while Claude checks on it: the tool waits up to ~25 s and answers
// with the result, or with "still working" and the job's id, and Claude calls `wait` until it's done. So no call ever
// blocks for minutes (chat apps give up on a call after a while, and a bridge in between may give up sooner).
// A job that runs past its limit is stopped: its browser pages are closed and it fails with what it was doing.
// reset stops every running job at once.
import { AsyncLocalStorage } from 'node:async_hooks';
import { CaptureStop } from './site.mjs';

const jobs = new Map();
// the job whose work is running now, so browser pages opened anywhere inside it can be closed if it's stopped
const inJob = new AsyncLocalStorage();
export const currentJob = () => inJob.getStore();
// how long a tool waits before answering "still working" (MS_JOB_WAIT shortens it for tests)
export const JOB_WAIT = Number(process.env.MS_JOB_WAIT) || 25;
let n = 0;

// run(update, job): update(progress 0..1, message); job.own(context) registers something to close if the job is stopped
export function startJob(kind, run, { limit = 600, label = kind } = {}) {
  const job = { id: `${kind}-${++n}`, kind, label, state: 'running', progress: 0, message: 'starting', result: null, error: null, started: Date.now(), closers: new Set() };
  job.own = (thing) => (thing && job.closers.add(thing), thing);
  const update = (progress, message) => {
    if (progress !== undefined) job.progress = Math.max(0, Math.min(1, progress));
    if (message) job.message = message;
  };
  job.stop = (why) => {
    if (job.state !== 'running') return false;
    job.state = 'failed';
    job.error = new CaptureStop(why);
    clearTimeout(job.timer);
    for (const c of job.closers) Promise.resolve(c.close?.()).catch(() => {});
    return true;
  };
  job.timer = setTimeout(() => {
    if (job.stop(`The ${label} took longer than ${Math.round(limit / 60)} min, so it was stopped (it was ${job.message}). Try again with fewer or shorter steps, or check the step with a dry run.`))
      console.error(`[marketing-studio] ${job.id} stopped after ${limit} s: ${job.message}`);
  }, limit * 1000);
  job.promise = Promise.resolve()
    .then(() => inJob.run(job, () => run(update, job)))
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
      },
    )
    .finally(() => clearTimeout(job.timer));
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
        text: `Still working on it (${Math.round(job.progress * 100)}%, ${job.message}, ${secs} s so far). Call the wait tool with job "${job.id}" to get the result.`,
      },
    ],
  };
}
