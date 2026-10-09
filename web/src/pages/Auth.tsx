import { useState } from 'react'
import * as api from '../api'
import { useApp } from '../store/app'

export default function Login() {
  const setup = useApp((s) => s.setupRequired)
  const setUser = useApp((s) => s.setUser)
  const setSetupRequired = useApp((s) => s.setSetupRequired)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      const u = await (setup ? api.setup(username, password) : api.login(username, password))
      setSetupRequired(false)
      setUser(u)
    } catch (err) {
      setError((err as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <div className="login">
      <form onSubmit={submit} className="login-box">
        <h1>▶ Media Player</h1>
        <p className="muted">{setup ? 'Primer arranque: crea la cuenta de administrador.' : 'Inicia sesión para continuar.'}</p>
        <label>Usuario<input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
        <label>Contraseña
          <input type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password}
            minLength={setup ? 8 : undefined} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {setup && <small className="muted">Mínimo 8 caracteres.</small>}
        {error && <p className="err" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>{setup ? 'Crear administrador' : 'Entrar'}</button>
      </form>
    </div>
  )
}
