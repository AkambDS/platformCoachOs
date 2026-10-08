import { useEffect, useRef } from 'react'

// Login brand-panel background: gently curved paths sweep in from the left and bottom
// edges and converge on a small glowing North Star near the top-right, with round
// glowing dots travelling along them (in the spirit of smith.langchain.com's hero).
// Metaphor: many starting points, one North Star — what a coach helps a client find.
// Fills its positioned parent; purely decorative — pointer-events off, and a single
// static frame under prefers-reduced-motion.

const NAVY = '26,47,78'       // --navy
const GOLD = '184,146,46'     // --gold
const GOLD_L = '212,176,106'  // --gold-light
const BLUE = '122,167,224'

const SAMPLES = 120
const STAR = { x: 0.86, y: 0.09 }  // North Star, as a fraction of the panel

// Start points as panel fractions: down the left edge, then along the bottom edge.
const STARTS = [
  { x: -0.02, y: 0.08 }, { x: -0.02, y: 0.26 }, { x: -0.02, y: 0.44 }, { x: -0.02, y: 0.62 },
  { x: -0.02, y: 0.8 },  { x: -0.02, y: 0.96 }, { x: 0.14, y: 1.02 },  { x: 0.32, y: 1.02 },
  { x: 0.5, y: 1.02 },   { x: 0.68, y: 1.02 },  { x: 0.86, y: 1.02 },
]

type Pt = { x: number; y: number }
type Path = { pts: Pt[]; len: number[]; total: number }
type Dot = { path: number; dist: number; speed: number; rgb: string; r: number }
type Mote = { x: number; y: number; vx: number; vy: number; r: number; rgb: string; a: number; ph: number }

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t
  return {
    x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
    y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
  }
}

function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const k = r * 0.28
  ctx.beginPath()
  ctx.moveTo(x, y - r)
  ctx.quadraticCurveTo(x + k, y - k, x + r, y)
  ctx.quadraticCurveTo(x + k, y + k, x, y + r)
  ctx.quadraticCurveTo(x - k, y + k, x - r, y)
  ctx.quadraticCurveTo(x - k, y - k, x, y - r)
  ctx.closePath()
  ctx.fill()
}

export default function NorthStarFlow({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !parent || !ctx) return

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let W = 0, H = 0
    let star: Pt = { x: 0, y: 0 }
    let paths: Path[] = []
    let motes: Mote[] = []
    let time = 0
    let pulse = 0

    // dist is stored as a 0..1 fraction so dots survive resizes
    const dots: Dot[] = []
    STARTS.forEach((_, i) => {
      for (let k = 0; k < 3; k++) {
        dots.push({
          path: i,
          dist: Math.random(),
          speed: 45 + Math.random() * 35,           // px/sec
          rgb: Math.random() < 0.7 ? GOLD : BLUE,
          r: 2 + Math.random() * 1.2,
        })
      }
    })

    const newMote = (anywhere: boolean): Mote => ({
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : -6,
      vx: (Math.random() - 0.5) * 6,
      vy: 6 + Math.random() * 12,
      r: 0.8 + Math.random() * 1.4,
      rgb: Math.random() < 0.5 ? GOLD_L : BLUE,
      a: 0.2 + Math.random() * 0.35,
      ph: Math.random() * 6.28,
    })

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      W = parent.clientWidth
      H = parent.clientHeight
      canvas.width = W * dpr
      canvas.height = H * dpr
      canvas.style.width = `${W}px`
      canvas.style.height = `${H}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      star = { x: W * STAR.x, y: H * STAR.y }
      paths = STARTS.map((s, i) => {
        const p0 = { x: W * s.x, y: H * s.y }
        // sweep out along the start edge first, then bend up/over into the star,
        // fanning the control points so the curves stay apart until they converge
        const fromLeft = s.x < 0
        const f = i / (STARTS.length - 1)
        const c1 = fromLeft
          ? { x: W * (0.3 + 0.25 * f), y: p0.y + H * 0.05 }
          : { x: p0.x + W * 0.05, y: H * (0.55 + 0.15 * f) }
        const c2 = { x: star.x - W * (0.32 - 0.18 * f), y: star.y + H * (0.05 + 0.25 * f) }
        const pts: Pt[] = []
        for (let k = 0; k <= SAMPLES; k++) pts.push(cubic(p0, c1, c2, star, k / SAMPLES))
        const len = [0]
        for (let k = 1; k < pts.length; k++) {
          len.push(len[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y))
        }
        return { pts, len, total: len[len.length - 1] }
      })
      motes = Array.from({ length: Math.round((W * H) / 5000) }, () => newMote(true))
      draw()
    }

    const pointAt = (p: Path, d: number): Pt => {
      let lo = 0, hi = p.len.length - 1
      while (lo < hi) {
        const m = (lo + hi) >> 1
        if (p.len[m] < d) lo = m + 1; else hi = m
      }
      const i = Math.max(1, lo)
      const f = (d - p.len[i - 1]) / (p.len[i] - p.len[i - 1] || 1)
      return { x: p.pts[i - 1].x + (p.pts[i].x - p.pts[i - 1].x) * f, y: p.pts[i - 1].y + (p.pts[i].y - p.pts[i - 1].y) * f }
    }

    const draw = () => {
      ctx.clearRect(0, 0, W, H)

      // stardust drifting down
      for (const m of motes) {
        const a = m.a * (0.55 + 0.45 * Math.sin(time * 1.5 + m.ph))
        ctx.fillStyle = `rgba(${m.rgb},${a})`
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill()
      }

      // paths
      ctx.lineWidth = 1
      ctx.strokeStyle = `rgba(${NAVY},.10)`
      for (const p of paths) {
        ctx.beginPath()
        ctx.moveTo(p.pts[0].x, p.pts[0].y)
        for (let k = 1; k < p.pts.length; k++) ctx.lineTo(p.pts[k].x, p.pts[k].y)
        ctx.stroke()
      }

      // round dots travelling toward the star (fade out as they arrive)
      for (const d of dots) {
        const p = paths[d.path]
        if (!p) continue
        const at = pointAt(p, d.dist * p.total)
        const fade = Math.min(1, d.dist * 12, (1 - d.dist) * 8)
        const halo = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, d.r * 5)
        halo.addColorStop(0, `rgba(${d.rgb},${0.35 * fade})`)
        halo.addColorStop(1, `rgba(${d.rgb},0)`)
        ctx.fillStyle = halo
        ctx.beginPath(); ctx.arc(at.x, at.y, d.r * 5, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = `rgba(${d.rgb},${0.9 * fade})`
        ctx.beginPath(); ctx.arc(at.x, at.y, d.r, 0, Math.PI * 2); ctx.fill()
      }

      // the North Star
      const breathe = 0.92 + 0.08 * Math.sin(time * 1.4)
      const glowR = 30 + pulse * 16
      const glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, glowR)
      glow.addColorStop(0, `rgba(${GOLD_L},${0.45 + pulse * 0.3})`)
      glow.addColorStop(1, `rgba(${GOLD_L},0)`)
      ctx.fillStyle = glow
      ctx.beginPath(); ctx.arc(star.x, star.y, glowR, 0, Math.PI * 2); ctx.fill()
      ctx.save()
      ctx.translate(star.x, star.y); ctx.rotate(Math.PI / 4)
      ctx.fillStyle = `rgba(${GOLD_L},.55)`
      sparkle(ctx, 0, 0, 9 * breathe)
      ctx.restore()
      ctx.fillStyle = `rgba(${GOLD},1)`
      sparkle(ctx, star.x, star.y, 14 * breathe)
      ctx.fillStyle = 'rgba(255,255,255,.9)'
      ctx.beginPath(); ctx.arc(star.x, star.y, 1.8, 0, Math.PI * 2); ctx.fill()
    }

    const step = (dt: number) => {
      time += dt
      pulse = Math.max(0, pulse - dt * 1.5)
      for (const m of motes) {
        m.x += m.vx * dt
        m.y += m.vy * dt
        if (m.y > H + 6) Object.assign(m, newMote(false))
      }
      for (const d of dots) {
        const p = paths[d.path]
        if (!p) continue
        d.dist += (d.speed * dt) / p.total
        if (d.dist >= 1) { d.dist -= 1; pulse = Math.min(1, pulse + 0.35) }  // arrived at the star
      }
    }

    const ro = new ResizeObserver(resize)
    ro.observe(parent)
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
