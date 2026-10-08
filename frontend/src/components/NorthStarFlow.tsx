import { useEffect, useRef } from 'react'

// Login background (coach + client-portal login), in the spirit of smith.langchain.com's
// hero. Each chain of dots makes a two-leg journey:
//   1. from the bottom-left corner into one of the feature bullets — a perspective fan:
//      lines and dots start large and close (with soft out-of-focus bokeh in the corner)
//      and shrink as they recede toward the bullet's number, which lights up on arrival;
//   2. it passes behind the bullet text, re-emerges at the end of the line, and flows across
//      the gutter — growing again as it comes toward you — into the card, converging on the
//      gold North Star that sits next to the card's title (`FlowStar`), which pulses.
//
// Laid out around the real page: the canvas measures the elements marked `data-flow-in`
// (bullet numbers), `data-flow-source` (bullet texts, same order), `data-flow-target` (the
// card) and `data-flow-star`, so nothing crosses the copy or the form at any size. Hidden on
// the stacked mobile layout. Fills its positioned parent (the whole page); purely
// decorative — pointer-events off, and a single static frame under prefers-reduced-motion.

const NAVY = '26,47,78'       // --navy
const GOLD = '184,146,46'     // --gold
const GOLD_L = '212,176,106'  // --gold-light
const BLUE = '122,167,224'

const CHAINS = 7
const CHAIN_LINKS = 3
const LINK_GAP = 13   // px between dots in a chain
const SPEED = 85      // px/sec

// Depth: scale of dots/lines along each leg (near = big, far = small).
const NEAR = 2.1      // at the corner
const FAR = 0.9       // at the bullets
const CARD = 1.6      // arriving at the card

export type Pt = { x: number; y: number }
export type Line = { pts: Pt[]; len: number[]; total: number }
type Route = { a: Line; b: Line }      // corner → bullet, bullet → card
type Chain = { route: number; d: number; rgb: string; wait: number }

export function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  return {
    x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
  }
}

export function build(p0: Pt, c1: Pt, c2: Pt, p3: Pt): Line {
  const pts: Pt[] = [p0]
  const len = [0]
  for (let k = 1; k <= 80; k++) {
    const p = cubic(p0, c1, c2, p3, k / 80)
    const q = pts[pts.length - 1]
    len.push(len[len.length - 1] + Math.hypot(p.x - q.x, p.y - q.y))
    pts.push(p)
  }
  return { pts, len, total: len[len.length - 1] }
}

// Horizontal-in, horizontal-out S-curve between two points.
const sCurve = (p0: Pt, p1: Pt) => {
  const span = p1.x - p0.x
  return build(p0, { x: p0.x + span * 0.5, y: p0.y }, { x: p1.x - span * 0.45, y: p1.y }, p1)
}

export function pointAt(p: Line, d: number): Pt {
  if (d <= 0) return p.pts[0]
  let lo = 0, hi = p.len.length - 1
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (p.len[m] < d) lo = m + 1; else hi = m
  }
  const i = Math.max(1, lo)
  const f = (d - p.len[i - 1]) / (p.len[i] - p.len[i - 1] || 1)
  return { x: p.pts[i - 1].x + (p.pts[i].x - p.pts[i - 1].x) * f, y: p.pts[i - 1].y + (p.pts[i].y - p.pts[i - 1].y) * f }
}

export function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rgb: string, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, `rgba(${rgb},${a})`)
  g.addColorStop(1, `rgba(${rgb},0)`)
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
}

// Stroke a line in short pieces so its width and alpha can taper with depth.
function taper(ctx: CanvasRenderingContext2D, l: Line, rgb: (t: number) => string, width: (t: number) => number) {
  const n = l.pts.length - 1
  const pieces = 16
  for (let s = 0; s < pieces; s++) {
    const i0 = Math.floor((s / pieces) * n), i1 = Math.floor(((s + 1) / pieces) * n)
    const t = (s + 0.5) / pieces
    ctx.beginPath()
    ctx.moveTo(l.pts[i0].x, l.pts[i0].y)
    for (let k = i0 + 1; k <= i1; k++) ctx.lineTo(l.pts[k].x, l.pts[k].y)
    ctx.lineWidth = width(t)
    ctx.strokeStyle = rgb(t)
    ctx.stroke()
  }
}

export default function NorthStarFlow({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    const page = parent?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !parent || !page || !ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const inEls = Array.from(page.querySelectorAll<HTMLElement>('[data-flow-in]'))
    const outEls = Array.from(page.querySelectorAll<HTMLElement>('[data-flow-source]'))
    const targetEl = page.querySelector<HTMLElement>('[data-flow-target]')
    const starEl = page.querySelector<HTMLElement>('[data-flow-star]')
    let W = 0, H = 0
    let routes: Route[] = []
    let entry: Pt = { x: 0, y: 0 }
    let arrive = 0
    let lit: number[] = []    // per-bullet glow as a chain passes through it
    let time = 0
    let bokeh: { x: number; y: number; r: number; rgb: string; ph: number }[] = []

    const chains: Chain[] = Array.from({ length: CHAINS }, (_, i) => ({
      route: 0, d: 0, rgb: i % 3 === 2 ? BLUE : GOLD, wait: 0,
    }))
    let seeded = false

    const pulseStar = () => {
      starEl?.animate?.(
        [
          { transform: 'scale(1)', filter: 'drop-shadow(0 0 4px rgba(212,176,106,.5))' },
          { transform: 'scale(1.35)', filter: 'drop-shadow(0 0 12px rgba(212,176,106,.95))' },
          { transform: 'scale(1)', filter: 'drop-shadow(0 0 4px rgba(212,176,106,.5))' },
        ],
        { duration: 650, easing: 'ease-out' },
      )
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      W = parent.clientWidth
      H = parent.clientHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const pr = parent.getBoundingClientRect()
      const cr = targetEl?.getBoundingClientRect()
      const sr = starEl?.getBoundingClientRect()
      const n = Math.min(inEls.length, outEls.length)
      // Side-by-side layout only — on the stacked mobile layout the text sits above the card.
      if (W < 900 || !cr || !cr.width || !n) { routes = []; draw(); return }

      const starY = sr && sr.height ? sr.top + sr.height / 2 - pr.top : cr.top - pr.top + 60
      entry = { x: cr.left - pr.left, y: starY }
      routes = []
      for (let i = 0; i < n; i++) {
        const ri = inEls[i].getBoundingClientRect()
        const ro = outEls[i].getBoundingClientRect()
        const into = { x: ri.left - pr.left - 12, y: ri.top + ri.height / 2 - pr.top }
        const out = { x: ro.right - pr.left + 14, y: ro.top + ro.height / 2 - pr.top }
        // corner fan: top bullet ← highest start on the left edge, lower ones come up from
        // below the bottom-left corner, so the lines never cross
        const f = n > 1 ? i / (n - 1) : 0
        const start = { x: -W * 0.03 + f * W * 0.04, y: H * (0.74 + f * 0.34) }
        routes.push({ a: sCurve(start, into), b: sCurve(out, entry) })
      }
      lit = routes.map(() => 0)
      bokeh = [
        { x: W * 0.02, y: H * 0.96, r: 90, rgb: GOLD_L, ph: 0 },
        { x: W * 0.09, y: H * 0.88, r: 54, rgb: BLUE, ph: 1.7 },
        { x: W * 0.04, y: H * 0.78, r: 40, rgb: GOLD_L, ph: 3.1 },
        { x: W * 0.14, y: H * 0.99, r: 64, rgb: BLUE, ph: 4.4 },
      ]

      if (!seeded) {
        seeded = true
        // spread chains out so the first (and the reduced-motion) frame already reads
        chains.forEach((c, i) => {
          c.route = i % routes.length
          const r = routes[c.route]
          c.d = ((i + 0.5) / chains.length) * (r.a.total + r.b.total)
        })
      }
      draw()
    }

    // Where a chain link is: which leg, the point, and its depth scale.
    const locate = (r: Route, d: number) => {
      if (d < r.a.total) {
        const t = d / r.a.total
        return { leg: 0, p: pointAt(r.a, d), s: NEAR + (FAR - NEAR) * t, t }
      }
      const t = (d - r.a.total) / r.b.total
      return { leg: 1, p: pointAt(r.b, d - r.a.total), s: FAR + (CARD - FAR) * t, t }
    }

    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      if (!routes.length) return

      // out-of-focus foreground in the corner
      for (const b of bokeh) {
        const dx = Math.sin(time * 0.3 + b.ph) * 8, dy = Math.cos(time * 0.25 + b.ph) * 6
        glow(ctx, b.x + dx, b.y + dy, b.r, b.rgb, 0.16)
      }

      // corner → bullets: thick and brighter up close, thin as they recede
      for (const r of routes) {
        taper(ctx, r.a, (t) => `rgba(${NAVY},${0.2 - t * 0.1})`, (t) => 2.4 - t * 1.5)
      }
      // bullets → card: thin again, warming to gold as they come toward you
      for (const r of routes) {
        taper(ctx, r.b, (t) => `rgba(${t > 0.5 ? GOLD : NAVY},${0.1 + t * 0.42})`, (t) => 0.9 + t * 0.5)
      }

      // bullet in/out nodes
      routes.forEach((r, i) => {
        for (const p of [r.a.pts[r.a.pts.length - 1], r.b.pts[0]]) {
          if (lit[i] > 0.02) glow(ctx, p.x, p.y, 14, GOLD_L, 0.5 * lit[i])
          ctx.fillStyle = `rgba(${GOLD},${0.45 + 0.5 * lit[i]})`
          ctx.beginPath(); ctx.arc(p.x, p.y, 2.2, 0, Math.PI * 2); ctx.fill()
        }
      })

      // chains of dots
      for (const c of chains) {
        if (c.wait > 0) continue
        const r = routes[c.route]
        const total = r.a.total + r.b.total
        const links = []
        for (let i = 0; i < CHAIN_LINKS; i++) {
          const d = c.d - i * LINK_GAP
          if (d < 0 || d > total) continue
          const at = locate(r, d)
          const legLen = at.leg === 0 ? r.a.total : r.b.total
          const legD = at.leg === 0 ? d : d - r.a.total
          // fade in/out at each leg's ends (it "passes behind" the bullet text)
          links.push({ ...at, i, a: Math.min(1, legD / 22, (legLen - legD) / 16) })
        }
        if (!links.length) continue
        for (let k = 1; k < links.length; k++) {
          const p = links[k - 1], q = links[k]
          if (p.leg !== q.leg) continue
          ctx.lineWidth = 1.1 * p.s
          ctx.strokeStyle = `rgba(${c.rgb},${0.45 * Math.min(p.a, q.a)})`
          ctx.beginPath(); ctx.moveTo(p.p.x, p.p.y); ctx.lineTo(q.p.x, q.p.y); ctx.stroke()
        }
        for (const l of links) {
          const r0 = (l.i === 0 ? 2.1 : 1.7 - l.i * 0.25) * l.s
          if (l.i === 0) glow(ctx, l.p.x, l.p.y, r0 * 5, c.rgb, 0.32 * l.a)
          ctx.fillStyle = `rgba(${c.rgb},${(l.i === 0 ? 0.95 : 0.7 - l.i * 0.15) * l.a})`
          ctx.beginPath(); ctx.arc(l.p.x, l.p.y, r0, 0, Math.PI * 2); ctx.fill()
        }
      }

      // glow where the streams meet the card edge (the card covers its inner half)
      glow(ctx, entry.x, entry.y, 26 + arrive * 14, GOLD_L, 0.3 + 0.4 * arrive)
    }

    const step = (dt: number) => {
      time += dt
      arrive = Math.max(0, arrive - dt * 1.6)
      lit = lit.map((e) => Math.max(0, e - dt * 1.2))
      if (!routes.length) return
      for (const c of chains) {
        if (c.wait > 0) { c.wait -= dt; continue }
        const r = routes[c.route]
        const before = c.d
        c.d += SPEED * dt
        if (before < r.a.total && c.d >= r.a.total) lit[c.route] = 1   // reached its bullet
        if (c.d - (CHAIN_LINKS - 1) * LINK_GAP > r.a.total + r.b.total) {
          arrive = 1
          pulseStar()
          c.route = Math.floor(Math.random() * routes.length)
          c.d = 0
          c.wait = 0.3 + Math.random() * 2
        }
      }
    }

    const ro = new ResizeObserver(resize)
    ro.observe(parent)
    if (targetEl) ro.observe(targetEl)
    outEls.forEach((el) => ro.observe(el))
    resize()

    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1) // clamp after tab switches
      last = now
      step(dt)
      draw()
      raf = requestAnimationFrame(tick)
    }
    if (!reduceMotion) raf = requestAnimationFrame(tick)

    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />
}

// The North Star that sits inside the card, next to its title — the streams converge on it.
export function FlowStar() {
  return (
    <span className="flow-star" data-flow-star aria-hidden="true">
      <svg viewBox="-12 -12 24 24" width="100%" height="100%">
        <path d="M0,-11 Q3,-3 11,0 Q3,3 0,11 Q-3,3 -11,0 Q-3,-3 0,-11Z" fill="currentColor" />
      </svg>
    </span>
  )
}
