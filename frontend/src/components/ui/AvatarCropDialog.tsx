// src/components/ui/AvatarCropDialog.tsx — SP-15-28
//
// Shared crop/reposition UX for the profile avatar, used by both
// Profile.tsx and Onboarding.tsx. Pure interaction/UI layer only — all
// geometry math lives in utils/avatarCrop.ts (independently unit-tested)
// and the export re-encode reuses mediaCompress.ts's own quality/format
// policy via exportCroppedAvatar. Opens already showing the automatic
// centered cover-fit framing (Section 7) — saving without touching
// anything is a fully valid, sensible flow.
import { useEffect, useRef, useState } from 'react'
import { m as motion, AnimatePresence } from 'framer-motion'
import {
  loadWorkingImage, defaultCropState, panCropState, zoomCropState, coverScale,
  exportCroppedAvatar, MIN_ZOOM, MAX_ZOOM,
  type WorkingImage, type CropState,
} from '../../utils/avatarCrop'
import { useT } from '../../i18n/useT'

const VIEWPORT = 280

interface AvatarCropDialogProps {
  // Caller is responsible for classifyAvatarFile()/size checks first — this
  // dialog assumes it was only ever opened with a crop-eligible file.
  file: File
  onCancel: () => void
  onCropped: (file: File) => void
}

export default function AvatarCropDialog({ file, onCancel, onCropped }: AvatarCropDialogProps) {
  const t = useT()
  const [working, setWorking] = useState<WorkingImage | null>(null)
  const [crop, setCrop] = useState<CropState>(defaultCropState())
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadWorkingImage(file).then(w => {
      if (cancelled) { w.bitmap.close(); return }
      setWorking(w)
    }).catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [file])

  // Paints the working bitmap once at its natural (already memory-bounded)
  // resolution; positioning/zoom afterward is a cheap CSS transform, not a
  // redraw — the canvas itself never needs to change per pan/zoom frame.
  useEffect(() => {
    if (!working || !canvasRef.current) return
    const canvas = canvasRef.current
    canvas.width = working.natural.width
    canvas.height = working.natural.height
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(working.bitmap, 0, 0)
    return () => { working.bitmap.close() }
  }, [working])

  function canvasTransform(): string {
    if (!working) return ''
    const scale = coverScale(working.natural, VIEWPORT) * crop.zoom
    const x = (VIEWPORT - working.natural.width * scale) / 2 + crop.offsetX
    const y = (VIEWPORT - working.natural.height * scale) / 2 + crop.offsetY
    return `translate(${x}px, ${y}px) scale(${scale})`
  }

  function handlePointerDown(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId)
    dragRef.current = { x: e.clientX, y: e.clientY }
  }
  function handlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !working) return
    const dx = e.clientX - dragRef.current.x
    const dy = e.clientY - dragRef.current.y
    dragRef.current = { x: e.clientX, y: e.clientY }
    setCrop(c => panCropState(working.natural, VIEWPORT, c, dx, dy))
  }
  function handlePointerUp() { dragRef.current = null }

  function handleZoom(e: React.ChangeEvent<HTMLInputElement>) {
    if (!working) return
    setCrop(c => zoomCropState(working.natural, VIEWPORT, c, Number(e.target.value)))
  }

  function handleReset() { setCrop(defaultCropState()) }

  async function handleSave() {
    if (!working || saving) return
    setSaving(true)
    try {
      const cropped = await exportCroppedAvatar(working, VIEWPORT, crop, 'avatar')
      onCropped(cropped)
    } catch {
      setLoadError(true)
      setSaving(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        data-testid="avatar-crop-dialog"
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, backdropFilter: 'blur(4px)' }}>
        <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
          style={{ width: '100%', maxWidth: 360, background: 'var(--white)', borderRadius: 20, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>

          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', alignSelf: 'flex-start' }}>{t('avatarCrop.title')}</div>

          {loadError && (
            <div style={{ padding: '32px 8px', textAlign: 'center', color: 'var(--text4)', fontSize: 13 }}>{t('avatarCrop.error')}</div>
          )}

          {!loadError && !working && (
            <div style={{ width: VIEWPORT, height: VIEWPORT, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text4)', fontSize: 13 }}>
              {t('avatarCrop.loading')}
            </div>
          )}

          {!loadError && working && (
            <>
              <div
                data-testid="avatar-crop-viewport"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                style={{ width: VIEWPORT, height: VIEWPORT, borderRadius: '50%', overflow: 'hidden', position: 'relative', background: 'var(--bg2)', cursor: 'grab', touchAction: 'none', boxShadow: '0 0 0 2000px rgba(0,0,0,0.35)' }}>
                <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, transformOrigin: '0 0', transform: canvasTransform() }} />
              </div>

              <input type="range" aria-label={t('avatarCrop.zoom')} data-testid="avatar-crop-zoom"
                min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={crop.zoom} onChange={handleZoom}
                style={{ width: '100%' }} />

              <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                <button type="button" onClick={handleReset} data-testid="avatar-crop-reset"
                  style={{ padding: '10px 16px', borderRadius: 10, background: 'transparent', border: '1.5px solid var(--border)', color: 'var(--text3)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {t('avatarCrop.reset')}
                </button>
                <button type="button" onClick={onCancel} data-testid="avatar-crop-cancel"
                  style={{ flex: 1, padding: '10px 16px', borderRadius: 10, background: 'transparent', border: 'none', color: 'var(--text4)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {t('avatarCrop.cancel')}
                </button>
                <button type="button" onClick={handleSave} disabled={saving} data-testid="avatar-crop-save"
                  style={{ flex: 1, padding: '10px 16px', borderRadius: 10, background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', border: 'none', fontSize: 13, fontWeight: 700, cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? t('avatarCrop.saving') : t('avatarCrop.save')}
                </button>
              </div>
            </>
          )}

          {loadError && (
            <button type="button" onClick={onCancel} style={{ padding: '10px 20px', borderRadius: 10, background: 'var(--bg2)', border: 'none', color: 'var(--text3)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
              {t('avatarCrop.cancel')}
            </button>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
