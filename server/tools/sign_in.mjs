// sign_in: for pages behind the login. Usually nothing to do: with the demo account's number and code in the
// extension's settings, captures with logged_in: true sign in by themselves. This tool checks it, signs in now, opens
// a window to sign in by hand (for sites without automatic sign-in), or signs out.
import { z } from 'zod';
import { jobAnswer, startJob, waitJob } from '../engine/jobs.mjs';
import { applySession, LoginStop, sessionStatus, signInByHand, signOut } from '../engine/login.mjs';
import { getSite } from '../engine/site.mjs';
import { getBrowser } from '../engine/browser.mjs';
import { fail, text } from './common.mjs';

export function registerSignIn(server) {
  server.registerTool(
    'sign_in',
    {
      title: 'Sign in to a site',
      description:
        'For pages behind the login. "check" (default): is this laptop signed in? "now": sign in with the demo account from the extension settings. "window": open a browser window so the person can sign in by hand once (up to 5 minutes). "sign_out": forget the sign-in on this laptop.',
      inputSchema: {
        site: z.string().optional(),
        action: z.enum(['check', 'now', 'window', 'sign_out']).optional(),
      },
    },
    async ({ site: siteId, action = 'check' }) => {
      try {
        const site = getSite(siteId);
        const name = site.name ?? site.id;
        if (action === 'sign_out') {
          signOut(site);
          return { content: [text(`Signed out of ${name} on this laptop.`)] };
        }
        if (action === 'now') {
          // signing in = making a capture context with the session applied
          const b = await getBrowser();
          const ctx = await b.newContext();
          try {
            await applySession(ctx, site);
          } finally {
            await ctx.close();
          }
          const st = sessionStatus(site);
          return { content: [text(`Signed in to ${name} (${st.how}). Captures and recordings with logged_in: true now show the account's pages.`)] };
        }
        if (action === 'window') {
          const job = startJob('sign-in', async (update) => {
            update(0.1, 'waiting for the person to sign in in the window');
            const ok = await signInByHand(site, { minutes: 5 });
            if (!ok) throw new LoginStop(`No sign-in was finished in the window, so nothing changed. Try again when ready.`);
            return { content: [text(`Signed in to ${name} on this laptop. It stays signed in for later captures.`)] };
          });
          await waitJob(job, 3);
          if (job.state === 'running') {
            return { content: [text(`A browser window has opened on the screen. Please sign in to ${name} there (it waits up to 5 minutes). When done, call the wait tool with job "${job.id}".`)] };
          }
          return jobAnswer(job, fail);
        }
        const st = sessionStatus(site);
        if (!st.possible) return { content: [text(`${name} has no login set up: only public pages can be captured.`)] };
        return {
          content: [text(st.signedIn ? `Signed in to ${name} on this laptop (${st.how}, since ${st.since}).` : `Not signed in to ${name} yet. Sign-in is ${st.how}. Captures with logged_in: true try it by themselves.`)],
        };
      } catch (e) {
        return fail(e);
      }
    },
  );
}
