import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'tldraw/tldraw.css'
import './styles.css'
import './visual-polish.css'
import App from './app/App'

const root = document.getElementById('root')
if (!root) throw new Error('Prompt Canvas root element was not found.')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
