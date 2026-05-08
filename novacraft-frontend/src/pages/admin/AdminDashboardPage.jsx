import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { adminGetPending, adminGetUsers, adminApprove, adminReject, adminAdjustCredits, adminRevoke } from '../../api'

export default function AdminDashboardPage() {
  const navigate = useNavigate()
  const { logout } = useAuthStore()
  const [tab, setTab]           = useState('pending')
  const [pending, setPending]   = useState([])
  const [users, setUsers]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [rejectModal, setRejectModal] = useState(null) // { id, reason }
  const [creditModal, setCreditModal] = useState(null) // { userId, delta }
  const [msg, setMsg]           = useState('')

  async function load() {
    setLoading(true)
    try {
      const [p, u] = await Promise.all([adminGetPending(), adminGetUsers()])
      setPending(p); setUsers(u)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  function flash(m) { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  async function approve(id) {
    await adminApprove(id); flash('✅ Approved!'); load()
  }

  async function reject(id, reason) {
    await adminReject(id, reason); setRejectModal(null); flash('❌ Rejected.'); load()
  }

  async function revoke(userId) {
    if (!confirm('Revoke access?')) return
    await adminRevoke(userId); flash('Access revoked.'); load()
  }

  async function adjustCredits(userId, delta) {
    await adminAdjustCredits(userId, delta); setCreditModal(null); flash('Credits updated.'); load()
  }

  return (
    <div style={{background:'#0A0B1A', minHeight:'100vh', fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
      {/* Navbar */}
      <nav style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 32px', borderBottom:'1px solid #ffffff08'}}>
        <span style={{fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:'#FF2A6D'}}>✦ NovaCraft Admin</span>
        <button className="btn-outline" style={{padding:'8px 18px', fontSize:13}} onClick={() => { logout(); navigate('/admin') }}>Sign Out</button>
      </nav>

      {msg && <div style={{background:'#10b98122', border:'1px solid #10b981', color:'#10b981', padding:'12px 32px', fontSize:14, textAlign:'center'}}>{msg}</div>}

      <div style={{maxWidth:1100, margin:'0 auto', padding:'32px 24px'}}>
        {/* Stats */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:16, marginBottom:32}}>
          {[
            { label:'Pending Approvals', value:pending.length, color:'#f59e0b' },
            { label:'Total Users',       value:users.length,   color:'#05D9E8' },
            { label:'Active Plans',      value:users.filter(u=>u.subscription?.hasAccess).length, color:'#10b981' },
          ].map(s => (
            <div key={s.label} className="card" style={{textAlign:'center', borderColor:s.color+'44'}}>
              <div style={{fontSize:32, fontWeight:800, color:s.color}}>{s.value}</div>
              <div style={{fontSize:13, color:'#7B7D9D', marginTop:4}}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div style={{display:'flex', gap:8, marginBottom:24}}>
          {['pending','users'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{padding:'8px 22px', borderRadius:999, border:'1px solid', borderColor: tab===t ? '#FF2A6D' : '#3D3F5C', background: tab===t ? '#FF2A6D22' : 'transparent', color: tab===t ? '#FF2A6D' : '#7B7D9D', cursor:'pointer', fontSize:14, fontWeight:600, fontFamily:"'Plus Jakarta Sans',sans-serif", textTransform:'capitalize'}}>
              {t === 'pending' ? `⏳ Pending (${pending.length})` : `👥 All Users`}
            </button>
          ))}
        </div>

        {loading ? <p style={{color:'#7B7D9D', textAlign:'center', padding:40}}>Loading...</p> : tab === 'pending' ? (
          /* Pending Requests */
          pending.length === 0 ? (
            <div className="card" style={{textAlign:'center', padding:40}}>
              <div style={{fontSize:40, marginBottom:12}}>🎉</div>
              <p style={{color:'#7B7D9D'}}>No pending approvals!</p>
            </div>
          ) : pending.map(req => (
            <div key={req.id} className="card" style={{marginBottom:16, display:'flex', gap:20, flexWrap:'wrap', alignItems:'flex-start'}}>
              <a href={`http://localhost:5000/api/payment/screenshot/${req.screenshotPath}`} target="_blank" rel="noreferrer">
                <img src={`http://localhost:5000/api/payment/screenshot/${req.screenshotPath}`} alt="screenshot" style={{width:100, height:80, objectFit:'cover', borderRadius:8, border:'1px solid #3D3F5C', cursor:'pointer'}} />
              </a>
              <div style={{flex:1}}>
                <div style={{fontWeight:700, fontSize:16, marginBottom:4}}>{req.user.name}</div>
                <div style={{color:'#7B7D9D', fontSize:13, marginBottom:2}}>{req.user.email}</div>
                <div style={{fontSize:13, marginBottom:2}}>Plan: <strong style={{color:'#FF2A6D'}}>{req.planName}</strong> · ₹{req.amount}</div>
                <div style={{fontSize:13, color:'#7B7D9D'}}>Tx ID: {req.transactionId}</div>
                <div style={{fontSize:12, color:'#7B7D9D', marginTop:4}}>{new Date(req.submittedAt).toLocaleString()}</div>
              </div>
              <div style={{display:'flex', gap:8, alignSelf:'center'}}>
                <button className="btn-primary" style={{padding:'8px 18px', fontSize:13}} onClick={() => approve(req.id)}>Approve ✅</button>
                <button className="btn-outline" style={{padding:'8px 18px', fontSize:13}} onClick={() => setRejectModal({ id:req.id, reason:'' })}>Reject ❌</button>
              </div>
            </div>
          ))
        ) : (
          /* All Users */
          <div>
            {users.map(user => (
              <div key={user.id} className="card" style={{marginBottom:12, display:'flex', alignItems:'center', gap:16, flexWrap:'wrap'}}>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700}}>{user.name}</div>
                  <div style={{color:'#7B7D9D', fontSize:13}}>{user.email}</div>
                </div>
                <div style={{minWidth:180}}>
                  {user.subscription?.hasAccess ? (
                    <div>
                      <span className="badge badge-approved">{user.subscription.planName}</span>
                      <div style={{fontSize:12, color:'#7B7D9D', marginTop:4}}>
                        {user.subscription.creditsRemaining?.toLocaleString()} credits · expires {user.subscription.planExpiry ? new Date(user.subscription.planExpiry).toLocaleDateString() : 'N/A'}
                      </div>
                    </div>
                  ) : <span className="badge badge-rejected">No Plan</span>}
                </div>
                <div style={{display:'flex', gap:8}}>
                  <button onClick={() => setCreditModal({ userId:user.id, delta:0 })} style={{fontSize:12, padding:'6px 12px', borderRadius:999, background:'#05D9E822', color:'#05D9E8', border:'1px solid #05D9E844', cursor:'pointer', fontFamily:"'Plus Jakarta Sans',sans-serif"}}>Credits</button>
                  {user.subscription?.hasAccess && <button onClick={() => revoke(user.id)} style={{fontSize:12, padding:'6px 12px', borderRadius:999, background:'#ef444422', color:'#ef4444', border:'1px solid #ef444444', cursor:'pointer', fontFamily:"'Plus Jakarta Sans',sans-serif"}}>Revoke</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {rejectModal && (
        <Modal title="Reject Payment" onClose={() => setRejectModal(null)}>
          <p style={{color:'#7B7D9D', fontSize:14, marginBottom:14}}>Provide a reason for rejection:</p>
          <input className="input" value={rejectModal.reason} onChange={e=>setRejectModal({...rejectModal,reason:e.target.value})} placeholder="e.g. Screenshot unclear, wrong amount" />
          <div style={{display:'flex', gap:8, marginTop:16}}>
            <button className="btn-primary" style={{flex:1}} onClick={() => reject(rejectModal.id, rejectModal.reason)}>Confirm Reject</button>
            <button className="btn-outline" style={{flex:1}} onClick={() => setRejectModal(null)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* Credits Modal */}
      {creditModal && (
        <Modal title="Adjust Credits" onClose={() => setCreditModal(null)}>
          <p style={{color:'#7B7D9D', fontSize:14, marginBottom:14}}>Enter amount to add (+) or deduct (-). Example: 5000 or -1000</p>
          <input className="input" type="number" value={creditModal.delta} onChange={e=>setCreditModal({...creditModal,delta:parseInt(e.target.value)||0})} placeholder="e.g. 5000" />
          <div style={{display:'flex', gap:8, marginTop:16}}>
            <button className="btn-primary" style={{flex:1}} onClick={() => adjustCredits(creditModal.userId, creditModal.delta)}>Apply</button>
            <button className="btn-outline" style={{flex:1}} onClick={() => setCreditModal(null)}>Cancel</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{position:'fixed', inset:0, background:'#000000aa', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:24}} onClick={onClose}>
      <div className="card" style={{maxWidth:420, width:'100%'}} onClick={e=>e.stopPropagation()}>
        <h3 style={{fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:700, marginBottom:16}}>{title}</h3>
        {children}
      </div>
    </div>
  )
}
