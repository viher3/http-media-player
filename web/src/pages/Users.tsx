import { useState } from 'react'
import * as api from '../api'
import { useFetch } from '../hooks'
import { useApp } from '../store/app'
import { PageState } from '../components/Section'

export default function Users() {
  const { data, error, loading, reload } = useFetch(api.listUsers, [])
  const me = useApp((s) => s.user)
  const toast = useApp((s) => s.showToast)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [admin, setAdmin] = useState(false)

  const create = (e: React.FormEvent) => {
    e.preventDefault()
    api.createUser(username, password, admin)
      .then(() => { setUsername(''); setPassword(''); setAdmin(false); reload(); toast('Usuario creado') })
      .catch((err: Error) => toast(err.message))
  }
  const del = (id: number, name: string) => {
    if (confirm(`¿Borrar al usuario «${name}» y todos sus datos?`)) api.deleteUser(id).then(reload).catch((err: Error) => toast(err.message))
  }

  return (
    <div>
      <h2>Usuarios</h2>
      <form onSubmit={create} className="inline-form wrap">
        <input placeholder="Usuario" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="off" />
        <input type="password" placeholder="Contraseña (mín. 8)" value={password} minLength={8} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
        <label className="check"><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Admin</label>
        <button className="primary">Crear</button>
      </form>
      <PageState loading={loading && !data} error={error}>
        <ul className="list">
          {data?.map((u) => (
            <li key={u.id} className="trow">
              <span className="row"><span className="ico">👤</span><span className="name">{u.username}{u.is_admin ? <small> · admin</small> : null}</span></span>
              {u.id !== me?.id && <button className="icon" onClick={() => del(u.id, u.username)} aria-label={`Borrar ${u.username}`}>✕</button>}
            </li>
          ))}
        </ul>
      </PageState>
    </div>
  )
}
