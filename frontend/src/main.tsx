import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'material-icons/iconfont/filled.css'
import 'material-symbols/outlined.css'
import './index.css'
import App from './App.tsx'
import LicenseGate from './components/LicenseGate.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LicenseGate>
      <App />
    </LicenseGate>
  </StrictMode>,
)
