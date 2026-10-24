import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { readSharedText } from './lib/conversation'
import { autoSignIn, takeTokenFromUrl } from './lib/google'
import { applyTheme, getTheme } from './screens/Settings.tsx'

applyTheme(getTheme())
readSharedText()

const render = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

// Svar fra Google-login, eller hent en ny Google-nøgle uden at spørge, før appen vises
if (takeTokenFromUrl()) render()
else autoSignIn().then((away) => { if (!away) render() }, render)
