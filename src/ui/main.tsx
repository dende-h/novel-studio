import '@fontsource-variable/inter'
import '@fontsource-variable/source-serif-4'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Root } from './Root'
import { createDefaultStore } from './store/createDefaultStore'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <Root store={createDefaultStore()} />
  </StrictMode>,
)
