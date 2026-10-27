// wait: get the result of a long job (a high-quality recording, a video export), or "still working".
import { z } from 'zod';
import { getJob, jobAnswer, waitJob } from '../engine/jobs.mjs';
import { fail } from './common.mjs';

export function registerWait(server) {
  server.registerTool(
    'wait',
    {
      title: 'Wait for a job',
      description: 'Wait for a long job (a recording or a video export) that said "still working", and get its result. Call it again if it is still running.',
      inputSchema: {
        job: z.string().describe('The job id from the earlier answer, e.g. "record-2".'),
        seconds: z.number().min(1).max(50).optional().describe('How long to wait at most this time (default 40).'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ job, seconds }) => {
      const j = getJob(job);
      if (!j) return { content: [{ type: 'text', text: `There's no job "${job}" (jobs are forgotten when Claude Desktop restarts; run it again).` }], isError: true };
      await waitJob(j, seconds ?? 40);
      return jobAnswer(j, fail);
    },
  );
}
