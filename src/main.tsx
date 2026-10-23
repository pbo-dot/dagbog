import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { readSharedText } from './lib/conversation'
import { applyTheme, getTheme } from './screens/Settings.tsx'

applyTheme(getTheme())
readSharedText()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
