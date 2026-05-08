import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { login } from '../api'
import { useAuthStore } from '../store/authStore'

export default function LoginPage() {
  const navigate = useNavigate()
  const setUser  = useAuthStore(s => s.setUser)
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const user = await login(email, password)
      setUser(user)
      navigate(user.isAdmin ? '/admin/dashboard' : '/dashboard')
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your NovaCraft account">
      <form onSubmit={handleSubmit} style={{display:'flex', flexDirection:'column', gap:16}}>
        <div>
          <label style={labelStyle}>Email</label>
          <input className="input" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" required />
        </div>
        <div>
          <label style={labelStyle}>Password</label>
          <input className="input" type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" required />
        </div>
        {error && <div style={{color:'#ff4444', fontSize:13, background:'#ff444411', padding:'10px 14px', borderRadius:8}}>{error}</div>}
        <button className="btn-primary" type="submit" disabled={loading} style={{marginTop:8}}>
          {loading ? 'Signing in...' : 'Sign In'}
        </button>
        <p style={{textAlign:'center', color:'#7B7D9D', fontSize:14}}>
          No account? <Link to="/register" style={{color:'#FF2A6D', textDecoration:'none', fontWeight:600}}>Create one</Link>
        </p>
      </form>
    </AuthLayout>
  )
}

// ── Register ──────────────────────────────────────────────────────────────────
export function RegisterPage() {
  const navigate = useNavigate()
  const setUser  = useAuthStore(s => s.setUser)
  const [form, setForm]     = useState({ name:'', email:'', password:'' })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true); setError('')
    try {
      const { register } = await import('../api')
      const user = await register(form.name, form.email, form.password)
      setUser(user)
      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  return (
    <AuthLayout title="Create account" subtitle="Join NovaCraft and start creating">
      <form onSubmit={handleSubmit} style={{display:'flex', flexDirection:'column', gap:16}}>
        {[
          { label:'Full Name',  key:'name',     type:'text',     ph:'Your name' },
          { label:'Email',      key:'email',    type:'email',    ph:'you@example.com' },
          { label:'Password',   key:'password', type:'password', ph:'Min 6 characters' },
        ].map(f => (
          <div key={f.key}>
            <label style={labelStyle}>{f.label}</label>
            <input className="input" type={f.type} value={form[f.key]} onChange={e=>setForm({...form,[f.key]:e.target.value})} placeholder={f.ph} required />
          </div>
        ))}
        {error && <div style={{color:'#ff4444', fontSize:13, background:'#ff444411', padding:'10px 14px', borderRadius:8}}>{error}</div>}
        <button className="btn-primary" type="submit" disabled={loading} style={{marginTop:8}}>
          {loading ? 'Creating account...' : 'Create Account'}
        </button>
        <p style={{textAlign:'center', color:'#7B7D9D', fontSize:14}}>
          Have an account? <Link to="/login" style={{color:'#FF2A6D', textDecoration:'none', fontWeight:600}}>Sign in</Link>
        </p>
      </form>
    </AuthLayout>
  )
}

// ── Shared layout ─────────────────────────────────────────────────────────────
function AuthLayout({ title, subtitle, children }) {
  return (
    <div style={{background:'#0A0B1A', minHeight:'100vh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:24}}>
      <div style={{position:'absolute', top:0, left:0, right:0, height:300, background:'radial-gradient(ellipse at 50% 0%, #FF2A6D18 0%, transparent 70%)', pointerEvents:'none'}} />
      <Link to="/" style={{fontFamily:"'Syne', sans-serif", fontSize:22, fontWeight:800, color:'#FF2A6D', marginBottom:40, textDecoration:'none'}}>✦ NovaCraft</Link>
      <div className="card" style={{width:'100%', maxWidth:420}}>
        <h1 style={{fontFamily:"'Syne', sans-serif", fontSize:26, fontWeight:700, marginBottom:6}}>{title}</h1>
        <p style={{color:'#7B7D9D', fontSize:14, marginBottom:28}}>{subtitle}</p>
        {children}
      </div>
    </div>
  )
}

const labelStyle = { display:'block', fontSize:13, color:'#7B7D9D', fontWeight:600, marginBottom:6 }
