import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './lib/tauri-ipc' // Initialize Tauri IPC wrapper
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <App />
    </StrictMode>,
)
