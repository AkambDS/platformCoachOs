import { useRef, useEffect, useState } from 'react'

/** Simple draw-to-sign canvas. Not a legally-captured e-signature — just an image
 * of whatever was drawn, exported as a PNG data URL via onChange. */
export default function SignaturePad({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasStroke = useRef(false)
  const points = useRef<{ x: number; y: number }[]>([])
  const [empty, setEmpty] = useState(!value)

  const drawBaseline = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    ctx.save()
    ctx.strokeStyle = '#e3ddd3'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(12, canvas.height - 20)
    ctx.lineTo(canvas.width - 12, canvas.height - 20)
    ctx.stroke()
    ctx.restore()
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.lineWidth = 2.4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1a1714'
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      img.src = value
    } else {
      drawBaseline(ctx, canvas)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const point = 'touches' in e ? e.touches[0] : e
    // The canvas's drawing buffer (320×110, set via the width/height attributes below)
    // is stretched via CSS to fill whatever width the container gives it — often much
    // wider than 320px. getBoundingClientRect() reports the STRETCHED size, so without
    // rescaling here the stroke gets drawn off from wherever the cursor actually is
    // (worse the wider the container), which is what read as "laggy"/unusable.
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return { x: (point.clientX - rect.left) * scaleX, y: (point.clientY - rect.top) * scaleY }
  }

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current?.getContext('2d')
    const p = pos(e)
    points.current = [p]
    ctx?.beginPath()
    ctx?.moveTo(p.x, p.y)
  }

  // Straight lineTo() per raw mouse-move point looks jagged/angular since mousemove
  // fires at a coarser rate than the cursor actually travels — quadratic-curving
  // through the midpoint of each new pair of points (the standard signature-pad
  // smoothing technique) renders a natural, fluid stroke from the same input instead.
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = pos(e)
    points.current.push(p)
    const len = points.current.length
    if (len >= 3) {
      const prev = points.current[len - 2]
      const xc = (p.x + prev.x) / 2
      const yc = (p.y + prev.y) / 2
      ctx.quadraticCurveTo(prev.x, prev.y, xc, yc)
    } else {
      ctx.lineTo(p.x, p.y)
    }
    ctx.stroke()
    hasStroke.current = true
    setEmpty(false)
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    points.current = []
    if (hasStroke.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL('image/png'))
    }
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      drawBaseline(ctx, canvas)
    }
    hasStroke.current = false
    setEmpty(true)
    onChange('')
  }

  return (
    <div>
      <div style={{ position: 'relative', border: '1px solid var(--border)', borderRadius: 6, background: '#fff' }}>
        <canvas
          ref={canvasRef}
          width={320}
          height={110}
          style={{ display: 'block', width: '100%', height: 110, cursor: 'crosshair', touchAction: 'none' }}
          onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}
        />
        {empty && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontSize: 12, pointerEvents: 'none' }}>
            Draw your signature here
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
        <button type="button" onClick={clear} className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '3px 8px' }}>
          Clear
        </button>
      </div>
    </div>
  )
}
