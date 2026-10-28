# Marketing Studio

A Claude desktop extension for making marketing pieces (social posts, carousels, short explainer videos) from real
app and website screens, in a normal Claude chat. **Claude does the creative work** (idea, copy, design, motion);
this extension is its camera and export button:

- **capture / record**: screenshots and frame-by-frame screen recordings of a site, also behind a login. A quick
  low-quality look comes first, then high quality. Nothing on the site is ever changed.
- **inbox**: voiceovers and music people supply, with their length and spoken parts for timing.
- **check**: renders Claude's design privately and reports what a phone viewer would trip over (badly wrapping
  headlines, tiny or cut-off text, screens too small to read, empty bands, text under the Reels buttons).
- **export**: Claude's own HTML designs become finished PNG slides and MP4 videos, with the real screens, the brand
  fonts and the mixed sound (a supplied track, or music Claude writes, played with real CC0 instruments). They show
  right in the chat (swipe through slides, play the video) with Copy, Copy all, Copy caption, HD version and
  Show-in-folder buttons.
- **guide**: best practices for carousels, Reels, readable screens, music and captions (also packed as a Claude
  skill).

Everything runs and is saved on each laptop (`Documents/Marketing Studio/`), using its own Chrome or Edge. It works
with any brand or site: a site profile (`sites/`) says how to reach and sign in to a site, and a brand pack
(`brands/`) holds the look and voice. Anokhi Reet is the first of each.

- Teammates: [docs/TEAM-GUIDE.md](docs/TEAM-GUIDE.md)
- Owner (roll-out, sign-in, safety, adding sites and brands): [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md)

```bash
npm install
npm run check    # starts the server like Claude Desktop does and calls status
npm run build    # dist/marketing-studio-<version>.mcpb
```
