// reset: when something seems stuck (a call keeps saying "still working" for too long, or the browser stops answering),
// stop every running job and start a fresh browser, without restarting Claude. Nothing saved is lost.
import { resetBrowser } from '../engine/browser.mjs';
import { busyLine, stopAll } from '../engine/jobs.mjs';
import { text } from './common.mjs';

export function registerReset(server) {
  server.registerTool(
    'reset',
    {
      title: 'Reset Marketing Studio',
      description:
        "Stop every running job (recordings, exports, page readings) and restart the extension's browser, when something seems stuck: a job that stays on the same step for minutes, or calls that stop answering. Saved captures, clips and exports are kept. Run the step again afterwards (a dry run first for recordings).",
      inputSchema: {},
    },
    async () => {
      const stopped = stopAll('It was stopped by a reset.');
      const had = await resetBrowser();
      const lines = [
        stopped.length ? `Stopped ${stopped.length} job(s): ${stopped.map(busyLine).join('; ')}.` : 'No jobs were running.',
        had ? 'The browser was closed; a fresh one starts with the next call.' : 'The browser was not running.',
        'Saved work is untouched.',
      ];
      console.error(`[marketing-studio] reset: ${lines.join(' ')}`);
      return { content: [text(lines.join('\n'))] };
    },
  );
}
