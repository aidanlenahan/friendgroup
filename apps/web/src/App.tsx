import { Navigate, Route, Routes, Link } from 'react-router-dom'
import './App.css'
import { Phase7DebugPage } from './pages/Phase7DebugPage'
import { Phase9DiagnosticsPage } from './pages/Phase9DiagnosticsPage'

function HomePage() {
  return (
    <main className="app-shell">
      <header className="hero home-hero">
        <p className="eyebrow">Friendgroup</p>
        <h1>Project Control Center</h1>
        <p>
          Quick launch for debug and quality surfaces while we continue Phase 9 and
          upcoming frontend hardening work.
        </p>
      </header>

      <section className="launch-grid" aria-label="Feature launch cards">
        <article className="panel launch-card">
          <h2>Phase 7 Debug</h2>
          <p>
            Preserve and use the existing PWA install + push subscription debug
            console.
          </p>
          <Link className="button-link" to="/phase-7/debug">
            Open Phase 7 Debug
          </Link>
        </article>

        <article className="panel launch-card">
          <h2>Phase 9 Diagnostics</h2>
          <p>
            Start Phase 9 frontend QA with simple API and notifications diagnostics.
          </p>
          <Link className="button-link" to="/phase-9/diagnostics">
            Open Phase 9 Diagnostics
          </Link>
        </article>
      </section>
    </main>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/phase-7/debug" element={<Phase7DebugPage />} />
      <Route path="/phase-9/diagnostics" element={<Phase9DiagnosticsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
