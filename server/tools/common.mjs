// Pieces shared by the tools: input shapes, plain-language errors, and how pictures go back into the chat.
import { z } from 'zod';
import { LoginStop } from '../engine/login.mjs';
import { CaptureStop } from '../engine/site.mjs';

export const target = z.union([
  z.string(),
  z.object({
    text: z.string().optional(),
    near: z.enum(['top', 'bottom']).optional(),
    label: z.string().optional(),
    href: z.string().optional().describe('a link by its address, e.g. "/vendors"'),
    x: z.number().optional().describe('a point on the screen in CSS px (with y), e.g. from read_page or a numbered capture'),
    y: z.number().optional(),
    css: z.string().optional(),
  }),
]);

export const step = z
  .record(z.any())
  .describe(
    'One action, e.g. {"scroll_to": "Calculate"}, {"scroll": 600}, {"scroll": "bottom", "seconds": 3}, {"tap": "Calculate"}, {"tap": {"text": "Categories", "near": "bottom"}}, {"tap": {"href": "/vendors"}} (a link, also a picture or icon link), {"tap": {"x": 317, "y": 30}} (a point on the screen), {"fill": {"field": "Search", "value": "lehenga"}} (typed key by key), {"set": {"field": "Purchase Price (MRP)", "value": 50000}} (sliders and number fields), {"press": "Enter"}, {"wait": 1}, {"wait_for": {"text": "Result"}}, {"wait_for": {"url": "/vendors", "max": 5}} (fails fast if the page doesn\'t go there), {"mark": "result-shown"}. Each tap reports what it did (went to a page, or nothing changed).',
  );

export const common = {
  site: z.string().optional().describe('Which site (from status). Leave out for the first one.'),
  page: z.string().describe('A page name from status (e.g. "rental price calculator"), a path like "/calculators", or a full URL on the site.'),
  project: z.string().optional().describe('The piece of work this is for, e.g. "Calculator carousel". Everything for it is kept together in one folder.'),
  name: z.string().optional().describe('A short name to refer to this capture later, e.g. "calc-result".'),
  device: z.enum(['phone', 'desktop']).optional().describe('phone (default) or desktop.'),
  quality: z.enum(['preview', 'high']).optional().describe('preview (default): small and fast, to look and choose. high: full resolution, for the final design.'),
  logged_in: z.boolean().optional().describe('true for pages behind the login (uses the signed-in demo account).'),
  notch: z
    .boolean()
    .optional()
    .describe('phone: keep the empty bands a real phone leaves for its notch (top, 59 px) and home bar (bottom, 34 px). Only when your phone frame draws a notch or status bar over the screen. Default: the screen runs edge to edge, no empty bands.'),
};

// a plain answer for what went wrong; a failed step also brings a picture of the screen at that moment
export const fail = (e) => {
  const known = e instanceof CaptureStop || e instanceof LoginStop;
  if (!known) console.error('[marketing-studio]', e);
  const words = known ? e.message : `Something went wrong: ${String(e?.message ?? e).split('\n')[0]}`;
  return { content: [{ type: 'text', text: words }, ...(e?.shot ? [{ type: 'image', data: e.shot.toString('base64'), mimeType: 'image/jpeg' }] : [])], isError: true };
};

export const text = (t) => ({ type: 'text', text: t });
