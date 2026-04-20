import { useEffect, useRef, useState } from 'react'
import { useCivicStore } from '../../store'

const STREAM_URL = '/stream/radio.mp3'

export function AudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [loading, setLoading] = useState(false)
  const radio = useCivicStore((s) => s.radio)

  const toggle = async () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      el.src = ''
      setPlaying(false)
    } else {
      setLoading(true)
      el.src = STREAM_URL
      el.load()
      try {
        await el.play()
        setPlaying(true)
      } catch {
        setPlaying(false)
      } finally {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onError = () => { setPlaying(false); setLoading(false) }
    el.addEventListener('error', onError)
    return () => el.removeEventListener('error', onError)
  }, [])

  const isActive = radio?.state === 'call'
  const label = loading ? 'Connecting…' : playing ? '■ Stop' : '▶ P25 Radio'

  return (
    <div style={{
      position: 'absolute',
      bottom: 24,
      right: 10,
      background: 'rgba(15,15,25,0.92)',
      color: '#fff',
      borderRadius: 6,
      padding: '8px 12px',
      zIndex: 100,
      fontSize: 12,
      backdropFilter: 'blur(4px)',
      minWidth: 180,
    }}>
      {/* Active transmission indicator */}
      {isActive && (
        <div style={{
          marginBottom: 6,
          color: '#ff6b35',
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{
            display: 'inline-block',
            width: 8, height: 8,
            borderRadius: '50%',
            background: '#ff6b35',
            animation: 'blink 1s infinite',
          }} />
          ACTIVE
        </div>
      )}

      <button
        onClick={toggle}
        disabled={loading}
        style={{
          width: '100%',
          background: playing ? '#c0392b' : '#2980b9',
          color: '#fff',
          border: 'none',
          borderRadius: 4,
          padding: '5px 10px',
          cursor: loading ? 'wait' : 'pointer',
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        {label}
      </button>

      <audio ref={audioRef} preload="none" style={{ display: 'none' }} />

      <style>{`
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.2; }
        }
      `}</style>
    </div>
  )
}
