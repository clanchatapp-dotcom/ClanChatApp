import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@livekit/components-styles'
import App from './App'
import { AuthProvider } from './lib/auth'
import { initGoogle } from './lib/nativeGoogle'
import './index.css'

initGoogle().catch(() => {})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
