# Reels, Stories and Shorts (9:16 video)

## Size and length

- **1080x1920**, 30 fps for the final (60 only for fast scrolling screens).
- **7-15 s** for one punchy idea, **20-35 s** for an explainer. Rarely over 45 s: every second must earn its place.

## The first two seconds

- The hook is on screen in the very first frame: a bold line (3-7 words) and the most interesting visual, usually
  the result. No logo intro, no fade from black, no slow build.
- A question, a surprising before/after, or the payoff first ("Your bookings, sorted in one tap").

## Pace

- Something changes every 1-2 s: a new line of text, a zoom, a cut, a highlight.
- But let people read: hold each line about 0.3 s per word plus half a second.
- Moves are eased (`cubic-bezier(.65,0,.35,1)` or similar), 0.5-0.9 s long, then a hold. Text lands on the cut.
- No spinning, no 3D gimmicks, no swish sounds.

## Text on screen (most people watch muted)

- Every key message is on screen as text, 3-7 words a line, one or two lines at a time.
- 48-72 px bold, never under 40 px; cream/white on maroon or dark on cream; a soft panel behind text over a screen.

## Safe zones

The app's own buttons and caption cover parts of the frame. Keep text and key screen details out of:

- the top 270 px (header),
- the bottom 350-420 px (caption, name, audio),
- the right 150 px in the lower half (like, comment, share).

The middle 1080x1350 is the safest area, and it's also what the profile grid shows as the cover. The check flags text
in these zones.

## Screens: fill the frame and zoom

A phone screen and a 9:16 frame are almost the same shape, so use it: the screen can fill the frame at about 2.4x its
phone size, then zoom further into the detail. A small phone floating in the middle with empty sides can't be read
(the check flags screens under 1.6x). See screens.md for the zoom recipe.

## A shape that works for an explainer

1. Hook (0-2 s): the promise and the result.
2. Problem (2-5 s): one line the viewer recognises.
3. The feature in 2-4 beats: one zoom per beat, the exact thing highlighted, a short line of text each.
4. Payoff: the result again, bigger.
5. End card (about 2 s): one action and the wordmark (and store badges when inviting downloads).

An ending that flows back into the first frame makes people watch twice.

## Timing to a voiceover

inbox info gives the spoken parts: start each scene on its line, put the text on screen as the words are said, and
keep music simple under speech.

## Before you export

check with the moments you care about in `at` (the hook, each zoom, the end card). Fix what it reports. Then export the
preview once; the person presses "HD version" in the viewer when they're happy, or asks you for changes.
