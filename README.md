# Marketing Studio

A Claude desktop extension for making marketing pieces (social posts, carousels, short explainer videos) from real
app and website screens, in a normal Claude chat. Claude does the creative work (idea, copy, design, motion); this
extension is its camera and export button:

- **capture**: screenshots and screen recordings of a site, also behind a login, a quick low-quality look first,
  then high quality;
- **inbox**: voiceovers and music people supply, with their length and speech pauses;
- **export**: Claude's own designs turned into finished PNG and MP4 files with the real screens in them.

Everything runs and is saved on each laptop (`Documents/Marketing Studio/`). It works with any brand or site: a
site profile (`sites/`) says how to reach and sign in to a site, a brand pack (`brands/`) holds the look and voice.

## Status

Phase 0: the extension installs and answers `status`. Capturing, recordings and exporting come next.

## Build and install

```bash
npm install
npm run check     # starts the server like Claude Desktop does and calls its tools
npm run build     # dist/marketing-studio-<version>.mcpb
```

Install: double-click the `.mcpb` (or Claude Desktop → Settings → Extensions → Advanced settings → Install
Extension…). For a Team, an owner uploads it once in the admin settings.
