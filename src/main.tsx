import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setUpChrome } from './site/chrome'
import './styles.css'

setUpChrome()

createRoot(document.getElementById('emd-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
