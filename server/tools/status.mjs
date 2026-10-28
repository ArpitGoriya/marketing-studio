// status: is Marketing Studio ready on this laptop? Where does work go, which sites and pages can it capture, is it
// signed in, can it make video? The first call starts the browser (downloading one only if the laptop has no
// Chrome or Edge).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browserKind, getBrowser } from '../engine/browser.mjs';
import { busyLine, runningJobs } from '../engine/jobs.mjs';
import { sessionStatus } from '../engine/login.mjs';
import { listProjects } from '../engine/project.mjs';
import { withStudio } from '../engine/studio.mjs';
import { brands, ensureDirs, INBOX, OUTPUT, ROOT, sites, VERSION } from '../paths.mjs';
import { text } from './common.mjs';

let videoOk = null;

export function registerStatus(server) {
  server.registerTool(
    'status',
    {
      title: 'Marketing Studio status',
      description:
        'Check that Marketing Studio is ready on this laptop: where work is saved, the sites and pages it can capture (and whether it is signed in), the brands, recent projects. Call this first in a session.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      ensureDirs();
      const lines = [`Marketing Studio ${VERSION} (Node ${process.versions.node}, ${os.platform()} ${os.arch()}).`];
      const busy = runningJobs();
      if (busy.length) lines.push(`Busy: ${busy.map(busyLine).join('; ')}. Call wait for it; if one stays on the same step for minutes, call reset.`);
      try {
        // never let status itself hang on a stuck browser
        await Promise.race([
          (async () => {
            await getBrowser();
            const k = browserKind();
            lines.push(`Browser: ready (${k === 'msedge' ? 'Microsoft Edge' : k === 'chrome' ? 'Google Chrome' : 'downloaded Chromium'}).`);
            if (videoOk === null) videoOk = await withStudio([], (s) => s.canEncode()).catch(() => false);
            lines.push(videoOk ? 'Video: ready (MP4 made by the browser).' : 'Video: this browser cannot make MP4 video. Install Google Chrome and restart Claude.');
          })(),
          new Promise((_, no) => setTimeout(() => no(new Error('it did not answer within 20 s; call reset')), 20000)),
        ]);
      } catch (e) {
        lines.push(`Browser: not ready (${e.message}).`);
      }
      lines.push(`Work is saved in: ${OUTPUT}`, `Voiceovers, music and images people supply go in the Inbox: ${INBOX}`);
      for (const s of sites()) {
        const st = sessionStatus(s);
        lines.push(
          `Site "${s.name ?? s.id}" (${s.url})${s.about ? `: ${s.about}` : ''}`,
          `  Named pages: ${Object.entries(s.pages ?? {}).map(([k, v]) => `${k} (${v})`).join(', ') || 'none'}. Any other page: find_page, or a link the person pastes.`,
          `  Logged-in pages: ${!st.possible ? 'not set up' : st.signedIn ? `signed in (${st.how})` : `not signed in yet; sign-in is ${st.how}`}`,
        );
      }
      const b = brands();
      lines.push(`Brands: ${b.length ? b.map((x) => x.name ?? x.id).join(', ') : 'none set up yet'} (details: the brand tool).`);
      const ps = listProjects().slice(0, 6);
      if (ps.length) lines.push(`Recent projects: ${ps.map((p) => `"${p.title}"`).join(', ')}.`);
      const hello = fs.readFileSync(path.join(ROOT, 'assets', 'hello.png')).toString('base64');
      return { content: [text(lines.join('\n')), { type: 'image', data: hello, mimeType: 'image/png' }] };
    },
  );
}
