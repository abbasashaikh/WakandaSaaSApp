import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { getPaymentHistory, getSubscriptionStatus } from '../api'

export default function DashboardPage() {
  const navigate  = useNavigate()
  const { user, logout } = useAuthStore()
  const [sub, setSub]         = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [s, h] = await Promise.all([getSubscriptionStatus(), getPaymentHistory()])
        setSub(s); setHistory(h)
      } finally { setLoading(false) }
    }
    load()
  }, [])

  function handleLogout() { logout(); navigate('/') }

  return (
    <div style={{background:'#0A0B1A', minHeight:'100vh', fontFamily:"'Plus Jakarta Sans', sans-serif"}}>
      {/* Navbar */}
      <nav style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 40px', borderBottom:'1px solid #ffffff08'}}>
        <span style={{fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:'#FF2A6D'}}>✦ NovaCraft</span>
        <div style={{display:'flex', alignItems:'center', gap:16}}>
          <span style={{color:'#7B7D9D', fontSize:14}}>Hi, {user?.name}</span>
          <button onClick={handleLogout} className="btn-outline" style={{padding:'8px 20px', fontSize:13}}>Sign Out</button>
        </div>
      </nav>

      <div style={{maxWidth:900, margin:'0 auto', padding:'40px 24px'}}>

        {/* Subscription card */}
        <div className="card" style={{marginBottom:24, background: sub?.has_access ? '#0d1f17' : '#1a0d15', borderColor: sub?.has_access ? '#10b981' : '#FF2A6D'}}>
          {loading ? <p style={{color:'#7B7D9D'}}>Loading subscription...</p> : sub?.has_access ? (
            <div>
              <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:16}}>
                <span style={{fontSize:24}}>✅</span>
                <span style={{fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:700, color:'#10b981'}}>Plan Active</span>
                <span className="badge badge-approved" style={{marginLeft:'auto'}}>{sub.plan_name}</span>
              </div>
              <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:16}}>
                {[
                  { label:'Credits Remaining', value: sub.credits_remaining?.toLocaleString() },
                  { label:'Expires',           value: sub.plan_expiry ? new Date(sub.plan_expiry).toLocaleDateString() : 'N/A' },
                  { label:'Plan',              value: sub.plan_name },
                ].map(s => (
                  <div key={s.label} style={{background:'#ffffff08', borderRadius:10, padding:'14px 16px'}}>
                    <div style={{fontSize:12, color:'#7B7D9D', marginBottom:4}}>{s.label}</div>
                    <div style={{fontSize:18, fontWeight:700}}>{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{textAlign:'center', padding:'20px 0'}}>
              <div style={{fontSize:40, marginBottom:12}}>🔒</div>
              <h3 style={{fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:700, marginBottom:8}}>No Active Plan</h3>
              <p style={{color:'#7B7D9D', marginBottom:20}}>Purchase a plan to unlock AI generation in the app.</p>
              <button className="btn-primary" onClick={() => navigate('/plans')}>View Plans</button>
            </div>
          )}
        </div>

        {/* Download links */}
        <div className="card" style={{marginBottom:24}}>
          <h3 style={{fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:700, marginBottom:16}}>Download Apps</h3>
          <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
            <a href="https://github.com/abbasashaikh/WakandaSaaSApp/releases/download/NovaCraftR1/NovaCraft.exe" target="_blank" rel="noreferrer">
              <button className="btn-primary" style={{display:'flex', alignItems:'center', gap:8}}>⬇ Windows EXE</button>
            </a>
            <a href="https://github.com/abbasashaikh/WakandaSaaSApp/releases/download/NovaCraftR1/NovaCraft.apk" target="_blank" rel="noreferrer">
              <button className="btn-outline" style={{display:'flex', alignItems:'center', gap:8}}>⬇ Android APK</button>
            </a>
          </div>
          <p style={{color:'#7B7D9D', fontSize:13, marginTop:12}}>Log in with the same email and password inside the app.</p>
        </div>

        {/* Payment history */}
        <div className="card">
          <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20}}>
            <h3 style={{fontFamily:"'Syne',sans-serif", fontSize:18, fontWeight:700}}>Payment History</h3>
            <button className="btn-primary" style={{padding:'8px 20px', fontSize:13}} onClick={() => navigate('/plans')}>Buy Plan</button>
          </div>
          {history.length === 0 ? (
            <p style={{color:'#7B7D9D', fontSize:14, textAlign:'center', padding:'20px 0'}}>No payment requests yet.</p>
          ) : history.map(req => (
            <div key={req.id} style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 0', borderBottom:'1px solid #ffffff08'}}>
              <div>
                <div style={{fontWeight:600, marginBottom:3}}>{req.planName}</div>
                <div style={{fontSize:13, color:'#7B7D9D'}}>₹{req.amount} · {new Date(req.submittedAt).toLocaleDateString()}</div>
                {req.rejectionReason && <div style={{fontSize:12, color:'#ef4444', marginTop:2}}>Reason: {req.rejectionReason}</div>}
              </div>
              <span className={`badge badge-${req.status}`}>{req.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
