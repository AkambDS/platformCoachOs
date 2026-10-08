import { useEffect, useRef } from 'react'
import { build, glow, pointAt, type Line, type Pt } from './NorthStarFlow'

// Client-portal login background, modelled closely on smith.langchain.com's hero: thin
// curves sweep in from the whole left edge and converge at one point — the start of the
// short gold rule under the intro paragraph — then continue as a single straight gold
// line along that rule, through the gap between the paragraph and the bullets, with
// glowing nodes on it, before curving up into the gold North Star next to the card's title
// (`FlowStar`, marked `data-flow-star`), which pulses as each chain of dots arrives.
//
// Laid out around the real page: the canvas measures `data-flow-rule` (the gold rule),
// `data-flow-target` (the card) and `data-flow-star`. Hidden on the stacked mobile layout.
// Fills its positioned parent (the whole page); purely decorative — pointer-events off,
// and a single static frame under prefers-reduced-motion.

const NAVY = '26,47,78'       // --navy
const GOLD = '184,146,46'     // --gold
const GOLD_L = '212,176,106'  // --gold-light
const BLUE = '122,167,224'

const PER_FAN = 2       // chains flowing along each left-edge line at once (fade out at the hub)
const TRUNK_CHAINS = 3  // separate chains carrying on along the gold line into the star
const CHAIN_LINKS = 3
const LINK_GAP = 13   // px between dots in a chain
const SPEED = 42      // px/sec — slow, steady drift rather than a busy swarm

// Fan start points (page fractions), spread down the whole left edge.
const STARTS = [
  { x: -0.02, y: -0.04 }, { x: -0.02, y: 0.1 }, { x: -0.02, y: 0.24 }, { x: -0.02, y: 0.38 },
  { x: -0.02, y: 0.62 }, { x: -0.02, y: 0.76 }, { x: -0.02, y: 0.9 }, { x: -0.02, y: 1.04 },
]
// Static glowing nodes along the straight gold line (fractions of its length).
const NODES = [0.18, 0.42, 0.66, 0.9]

type Chain = { fan: number; d: number; rgb: string; wait: number }   // fan = -1 → gold-line chain

const straight = (a: Pt, b: Pt) =>
  build(a, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, { x: a.x + (b.x - a.x) * 2 / 3, y: a.y + (b.y - a.y) * 2 / 3 }, b)

function join(...parts: Line[]): Line {
  const pts: Pt[] = [parts[0].pts[0]]
  const len = [0]
  for (const p of parts) {
    for (let k = 1; k < p.pts.length; k++) {
      pts.push(p.pts[k])
      len.push(len[len.length - 1] + (p.len[k] - p.len[k - 1]))
    }
  }
  return { pts, len, total: len[len.length - 1] }
}

function stroke(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y)
  ctx.stroke()
}

export default function GoldenThreadFlow({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    const page = parent?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !parent || !page || !ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ruleEl = page.querySelector<HTMLElement>('[data-flow-rule]')
    const targetEl = page.querySelector<HTMLElement>('[data-flow-target]')
    const starEl = page.querySelector<HTMLElement>('[data-flow-star]')
    let W = 0, H = 0
    let fans: Line[] = []
    let trunk: Line | null = null
    let straightLen = 0
    let entry: Pt = { x: 0, y: 0 }
    let arrive = 0
    let time = 0

    // Every left-edge line owns its own chains (they merge — fade out — at the hub), so each
    // row always has dots flowing; the gold line has its own chains running on into the star.
    const chains: Chain[] = [
      ...Array.from({ length: STARTS.length * PER_FAN }, (_, i) => ({
        fan: i % STARTS.length, d: 0, rgb: i % 3 === 2 ? BLUE : GOLD, wait: 0,
      })),
      ...Array.from({ length: TRUNK_CHAINS }, (_, i) => ({
        fan: -1, d: 0, rgb: i % 2 ? BLUE : GOLD, wait: 0,
      })),
    ]
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
      const rr = ruleEl?.getBoundingClientRect()
      const cr = targetEl?.getBoundingClientRect()
      const sr = starEl?.getBoundingClientRect()
      // Side-by-side layout only — on the stacked mobile layout the text sits above the card.
      if (W < 900 || !rr || !rr.width || !cr || !cr.width) { trunk = null; draw(); return }

      const hub = { x: rr.left - pr.left, y: rr.top + rr.height / 2 - pr.top }
      entry = {
        x: cr.left - pr.left,
        y: sr && sr.height ? sr.top + sr.height / 2 - pr.top : cr.top - pr.top + 60,
      }
      // straight gold line along the rule to the gutter, then up into the card at the star
      const turn = { x: entry.x - Math.min(150, (entry.x - hub.x) * 0.3), y: hub.y }
      const line = straight(hub, turn)
      straightLen = line.total
      const span = entry.x - turn.x
      trunk = join(line, build(turn, { x: turn.x + span * 0.6, y: turn.y }, { x: entry.x - span * 0.55, y: entry.y }, entry))

      // fan: each curve arrives at the hub horizontally, so it flows straight into the line
      fans = STARTS.map((s) => {
        const p0 = { x: W * s.x, y: H * s.y }
        return build(p0, { x: p0.x + hub.x * 0.45, y: p0.y }, { x: hub.x - hub.x * 0.42, y: hub.y }, hub)
      })

      if (!seeded) {
        seeded = true
        // stagger chains evenly along their own path, offset per line so rows don't move
        // in lockstep — the first frame already shows every row flowing
        let k = 0
        chains.forEach((c, i) => {
          if (c.fan < 0) { c.d = ((k++ + 0.5) / TRUNK_CHAINS) * trunk!.total; return }
          const slot = Math.floor(i / STARTS.length)
          const jitter = ((c.fan * 0.37) % 1) / PER_FAN
          c.d = ((slot / PER_FAN + jitter) % 1) * fans[c.fan].total
        })
      }
      draw()
    }

    const pathOf = (c: Chain): Line => (c.fan < 0 ? trunk! : fans[c.fan])
    const chainPoint = (c: Chain, d: number): Pt => pointAt(pathOf(c), d)

    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      if (!trunk) return

      // fan — thin, faint
      ctx.lineWidth = 1
      ctx.strokeStyle = `rgba(${NAVY},.13)`
      for (const f of fans) stroke(ctx, f.pts)

      // the gold line: soft halo under a crisp gold stroke
      ctx.lineWidth = 6
      ctx.strokeStyle = `rgba(${GOLD_L},.12)`
      stroke(ctx, trunk.pts)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = `rgba(${GOLD},.7)`
      stroke(ctx, trunk.pts)

      // static glowing nodes on the straight section
      NODES.forEach((f, i) => {
        const p = pointAt(trunk!, straightLen * f)
        const breathe = 0.7 + 0.3 * Math.sin(time * 1.3 + i * 1.4)
        glow(ctx, p.x, p.y, 28, i % 2 ? BLUE : GOLD_L, 0.22 * breathe)
        ctx.fillStyle = `rgba(${i % 2 ? BLUE : GOLD},.95)`
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = 'rgba(255,255,255,.85)'
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.4, 0, Math.PI * 2); ctx.fill()
      })

      // chains of dots
      for (const c of chains) {
        if (c.wait > 0) continue
        const total = pathOf(c).total
        const pts: Pt[] = []
        const alphas: number[] = []
        for (let i = 0; i < CHAIN_LINKS; i++) {
          const d = c.d - i * LINK_GAP
          if (d < 0 || d > total) continue
          pts.push(chainPoint(c, d))
          alphas.push(Math.min(1, d / 40, (total - d) / 18))
        }
        if (!pts.length) continue
        if (pts.length > 1) {
          ctx.lineWidth = 1.6
          ctx.strokeStyle = `rgba(${c.rgb},${0.45 * alphas[0]})`
          stroke(ctx, pts)
        }
        pts.forEach((p, i) => {
          const a = alphas[i]
          if (i === 0) glow(ctx, p.x, p.y, 14, c.rgb, 0.35 * a)
          ctx.fillStyle = `rgba(${c.rgb},${(i === 0 ? 0.95 : 0.7 - i * 0.15) * a})`
          ctx.beginPath(); ctx.arc(p.x, p.y, i === 0 ? 3.2 : 2.5 - i * 0.3, 0, Math.PI * 2); ctx.fill()
        })
      }

      // glow where the line meets the card edge (the card covers its inner half)
      glow(ctx, entry.x, entry.y, 26 + arrive * 14, GOLD_L, 0.3 + 0.4 * arrive)
    }

    const step = (dt: number) => {
      time += dt
      arrive = Math.max(0, arrive - dt * 1.6)
      if (!trunk) return
      for (const c of chains) {
        if (c.wait > 0) { c.wait -= dt; continue }
        c.d += SPEED * dt
        if (c.d - (CHAIN_LINKS - 1) * LINK_GAP > pathOf(c).total) {
          if (c.fan < 0) { arrive = 1; pulseStar() }   // a gold-line chain reached the star
          c.d = 0          // restart on its own path, no pause, so it keeps flowing
          c.wait = 0
        }
      }
    }

    const ro = new ResizeObserver(resize)
    ro.observe(parent)
    if (targetEl) ro.observe(targetEl)
    if (ruleEl?.parentElement) ro.observe(ruleEl.parentElement)
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
