// brand: everything Claude needs to design on brand: colours, gradients, fonts, logos and patterns (with the names to
// use in designs), the rules and the claims never to make, plus a picture of the logos and colours.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { exportImages, getBrand, prepare } from '../engine/exporter.mjs';
import { imageItem, shrink } from '../engine/imaging.mjs';
import { openProject } from '../engine/project.mjs';
import { D } from '../paths.mjs';
import { fail, text } from './common.mjs';

const board = (b) => {
  const sw = Object.entries(b.colors ?? {})
    .map(([k, c]) => `<div class="sw"><i style="background:${c.hex}"></i><b>${k}</b><span>${c.hex}</span></div>`)
    .join('');
  const logos = Object.entries(b.logos ?? {})
    .map(([k, l]) => `<div class="lg ${l.ground === 'dark' ? 'dark' : ''}"><img src="brand:${k}"><span>brand:${k}</span></div>`)
    .join('');
  const fonts = (b.fonts ?? []).map((f) => `<div class="ft" style="font-family:'${f.family}'">${f.family === 'Arya' ? b.tagline?.text ?? 'अनोखी रीत' : `${f.family} Aa 123`}<span>${f.use}</span></div>`).join('');
  return `<style>body{background:#FFF2DF;font-family:Inter;padding:28px;box-sizing:border-box;color:#1A1A1A}h1{font:700 30px Inter;margin:0 0 18px;color:#890304}
  .row{display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px}.sw{width:150px;font-size:13px}.sw i{display:block;height:44px;border-radius:8px;border:1px solid #0002;margin-bottom:4px}.sw span{display:block;color:#767676}
  .lg{width:200px;height:110px;background:#fff;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-size:12px;color:#767676}.lg.dark{background:linear-gradient(135deg,#9A0000,#5D0000);color:#E8E5C3}
  .lg img{max-width:170px;max-height:62px}.ft{font-size:34px;margin:4px 0}.ft span{font:13px Inter;color:#767676;margin-left:14px}</style>
  <h1>${b.name}: colours, logos, fonts</h1><div class="row">${sw}</div><div class="row">${logos}</div>${fonts}`;
};

export function registerBrand(server) {
  server.registerTool(
    'brand',
    {
      title: 'Brand guide',
      description: 'The brand to design with: colours and gradients, fonts (already loaded in exports), logos and patterns with the names to use (brand:<name>), sizes, rules, and claims never to make. Read it before designing. Includes a picture of the logos and colours.',
      inputSchema: { brand: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ brand: id }) => {
      try {
        const b = getBrand(id);
        const lines = [
          `${b.name}: ${b.about ?? ''}`,
          b.tagline ? `Tagline: ${b.tagline.text} (${b.tagline.note ?? ''})` : '',
          `Colours: ${Object.entries(b.colors ?? {}).map(([k, c]) => `${k} ${c.hex} (${c.use})`).join('; ')}`,
          `Gradients (CSS): ${Object.entries(b.gradients ?? {}).map(([k, g]) => `${k}: ${g.css}${g.use ? ` (${g.use})` : ''}`).join('; ')}`,
          `Fonts (use by name; already loaded in exports): ${(b.fonts ?? []).map((f) => `'${f.family}' ${f.weights}: ${f.use}`).join('; ')}`,
          `Logos: ${Object.entries(b.logos ?? {}).map(([k, l]) => `brand:${k} (${l.use})`).join('; ')}`,
          `Patterns: ${Object.entries(b.patterns ?? {}).map(([k, l]) => `brand:${k} (${l.use})`).join('; ')}`,
          'Single-colour SVG logos can be recoloured: brand:wordmark?color=red (a colour name above or a hex).',
          `Sizes: ${Object.entries(b.sizes ?? {}).map(([k, [w, h]]) => `${k} ${w}x${h}`).join(', ')}`,
          `Rules:\n${(b.rules ?? []).map((r) => `- ${r}`).join('\n')}`,
          `Never say: ${(b.never_say ?? []).map((r) => r.why).join(' ')}`,
        ].filter(Boolean);
        // the brand board, made with the exporter itself and kept until brand.json changes
        const version = crypto.createHash('sha1').update(fs.readFileSync(path.join(b.dir, 'brand.json'))).digest('hex').slice(0, 10);
        const cache = path.join(D.tmp, `brand-board-${b.id}-${version}.png`);
        if (!fs.existsSync(cache)) {
          const p = openProject(`_brand-${b.id}`);
          const { pages } = prepare(p, b, [board(b)], { width: 1100, height: 900 });
          const { files } = await exportImages({ project: p, brand: b, pages, width: 1100, height: 900, outDir: D.tmp });
          fs.renameSync(files[0].file, cache);
          fs.rmSync(p.dir, { recursive: true, force: true });
        }
        const pic = await shrink(fs.readFileSync(cache), { max: 1100, quality: 80 });
        return { content: [text(lines.join('\n')), imageItem(pic.buf)] };
      } catch (e) {
        return fail(e);
      }
    },
  );
}
