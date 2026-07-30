import { useRef, useEffect, useState } from 'react'

/** Simple draw-to-sign canvas. Not a legally-captured e-signature — just an image
 * of whatever was drawn, exported as a PNG data URL via onChange. */
export default function SignaturePad({ value, onChange }: { value: string; onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const hasStroke = useRef(false)
  const [empty, setEmpty] = useState(!value)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.strokeStyle = '#1a1714'
    if (value) {
      const img = new Image()
      img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      img.src = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const point = 'touches' in e ? e.touches[0] : e
    return { x: point.clientX - rect.left, y: point.clientY - rect.top }
  }

  const start = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current?.getContext('2d')
    const { x, y } = pos(e)
    ctx?.beginPath()
    ctx?.moveTo(x, y)
  }

  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current?.getContext('2d')
    const { x, y } = pos(e)
    ctx?.lineTo(x, y)
    ctx?.stroke()
    hasStroke.current = true
    setEmpty(false)
  }

  const end = () => {
    if (!drawing.current) return
    drawing.current = false
    if (hasStroke.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL('image/png'))
    }
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
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
