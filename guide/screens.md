# App screens: capture them clean, show them big, zoom rarely

## Capturing and recording

- Plan from the agreed storyboard: which screen, which state, which action. Use read_page to look around, not
  screenshots. If you can't tell which screen or flow the person means, ask.
- **For a video of how something works, record it** (record tool): the steps as the user does them, in order.
  Taps are filmed as a soft fingertip; the answer gives when and where each tap happened.
- **For a carousel or a still, capture** the screen in the state you need. Use `crop` for one card or section, and
  `find` for positions you want to point at.
- Phone screens run **edge to edge**: no empty band at the top or bottom. Use `notch: true` only when your phone
  frame draws a notch or status bar over the top of the screen.
- Preview first, then "high" for the ones you use. Several shots of one page go in one capture call (`shots`).

## How big

A phone shows a 1080-wide post or video about 390 points wide, so everything shrinks to about a third.

- **Video:** the phone frame whole and big, about **1.5x** its real size: 590x1280 px, which fills the space between
  the Reels safe zones. This is the normal shot for almost every scene.
- **Carousel:** the phone takes 55-60% or more of the slide height, or crop to the card that matters and show it
  large.
- The check flags only screens that are really small (under 1.15x in a video, 0.9x on a slide).

## Zoom: only for one detail, and gently

- Most videos need no zoom, or one or two. Zoom only where people must read something small (a result, a number, a
  message), and only after the action that produced it.
- Gently: about 1.4x the normal shot, one smooth 0.7-0.9 s move, hold 1.5-2 s, then back to the whole phone.
- Never zoom on every scene, never pan around the screen, never cut it into close-up fragments.

```html
<style>
  /* the phone at 1.5x (590 px wide), centred between the safe zones; one gentle zoom on the result and back */
  .cam { position: absolute; left: 0; top: 0; transform-origin: 0 0; animation: cam 9s cubic-bezier(.65,0,.35,1) both; }
  .phone { position: absolute; left: 245px; top: 288px; width: 590px; border-radius: 72px; overflow: hidden;
           box-shadow: 0 0 0 14px #111, 0 30px 80px rgba(74,0,2,.25); }
  .phone img { display: block; width: 100%; }
  /* layer point (x, y) to the frame's centre at scale s: translate(540 - x*s, 960 - y*s) scale(s) */
  @keyframes cam {
    0%, 55%   { transform: none; }                                   /* the whole phone: the flow plays */
    65%, 85%  { transform: translate(-216px, -269px) scale(1.4); }   /* the result card at (540, 878) */
    95%, 100% { transform: none; }                                   /* back to the whole phone */
  }
</style>
<div class="cam"><div class="phone"><img src="clip:add-booking" data-start="0"></div></div>
```

- `find` and tap positions come in the screen's own CSS px (393 wide for a phone); on a phone drawn 590 px wide,
  multiply them by 1.5 and add the phone's left/top to get layer points.

## Phone frames

- A thin rounded black bezel (corner radius about 12% of its width) with a soft maroon-tinted shadow. No notch
  unless you captured with `notch: true`.
- Keep the frame the same size and place for the whole video, so the eye can follow the flow.
- Never stretch a screen; scale it evenly.
