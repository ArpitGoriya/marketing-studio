# App screens: capture them clean, show them big

## Capturing

- Plan the shots first, from the agreed idea: which screen, which state, which 1-3 things must be readable. Use
  read_page to look around, not screenshots.
- Phone captures run **edge to edge**: no empty band at the top or bottom. Use `notch: true` only when your phone
  frame draws a notch or status bar over the top of the screen (it leaves the room a real phone keeps).
- Use `find` for the things you'll zoom to or highlight: you get their positions on the picture.
- Use `crop` to take just one card or section: it's sharper and easier to show big than a whole screen.
- Several shots of the same page go in one capture call (`shots`). Preview first, then "high" for the ones you use.

## How big is big enough

A phone shows a 1080-wide post or video about 390 points wide, so everything shrinks to about a third. App text
(about 14 px on the phone) stays readable only when the screen is shown at **2x its phone size or more** in a
1080-wide frame. A whole phone screen at 2x is about 790x1700 px: nearly the full height of a 9:16 frame. That's the
right size.

- **Video:** fill the frame. Let the phone frame's edges run off the sides if needed. Show the whole phone only
  briefly (1-1.5 s) for context, then zoom into the part that matters (2.5-3.5x) and move with the story.
- **Carousel:** the screen takes 55-60% or more of the slide height, or crop to the card and show it at 2x+.
- The check reports every screen shown under 1.3x (slides) or 1.6x (video), with how small its text reads.

## The zoom recipe (CSS)

Put the capture (or the phone frame holding it) inside a camera layer and move the layer, so a point (x, y) on the
capture lands in the middle of the frame at scale s:

```html
<style>
  /* the screen drawn 786 px wide = 2x a 393-pt phone; the layer's scale multiplies that (1.5 -> 3x) */
  .cam { position: absolute; left: 0; top: 0; transform-origin: 0 0; animation: cam 6s cubic-bezier(.65,0,.35,1) both; }
  .cam img { width: 786px; display: block; }
  /* frame 1080x1920; layer point (x, y) to the centre at scale s: translate(540 - x*s, 960 - y*s) scale(s) */
  @keyframes cam {
    0%, 20%   { transform: translate(147px, 108px) scale(1); }    /* the whole screen at 2x, for context */
    35%, 65%  { transform: translate(-50px, 330px) scale(1.5); }  /* point (393, 420): the profit card at 3x */
    80%, 100% { transform: translate(-50px, -990px) scale(1.5); } /* point (393, 1300): the reminder at 3x */
  }
</style>
<div class="cam"><img src="capture:tracker-home"></div>
```

- One move at a time, then hold for at least 1.2 s so people can read.
- `find` positions are in the picture's own pixels. A "high" phone capture is 3x the phone (1179 px wide), so when
  the screen is drawn 786 px wide, multiply them by 786/1179 to get layer points.
- Highlight what the zoom lands on (a soft gold ring that fades in after the move), and put one short line of text
  near it, inside the safe zones.

## Phone frames

- A thin rounded black bezel (corner radius about 12% of its width) with a soft maroon-tinted shadow. No notch
  unless you captured with `notch: true`.
- For close-ups, drop the frame: show the cropped card on its own with a soft shadow.
- Never stretch a screen; scale it evenly.
