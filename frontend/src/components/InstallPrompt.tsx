import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!deferredPrompt || dismissed) return null

  const handleInstall = async () => {
    await deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted' || outcome === 'dismissed') {
      setDeferredPrompt(null)
      setDismissed(true)
    }
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 lg:bottom-auto lg:top-24 lg:right-4 lg:left-auto lg:translate-x-0 z-50 flex items-center gap-3 bg-onyx-deep/90 border border-amber-gold/40 px-4 py-2 shadow-2xl backdrop-blur-md">
      <span className="material-symbols-outlined text-amber-gold text-sm">install_mobile</span>
      <span className="text-xs font-mono text-zinc-300 uppercase tracking-wider">Install Vertex app</span>
      <button
        onClick={handleInstall}
        className="text-xs font-mono font-bold uppercase tracking-wider text-amber-gold hover:text-amber-300 transition-colors"
      >
        Install
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="text-zinc-500 hover:text-zinc-300 transition-colors ml-1"
        aria-label="Dismiss"
      >
        <span className="material-symbols-outlined text-sm">close</span>
      </button>
    </div>
  )
}
