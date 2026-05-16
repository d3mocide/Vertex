import { SystemEvent, MeshMessage } from './store'

let swReg: ServiceWorkerRegistration | null = null

const NOTIFY_SEVERITIES = new Set(['critical', 'high'])

export async function initNotifications(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  if (!import.meta.env.PROD) return
  if (!(window.isSecureContext || location.hostname === 'localhost')) return
  try {
    swReg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  } catch {
    // SW unavailable (e.g. non-HTTPS dev env) — direct Notification API used as fallback
  }
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!('Notification' in window)) return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export async function maybeNotify(event: SystemEvent): Promise<void> {
  if (!NOTIFY_SEVERITIES.has(event.severity)) return
  if (!('Notification' in window) || Notification.permission !== 'granted') return

  const title = event.event_type.replace(/_/g, ' ').toUpperCase()
  const options: NotificationOptions = {
    body: event.summary,
    tag: event.event_type,
    requireInteraction: event.severity === 'critical',
    silent: false,
  }

  if (swReg) {
    await swReg.showNotification(title, options)
  } else {
    new Notification(title, options)
  }
}

export async function notifyMeshMessage(msg: MeshMessage): Promise<void> {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (msg.outgoing) return

  const sender = (msg.sender_name || 'UNKNOWN').toUpperCase()
  const body = msg.text || '(empty message)'
  const title = `MESH: ${sender}`
  const options: NotificationOptions = {
    body,
    tag: 'mesh_message',
    silent: false,
  }

  if (swReg) {
    await swReg.showNotification(title, options)
  } else {
    new Notification(title, options)
  }
}
