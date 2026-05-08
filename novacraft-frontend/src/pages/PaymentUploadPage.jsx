import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { submitPayment } from '../api'

const PLAN_PRICES = { 'Starter Ember': 899, 'Pro Inferno': 1299 }

export default function PaymentUploadPage() {
  const { plan }     = useParams()
  const planName     = decodeURIComponent(plan)
  const navigate     = useNavigate()
  const price        = PLAN_PRICES[planName] || 899

  const [txId, setTxId]         = useState('')
  const [file, setFile]         = useState(null)
  const [preview, setPreview]   = useState(null)
  const [loading, setLoading]   = useState(false)
  const [success, setSuccess]   = useState(false)
  const [error, setError]       = useState('')

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) { setError('Please upload a payment screenshot.'); return }
    setLoading(true); setError('')
    try {
      await submitPayment(planName, txId, file)
      setSuccess(true)
    } catch (err) {
      setError(err.message)
    } finally { setLoading(false) }
  }

  if (success) return (
    <div style={{background:'#0A0B1A', minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center'}}>
      <div className="card" style={{maxWidth:440, textAlign:'center', borderColor:'#10b981'}}>
        <div style={{fontSize:48, marginBottom:16}}>✅</div>
        <h2 style={{fontFamily:"'Syne',sans-serif", fontSize:24, fontWeight:700, marginBottom:12, color:'#10b981'}}>Request Submitted!</h2>
        <p style={{color:'#7B7D9D', marginBottom:24}}>Our team will review your payment screenshot and activate your plan within 24 hours. You'll receive an email confirmation.</p>
        <button className="btn-primary" style={{width:'100%'}} onClick={() => navigate('/dashboard')}>Go to Dashboard</button>
      </div>
    </div>
  )

  return (
    <div style={{background:'#0A0B1A', minHeight:'100vh', fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
      <nav style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 40px', borderBottom:'1px solid #ffffff08'}}>
        <span style={{fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:'#FF2A6D'}}>✦ NovaCraft</span>
        <button className="btn-outline" style={{padding:'8px 20px', fontSize:13}} onClick={() => navigate('/plans')}>← Plans</button>
      </nav>

      <div style={{maxWidth:520, margin:'0 auto', padding:'48px 24px'}}>
        <h1 style={{fontFamily:"'Syne',sans-serif", fontSize:30, fontWeight:800, marginBottom:6}}>Complete Payment</h1>
        <p style={{color:'#7B7D9D', marginBottom:32}}>Send payment, then upload screenshot for verification.</p>

        {/* Payment instructions */}
        <div style={{background:'#14152A', border:'1px solid #FF2A6D44', borderRadius:14, padding:24, marginBottom:28}}>
          <div style={{fontSize:13, color:'#FF2A6D', fontWeight:700, marginBottom:12, letterSpacing:1}}>PAYMENT INSTRUCTIONS</div>
          <div style={{display:'grid', gap:10}}>
            {[
              { label:'Plan',    value: planName },
              { label:'Amount',  value: `₹${price}` },
              { label:'UPI ID',  value: '9271868861.etb@icici' },
              { label:'Bank',    value: 'ICICI Bank' },
            ].map(row => (
              <div key={row.label} style={{display:'flex', justifyContent:'space-between', fontSize:14}}>
                <span style={{color:'#7B7D9D'}}>{row.label}</span>
                <span style={{fontWeight:600, color:'#FF2A6D'}}>{row.value}</span>
              </div>
            ))}
          </div>
          <div style={{marginTop:14, padding:'10px 14px', background:'#FF2A6D11', borderRadius:8, fontSize:13, color:'#E8E9F3'}}>
            ⚠️ After paying, come back here and upload the payment screenshot.
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{display:'flex', flexDirection:'column', gap:18}}>
          <div>
            <label style={labelStyle}>Transaction ID / UTR Number</label>
            <input className="input" value={txId} onChange={e=>setTxId(e.target.value)} placeholder="Enter transaction ID" required />
          </div>

          <div>
            <label style={labelStyle}>Payment Screenshot</label>
            <label style={{display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10, border:'2px dashed #3D3F5C', borderRadius:12, padding:'28px 20px', cursor:'pointer', background:preview?'#0d0e20':'transparent', transition:'border-color 0.2s'}}
              onMouseEnter={e=>e.currentTarget.style.borderColor='#FF2A6D'}
              onMouseLeave={e=>e.currentTarget.style.borderColor='#3D3F5C'}
            >
              {preview
                ? <img src={preview} alt="preview" style={{maxHeight:200, borderRadius:8, objectFit:'contain'}} />
                : <>
                    <div style={{fontSize:32}}>📸</div>
                    <span style={{color:'#7B7D9D', fontSize:14}}>Click to upload screenshot (JPG/PNG)</span>
                  </>
              }
              <input type="file" accept="image/*" onChange={handleFile} style={{display:'none'}} required />
            </label>
          </div>

          {error && <div style={{color:'#ff4444', fontSize:13, background:'#ff444411', padding:'10px 14px', borderRadius:8}}>{error}</div>}

          <button className="btn-primary" type="submit" disabled={loading} style={{padding:'14px', fontSize:15}}>
            {loading ? 'Submitting...' : 'Submit Payment Request'}
          </button>
        </form>
      </div>
    </div>
  )
}

const labelStyle = { display:'block', fontSize:13, color:'#7B7D9D', fontWeight:600, marginBottom:6 }
