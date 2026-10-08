# Change Log — 2026-10-08

Picks up after `change_log_2026-10-07.md` (committed as `48ed641`).

---

## 1. Login page — white brand panel with an animated "North Star" background

Request: an animated moving-dots effect like the hero on smith.langchain.com,
first trialled on the coach sidebar and then moved to the login screen only.
The final version is a background on the login page's left brand panel.
Faint curved lines sweep in from the panel's left and bottom edges and
converge on one glowing gold North Star in the top-right corner, and round
dots glide along the lines into it. The metaphor is "many starting points,
one North Star", which is what a coach helps a client find.

**New component** — `frontend/src/components/NorthStarFlow.tsx`:
- Single `<canvas>` that fills its positioned parent and is resized via
  `ResizeObserver`. It is DPR-aware, so it stays crisp on retina screens.
- It draws 11 cubic-Bézier paths (6 start on the left edge and 5 on the
  bottom edge) that end at the North Star (`STAR = {x: .86, y: .09}`, as
  fractions of the panel). Three round dots run along each path at
  arc-length-uniform speed. Each dot is gold or blue, with a soft halo, and
  fades in at the start and out on arrival. The star "breathes" (gently
  pulses in size) and also flares each time a dot arrives. Faint stardust
  drifts down behind everything.
- Purely decorative: `aria-hidden`, `pointer-events: none`. Under
  `prefers-reduced-motion` it draws one still frame and never starts the
  animation loop.
- Frame time is clamped (`dt ≤ 0.1s`) so dots don't jump after a tab switch.
  `cancelAnimationFrame` and `ResizeObserver.disconnect` run on unmount.
- Uses the existing brand colours (`--navy`, `--gold`, `--gold-light`) as RGB
  constants, so the effect matches the rest of the UI.

**Wiring** — `frontend/src/pages/auth/Login.tsx`:
- The old static "connected-network" SVG motif in the brand panel was
  removed and replaced with `<NorthStarFlow className="auth-flow-canvas" />`
  as the panel's first child.
- The brand panel gets an `auth-brand--light` modifier class and the form
  panel gets `auth-form-area--light`.

**Styles** — `frontend/src/index.css` (new block just before `.auth-form-area`):
- `.auth-brand--light` sets a white background with a `--border` right edge.
  It also hides the dark panel's `::before`/`::after` radial glows and
  recolours the text for a light background: navy logo and headline, gold
  sub-label and *elevated*, `--muted` body copy, `--ink-soft` feature list.
- `.auth-flow-canvas` is absolutely positioned (`inset: 0`, `z-index: 0`).
  The panel's other children are lifted to `z-index: 1` so text always sits
  above the animation.
- `.auth-form-area.auth-form-area--light` makes the form side white too, so
  the two halves match. The compound selector is deliberate: the base
  `.auth-form-area` rule is defined later in the file and would otherwise
  win at equal specificity.

**Scope**
- **Login only.** Register, Forgot Password, Reset Password and Accept Invite
  share the same `auth-brand` panel. They don't use the new modifier classes,
  so they keep the original navy panel unchanged.
- The coach sidebar was trialled and then reverted. It is untouched in the
  final diff.
- On mobile (≤768px) the brand panel is already `display: none`, so the
  animation never renders there.

### Iterations tried and dropped (for context)

These are recorded so they aren't re-proposed without the reason they were
dropped:
- **Hourglass with falling sand:** dropped because it read as "time running
  out", the wrong message for coaching, and looked like clip-art next to the
  serif branding.
- **Big Dipper, 7 stars leading to Polaris:** three placements were tried.
  Drawn across the whole panel, it crossed the headline and bullets. Moved
  into the empty middle of the page, it floated unanchored and needed the
  form pushed to the far right. Squeezed into the gap between the logo and
  the headline, it was too small on laptop heights.
- **Dots rising from each feature bullet up the margin to a star:** clear of
  the text, but not preferred over the converging-lines background.

**Known trade-off:** the converging lines and dots pass behind the headline
and feature text, because this is a background effect. They are kept faint
(line alpha `.10`) so the text stays readable. If that ever looks too busy,
the simplest fix is to lower that alpha or mask the canvas under the
`.auth-brand-content` block.

**Verified locally**
- `npx tsc --noEmit` passes.
- Rendered `/login` against the local Vite dev server in headless Chrome at
  1470×860 and 1280×800. The panel is white, the form is centred on white,
  the lines converge on the star, and the text is readable.
- Not yet checked by hand in a real browser across the full animation cycle,
  or under `prefers-reduced-motion`. Worth a quick look before deploying.
- Not deployed. Ship with `make deploy-frontend` (see `CLAUDE.md` §8). There
  are no backend changes.
