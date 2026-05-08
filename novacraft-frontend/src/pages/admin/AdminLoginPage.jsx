import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login } from '../../api'
import { useAuthStore } from '../../store/authStore'

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const setUser  = useAuthStore(s => s.setUser)
  const [email, setEmail]       = useState('shaikhabbas81@gmail.com')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const user = await login(email, password)
      if (!user.isAdmin) { setError('Not an admin account.'); return }
      setUser(user)
      navigate('/admin/dashboard')
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  return (
    <div style={{background:'#0A0B1A', minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24}}>
      <div style={{fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:800, color:'#FF2A6D', marginBottom:40}}>✦ NovaCraft Admin</div>
      <div className="card" style={{width:'100%', maxWidth:400}}>
        <h2 style={{fontFamily:"'Syne',sans-serif", fontSize:24, fontWeight:700, marginBottom:6}}>Admin Panel</h2>
        <p style={{color:'#7B7D9D', fontSize:13, marginBottom:24}}>Restricted access only</p>
        <form onSubmit={handleSubmit} style={{display:'flex', flexDirection:'column', gap:14}}>
          <input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Admin email" required />
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="Password" required />
          {error && <div style={{color:'#ff4444', fontSize:13, background:'#ff444411', padding:'10px 14px', borderRadius:8}}>{error}</div>}
          <button className="btn-primary" type="submit" disabled={loading}>{loading ? 'Signing in...' : 'Admin Sign In'}</button>
        </form>
      </div>
    </div>
  )
}
