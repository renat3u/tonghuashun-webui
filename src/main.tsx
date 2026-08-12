import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../client-plugin/src/App'
import '../client-plugin/src/styles/global.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root 元素不存在')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
