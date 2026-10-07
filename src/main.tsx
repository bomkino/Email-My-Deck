import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setUpSendGuide } from './guide/picker'
import { setUpChrome } from './site/chrome'
import { setUpStage } from './site/stage'
import './styles.css'

setUpChrome()
setUpSendGuide()

createRoot(document.getElementById('emd-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Decoration only: if the glow fails, the page and the tool carry on without it.
try { setUpStage() } catch { /* the still CSS glow stays */ }
