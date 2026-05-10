import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminApp from './AdminApp'
import './index.css'
import { getUserRole } from './auth'

const isAdmin = window.location.pathname.startsWith('/admin')

if (isAdmin && getUserRole() !== 'admin') {
  window.location.replace('/')
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    {isAdmin ? <AdminApp /> : <App />}
  </React.StrictMode>
)

// Hide loader when React has mounted
setTimeout(() => {
  const loader = document.getElementById('loader')
  if (loader) {
    loader.classList.add('hidden')
  }
}, 100)
