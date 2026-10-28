# Marketing Studio: owner guide

## What it is

A Claude desktop extension (MCPB) that runs on each laptop. Claude designs the posts and videos itself; the
extension gives it twelve tools:

| Tool | What it does |
|---|---|
| `status` | What's ready: sites and pages, sign-in, brands, projects. |
| `brand` | The brand guide, plus a picture of the logos and colours. |
| `find_page` | Searches the site's live sitemap (and, when signed in, the account menu) once a day, so new pages are found without a new version. |
| `read_page` | A page as text (headings, buttons, fields), so Claude plans shots without exploring by screenshots. |
| `capture` | Screenshots, preview first, then high quality; several shots of one page per call. A crop by text grows to the card around it, with fixed bars hidden. |
| `record` | Frame-by-frame screen recordings. |
| `inbox` | Supplied audio and images. |
| `export` | Claude's HTML becomes PNG slides or an MP4 with the real screens and the sound mixed. The result shows in the chat (see below). |
| `show` | Shows an earlier export in the chat again. |
| `projects` | Earlier work. |
| `sign_in` | Check or redo the sign-in. |
| `wait` | Results of long jobs. |

Results show **in the chat** in a viewer (an MCP App): slides to swipe through or the video playing, with Copy (to
the clipboard, so it pastes into WhatsApp or Canva), Download and Show-in-folder buttons. It tells Claude which slide
is on screen, so "make this one shorter" works. The viewer is part of the extension and loads nothing from the
internet. Chat apps that can't show it get the old behaviour (pictures in the answer, the folder opens). The viewer
uses a few tools of its own (`viewer_*`) that Claude doesn't see.

Everything is made and saved on the laptop, with nothing hosted:
- It uses the laptop's own **Chrome or Edge**; video is encoded by the browser, so there's nothing to download. A
  Chromium download (about 100 MB, once) happens only if neither browser exists.
- Work goes to `Documents/Marketing Studio/`.
- The tool's own data (sign-ins, temp files) goes to `~/.marketing-studio/`.

## Roll out to the team

1. Build it: `npm install && npm run build` gives `dist/marketing-studio-<version>.mcpb`. Or download it from the
   repo's GitHub release.
2. In Claude, upload it as a custom extension in your **Team/Enterprise admin settings** (Desktop extensions →
   upload). Teammates then see it in **Settings → Extensions** and click Install.
3. Give teammates the **demo account code** (don't put it in this repo), which they type into the extension's
   settings, and the one-page `docs/TEAM-GUIDE.md`.

## Pages behind the login

- The site profile `sites/anokhireet.json` signs in to the demo account by itself, as a Supabase **test phone
  number** with a fixed code: it calls `verifyOtp` directly, with no SMS and no CAPTCHA. The session goes where the
  site's app keeps it (`localStorage.anokhi_reet_auth_token`).
- Each laptop has its own session, refreshed automatically.
- **Settings:** "Demo account phone number" (pre-filled with the test number) and "Demo account code" (stored as
  sensitive).
- Phone numbers and emails on logged-in pages are masked automatically.

> **Security: please fix.** The test number is the company's public support/WhatsApp number, and its fixed test
> code is very easy to guess. Anyone who tries it can sign in to that shop-owner account and change its listings.
>
> In Supabase → Authentication → Phone → test phone numbers, change the code to a random 6-digit number. Then
> update the website's E2E test code and the extension setting.
>
> Better still, use a separate number that isn't published anywhere.

## Safety on the site

- Every non-GET request is blocked, except the site profile's `allow_writes_to` reads (token refresh,
  `rpc/get_*`). Trackers, service workers and websockets are blocked too.
- A capture where any write got through is thrown away.
- Buttons in `never_press` (delete, pay, rent, contact, submit…) are never pressed.
- The maintenance page stops a capture.
- Requests carry `x-marketing-studio: 1`, so they're easy to spot in the site's logs.

## Adding a site or a brand

- **Site:** `sites/<id>.json`, the same shape as `anokhireet.json`:
  - `url`, named `pages`, `start_state` (localStorage), `device_css`;
  - `allow_writes_to`, `never_press`, `maintenance_path`;
  - `login`: `supabase-phone` for automatic sign-in, or `manual`, which opens a window for the person to sign in
    once per laptop.
- **Brand:** `brands/<id>/brand.json`:
  - colours, gradients, fonts (files in `fonts/`), logos (with `ground`), patterns, rules, `never_say` patterns, sizes;
  - the files themselves.
- Rebuild, then upload the new version in admin.

## Develop and test

```bash
npm install
npm run check                                   # start the server like Claude Desktop and call status
node scripts/try.mjs capture '{"page":"rental price calculator"}'   # call any tool; pictures go to build/try/
node scripts/try-viewer.mjs images              # the in-chat viewer in a stand-in chat host (also: video, final)
npm run build                                   # dist/marketing-studio-<version>.mcpb
```

Set `MS_OUTPUT_DIR` to keep test work out of Documents, `MS_DEMO_PHONE`/`MS_DEMO_CODE` for logged-in tests, and
`MS_NO_OPEN=1` to stop folders opening. `MS_JOB_WAIT=1` makes long jobs answer "still working" at once, to test
that path.

## Known limits

- Tested on Windows with Chrome and Edge. **Mac: not yet tested.** Expected to work (same browser APIs), but
  check on the first Mac.
- Claude Desktop may stop waiting on a single tool call after about a minute, so long recordings and videos run as
  jobs and Claude calls `wait`.
- Video export speed: about 5 s of work per second of 1080×1920 video at 30 fps, on this 8 GB laptop.
