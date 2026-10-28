// wait: get the result of a long job (a high-quality recording, a video export), or "still working".
import { z } from 'zod';
import { getJob, jobAnswer, JOB_WAIT, waitJob } from '../engine/jobs.mjs';
import { fail } from './common.mjs';

export function registerWait(server) {
  server.registerTool(
    'wait',
    {
      title: 'Wait for a job',
      description:
        'Wait for a job that said "still working" (a page reading, capture, recording, check or export), and get its result. Call it again while it is still running; each answer says which step it is on. If it stays on the same step for minutes, call reset.',
      inputSchema: {
        job: z.string().describe('The job id from the earlier answer, e.g. "record-2".'),
        seconds: z.number().min(1).max(30).optional().describe('How long to wait at most this time (default 25).'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ job, seconds }) => {
      const j = getJob(job);
      if (!j) return { content: [{ type: 'text', text: `There's no job "${job}" (jobs are forgotten when Claude Desktop restarts or after a reset; run it again).` }], isError: true };
      await waitJob(j, seconds ?? JOB_WAIT);
      return jobAnswer(j, fail);
    },
  );
}
