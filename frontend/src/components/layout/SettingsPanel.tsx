import { useEffect, useState } from 'react'
import { useCivicPick } from '../../store'
import { notificationPermission, requestNotificationPermission } from '../../notifications'
import { getUserRole, logout } from '../../auth'
import { ToggleRow } from './SettingsPrimitives'

export function SettingsPanel() {
  const { settingsOpen, setSettingsOpen, debugInsets, setDebugInsets } = useCivicPick('settingsOpen', 'setSettingsOpen', 'debugInsets', 'setDebugInsets')

  const [notifPermission, setNotifPermission] = useState(() => notificationPermission())
  const userRole = getUserRole()

  useEffect(() => {
    if (!settingsOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setSettingsOpen(false) }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [settingsOpen, setSettingsOpen])

  const handleNotifToggle = async () => {
    if (notifPermission === 'granted') return
    const granted = await requestNotificationPermission()
    setNotifPermission(granted ? 'granted' : 'denied')
  }

  if (!settingsOpen) return null

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Settings">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-onyx-black/60 backdrop-blur-sm"
        onClick={() => setSettingsOpen(false)}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="absolute right-0 top-0 bottom-0 w-72 pt-safe-chrome pb-safe bg-onyx-deep border-l border-white/10 flex flex-col shadow-[−8px_0_32px_rgba(0,0,0,0.6)]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="ms text-[18px] text-amber-gold" aria-hidden="true">settings</span>
            <span className="font-bold text-[11px] tracking-[0.2em] uppercase text-amber-gold">SETTINGS</span>
            <span className={`px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-widest border ${userRole === 'admin' ? 'border-amber-gold/40 text-amber-gold/70' : 'border-green-ais/40 text-green-ais/70'}`}>
              {userRole}
            </span>
          </div>
          <button
            onClick={() => setSettingsOpen(false)}
            className="text-on-surface-variant hover:text-amber-gold transition-colors p-1 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-gold"
            aria-label="Close settings"
          >
            <span className="ms text-[22px]">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto py-4 px-5 space-y-6">

          {/* Account — top */}
          <section>
            <h2 className="label-caps mb-3">Account</h2>
            <div className="space-y-3">
              <button
                onClick={() => { void logout().then(() => window.location.reload()) }}
                className="flex items-center gap-2 w-full py-2 px-3 border border-red-emergency/30 text-red-emergency/80 hover:bg-red-emergency/10 transition-colors text-[11px] font-bold uppercase tracking-widest"
              >
                <span className="ms text-[16px] leading-none">logout</span>
                Sign Out
              </button>
            </div>
          </section>

          {/* Admin console link — admin only. Health, users, feeds and alert
              rules all live there; this panel is for personal preferences. */}
          {userRole === 'admin' && (
            <section>
              <a
                href="/admin"
                className="flex items-center gap-3 w-full py-2.5 px-3 border border-amber-gold/30 text-amber-gold hover:bg-amber-gold/10 transition-colors"
              >
                <span className="ms text-[20px]" aria-hidden="true">admin_panel_settings</span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-widest">Admin console</span>
                  <span className="block text-[11px] text-on-surface-variant normal-case tracking-normal">Health, users, feeds, region, alert rules</span>
                </span>
                <span className="ms text-[16px]" aria-hidden="true">chevron_right</span>
              </a>
            </section>
          )}

          {/* Notifications */}
          {notifPermission !== 'unsupported' && (
            <section>
              <h2 className="label-caps mb-3">Notifications</h2>
              <div className="space-y-3">
                {notifPermission === 'denied' ? (
                  <p className="text-[11px] text-on-surface-variant leading-relaxed">
                    Notifications blocked by browser. Enable them in browser site settings.
                  </p>
                ) : (
                  <button
                    onClick={handleNotifToggle}
                    disabled={notifPermission === 'granted'}
                    className={`flex items-center gap-3 w-full text-left group ${notifPermission === 'granted' ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    <span className={`ms text-[18px] leading-none transition-colors ${notifPermission === 'granted' ? 'text-amber-gold' : 'text-on-surface-variant group-hover:text-on-surface'}`} aria-hidden="true">
                      notifications
                    </span>
                    <span className={`flex-1 font-bold text-[11px] tracking-widest uppercase transition-colors ${notifPermission === 'granted' ? 'text-on-surface' : 'text-on-surface-variant group-hover:text-on-surface'}`}>
                      {notifPermission === 'granted' ? 'Notifications On' : 'Enable Notifications'}
                    </span>
                    {notifPermission === 'granted' && (
                      <span className="ms text-[14px] text-amber-gold leading-none">check_circle</span>
                    )}
                  </button>
                )}
              </div>
            </section>
          )}

          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            Map layers, entity types and 3D terrain are on the map: use the Layers box beside Replay, Zones and Annotate.
          </p>

          {/* Developer tools — admin only */}
          {userRole === 'admin' && (
            <section>
              <h2 className="label-caps mb-3">Developer</h2>
              <div className="space-y-3">
                <ToggleRow
                  label="Debug Mode"
                  icon="bug_report"
                  checked={debugInsets}
                  onChange={setDebugInsets}
                />
              </div>
              <p className="mt-2 text-[11px] text-on-surface-variant leading-relaxed">
                Opens the developer tools: live frame stats and recording, scripted map test scenarios, GPU and scene info, WebSocket rates, and the safe-area / viewport layout inspector. Toggle off to close them.
              </p>
            </section>
          )}

        </div>
      </div>
    </div>
  )
}
