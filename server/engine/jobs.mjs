// Long jobs (high-quality recordings, video exports) keep running inside the extension while Claude checks on them:
// a tool waits up to ~40 s for a job and answers with the result, or with "still working" and the job's id, and
// Claude calls `wait` until it's done. (Claude Desktop may give up on a single tool call after about a minute.)
const jobs = new Map();
let n = 0;

export function startJob(kind, run) {
  const job = { id: `${kind}-${++n}`, kind, state: 'running', progress: 0, message: 'starting', result: null, error: null, started: Date.now() };
  const update = (progress, message) => {
    if (progress !== undefined) job.progress = Math.max(0, Math.min(1, progress));
    if (message) job.message = message;
  };
  job.promise = Promise.resolve()
    .then(() => run(update))
    .then(
      (r) => {
        job.state = 'done';
        job.progress = 1;
        job.result = r;
      },
      (e) => {
        job.state = 'failed';
        job.error = e;
      },
    );
  jobs.set(job.id, job);
  return job;
}

export const getJob = (id) => jobs.get(id);

export async function waitJob(job, seconds) {
  await Promise.race([job.promise, new Promise((r) => setTimeout(r, seconds * 1000))]);
  return job;
}

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
