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
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-zinc-900 border border-amber-500/40 rounded-lg px-4 py-2 shadow-lg">
      <span className="material-symbols-outlined text-amber-400 text-sm">install_mobile</span>
      <span className="text-xs text-zinc-300">Install Vertex app</span>
      <button
        onClick={handleInstall}
        className="text-xs font-semibold text-amber-400 hover:text-amber-300 transition-colors"
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
