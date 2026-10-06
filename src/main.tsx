import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setUpSendGuide } from './guide/picker'
import { setUpChrome } from './site/chrome'
import './styles.css'

setUpChrome()
setUpSendGuide()

createRoot(document.getElementById('emd-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
