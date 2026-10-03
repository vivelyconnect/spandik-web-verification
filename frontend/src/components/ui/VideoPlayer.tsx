// src/components/ui/VideoPlayer.tsx
import { useState, useRef, useEffect } from 'react'
import { m as motion } from 'framer-motion'
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react'
import { useT } from '../../i18n/useT'

interface VideoPlayerProps {
  src: string
  poster?: string | null
  style?: React.CSSProperties
}

export default function VideoPlayer({ src, poster, style }: VideoPlayerProps) {
  const t = useT()
  const ref          = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying]   = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume]     = useState(1)
  const [muted, setMuted]       = useState(true) // muted autoplay
  const [showControls, setShowControls] = useState(true)
  const hideTimer  = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const v = ref.current
    if (!v) return
    const onTime = () => setProgress(v.currentTime)
    const onLoad = () => setDuration(v.duration)
    const onEnd  = () => setPlaying(false)
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('loadedmetadata', onLoad)
    v.addEventListener('ended', onEnd)
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('loadedmetadata', onLoad)
      v.removeEventListener('ended', onEnd)
    }
  }, [])

  function togglePlay() {
    const v = ref.current
    if (!v) return
    if (playing) { v.pause(); setPlaying(false) }
    else { v.play(); setPlaying(true) }
    showControlsTemporarily()
  }

  function showControlsTemporarily() {
    setShowControls(true)
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setPlaying(p => { if (p) setShowControls(false); return p }), 3000)
  }

  function seek(e: React.MouseEvent<HTMLDivElement>) {
    const v   = ref.current
    if (!v || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct  = (e.clientX - rect.left) / rect.width
    v.currentTime = pct * duration
    setProgress(pct * duration)
  }

  function toggleMute() {
    const v = ref.current
    if (!v) return
    v.muted = !muted
    setMuted(!muted)
  }

  function toggleFullscreen() {
    const v = ref.current
    if (!v) return
    if (document.fullscreenElement) document.exitFullscreen()
    else v.requestFullscreen?.()
  }

  function fmt(s: number): string {
    const m = Math.floor(s / 60)
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`
  }

  const pct = duration ? (progress / duration) * 100 : 0

  return (
    <div
      style={{ position: 'relative', background: '#000', overflow: 'hidden', ...style }}
      onMouseMove={showControlsTemporarily}
      onClick={togglePlay}
    >
      <video
        ref={ref}
        src={src}
        poster={poster || undefined}
        muted={muted}
        playsInline
        style={{ width: '100%', display: 'block', maxHeight: 400, objectFit: 'contain' }}
      />

      {/* Play/pause overlay */}
      {!playing && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'rgba(0,0,0,0.3)',
        }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'rgba(255,255,255,0.9)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22,
          }}>▶</div>
        </div>
      )}

      {/* Controls bar */}
      <motion.div
        animate={{ opacity: showControls || !playing ? 1 : 0 }}
        transition={{ duration: 0.3 }}
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
          padding: '24px 12px 10px',
        }}
      >
        {/* Progress bar */}
        <div
          onClick={seek}
          style={{
            height: 3, background: 'rgba(255,255,255,0.3)',
            borderRadius: 2, cursor: 'pointer', marginBottom: 8,
            position: 'relative',
          }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--brand)', borderRadius: 2, position: 'relative' }}>
            <div style={{ position: 'absolute', right: -5, top: -4, width: 11, height: 11, borderRadius: '50%', background: '#fff', boxShadow: '0 0 4px rgba(0,0,0,0.5)' }} />
          </div>
        </div>

        {/* Buttons row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={togglePlay} style={ctrlBtn} aria-label={playing ? t('media.pause') : t('media.play')}>{playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}</button>
          <button onClick={toggleMute} style={ctrlBtn} aria-label={muted ? t('media.unmute') : t('media.mute')}>{muted ? <VolumeX size={18} aria-hidden /> : <Volume2 size={18} aria-hidden />}</button>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', flex: 1 }}>
            {fmt(progress)} / {fmt(duration)}
          </span>
          <button onClick={toggleFullscreen} style={ctrlBtn} aria-label={t('media.fullscreen')}><Maximize size={18} aria-hidden /></button>
        </div>
      </motion.div>
    </div>
  )
}

const ctrlBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  fontSize: 16, color: '#fff', padding: 0, minWidth: 44, minHeight: 44,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
