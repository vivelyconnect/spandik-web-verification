// src/components/ui/ImageViewer.tsx
// Fullscreen image viewer with pinch zoom, swipe to close
import { useState, useRef, useEffect } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

interface ImageViewerProps {
  images: string[]
  initialIndex?: number
  onClose: () => void
}

export default function ImageViewer({ images, initialIndex = 0, onClose }: ImageViewerProps) {
  const [index, setIndex]   = useState(initialIndex)
  const [scale, setScale]   = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const lastTap    = useRef(0)
  const pinchRef   = useRef<{ dist: number } | null>(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  function handleDoubleTap(e: React.MouseEvent) {
    const now = Date.now()
    if (now - lastTap.current < 300) {
      // Double tap — toggle zoom
      setScale(s => s === 1 ? 2.5 : 1)
      setOffset({ x: 0, y: 0 })
    }
    lastTap.current = now
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      pinchRef.current = { dist: Math.hypot(dx, dy) }
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current) {
      const dx   = e.touches[0].clientX - e.touches[1].clientX
      const dy   = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      const ratio = dist / pinchRef.current.dist
      setScale(s => Math.max(1, Math.min(4, s * ratio)))
      pinchRef.current = { dist }
    }
  }

  function handleTouchEnd() {
    pinchRef.current = null
    if (scale <= 1.05) {
      setScale(1)
      setOffset({ x: 0, y: 0 })
    }
  }

  function prev(e: React.MouseEvent) {
    e.stopPropagation()
    setIndex(i => (i - 1 + images.length) % images.length)
    setScale(1); setOffset({ x: 0, y: 0 })
  }

  function next(e: React.MouseEvent) {
    e.stopPropagation()
    setIndex(i => (i + 1) % images.length)
    setScale(1); setOffset({ x: 0, y: 0 })
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={scale === 1 ? onClose : undefined}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.96)',
          zIndex: 300,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          userSelect: 'none',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            width: 40, height: 40, borderRadius: '50%',
            background: 'rgba(255,255,255,0.15)',
            border: 'none', cursor: 'pointer',
            fontSize: 20, color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 10,
          }}
        ><X size={22} aria-hidden /></button>

        {/* Counter */}
        {images.length > 1 && (
          <div style={{
            position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.5)', color: '#fff',
            padding: '4px 12px', borderRadius: 99, fontSize: 13, fontWeight: 600,
          }}>
            {index + 1} / {images.length}
          </div>
        )}

        {/* Image */}
        <motion.img
          key={index}
          src={images[index]}
          alt=""
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.2 }}
          onClick={handleDoubleTap}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          style={{
            maxWidth: '95vw',
            maxHeight: '90vh',
            objectFit: 'contain',
            transform: `scale(${scale}) translate(${offset.x}px, ${offset.y}px)`,
            transition: pinchRef.current ? 'none' : 'transform 0.2s',
            cursor: scale > 1 ? 'grab' : 'zoom-in',
            borderRadius: 8,
          }}
        />

        {/* Nav arrows */}
        {images.length > 1 && (
          <>
            <button onClick={prev} style={navBtnStyle('left')}>‹</button>
            <button onClick={next} style={navBtnStyle('right')}>›</button>
          </>
        )}

        {/* Dot indicators */}
        {images.length > 1 && (
          <div style={{
            position: 'absolute', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: 6,
          }}>
            {images.map((_, i) => (
              <div key={i} style={{
                width: i === index ? 20 : 6, height: 6, borderRadius: 3,
                background: i === index ? '#fff' : 'rgba(255,255,255,0.4)',
                transition: 'all 0.2s',
              }} />
            ))}
          </div>
        )}

        {/* Double tap hint */}
        <div style={{
          position: 'absolute', bottom: 48, left: '50%', transform: 'translateX(-50%)',
          fontSize: 11, color: 'rgba(255,255,255,0.4)',
        }}>
          Double tap to zoom · Pinch to zoom
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

function navBtnStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    [side]: 12,
    top: '50%', transform: 'translateY(-50%)',
    width: 44, height: 44, borderRadius: '50%',
    background: 'rgba(255,255,255,0.15)',
    border: 'none', cursor: 'pointer',
    fontSize: 28, color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10,
  }
}
