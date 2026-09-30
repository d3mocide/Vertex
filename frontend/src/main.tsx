import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminApp from './AdminApp'
import '@fontsource/inter/400.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/900.css'
import '@fontsource/roboto-mono/400.css'
import '@fontsource/roboto-mono/500.css'
import '@fontsource/roboto-mono/700.css'
import 'material-symbols/outlined.css'
import './index.css'
import { setSession } from './auth'
import { API_BASE } from './config'

const isAdmin = window.location.pathname.startsWith('/admin')

function AdminGate() {
  const [allowed, setAllowed] = React.useState(false)
  const [checked, setChecked] = React.useState(false)

  React.useEffect(() => {
    void fetch(API_BASE + "/auth/me")
      .then(async (response) => {
        if (!response.ok) throw new Error("Not authenticated")
        const profile = await response.json() as { username: string; role: "admin" | "viewer" }
        if (profile.role !== "admin") throw new Error("Admin role required")
        setSession(profile)
        setAllowed(true)
      })
      .catch(() => window.location.replace("/"))
      .finally(() => setChecked(true))
  }, [])

  if (!checked) return React.createElement("div", { className: "w-full h-full bg-onyx-black", "aria-label": "Checking administrator session" })
  return allowed ? React.createElement(AdminApp) : null
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    {isAdmin ? <AdminGate /> : <App />}
  </React.StrictMode>
)

// New deploys: the service worker precaches the app, so a launch runs the
// cached build while the new one installs in the background (sw.ts:
// skipWaiting + clientsClaim). Reload once when the new worker takes over,
// and look for an update whenever the app comes back to the foreground — an
// installed iPhone app resumes without reloading and could run an old build
// for days.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let reloaded = false
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return   // first install: nothing stale to replace
    reloaded = true
    window.location.reload()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.getRegistration().then((r) => r?.update()).catch(() => {})
    }
  })
}

// Hide loader when React has mounted
setTimeout(() => {
  const loader = document.getElementById('loader')
  if (loader) {
    loader.classList.add('hidden')
  }
}, 100)
