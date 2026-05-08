import { useNavigate } from 'react-router-dom'

const PLANS = [
  { name:'Starter Ember', price:899,  credits:30000, features:['Standard generation','30,000 credits','30-day access','Android + Windows'] },
  { name:'Pro Inferno',   price:1299, credits:60000, features:['Priority generation','60,000 credits','30-day access','Android + Windows','Turbo mode'], popular:true },
]

export default function PlansPage() {
  const navigate = useNavigate()
  return (
    <div style={{background:'#0A0B1A', minHeight:'100vh', fontFamily:"'Plus Jakarta Sans',sans-serif"}}>
      <nav style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'18px 40px', borderBottom:'1px solid #ffffff08'}}>
        <span style={{fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:'#FF2A6D', cursor:'pointer'}} onClick={() => navigate('/dashboard')}>✦ NovaCraft</span>
        <button className="btn-outline" style={{padding:'8px 20px', fontSize:13}} onClick={() => navigate('/dashboard')}>← Dashboard</button>
      </nav>
      <div style={{maxWidth:820, margin:'0 auto', padding:'60px 24px', textAlign:'center'}}>
        <h1 style={{fontFamily:"'Syne',sans-serif", fontSize:38, fontWeight:800, marginBottom:12}}>Choose Your Plan</h1>
        <p style={{color:'#7B7D9D', marginBottom:16}}>Pay via UPI · Admin approves within 24hrs · Access unlocked instantly</p>
        <div style={{background:'#FF2A6D18', border:'1px solid #FF2A6D44', borderRadius:10, padding:'12px 20px', display:'inline-block', marginBottom:48, fontSize:14, color:'#E8E9F3'}}>
          📱 UPI: <strong style={{color:'#FF2A6D'}}>9271868861.etb@icici</strong> · ICICI Bank
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(300px,1fr))', gap:24, textAlign:'left'}}>
          {PLANS.map(plan => (
            <div key={plan.name} className="card" style={{position:'relative', ...(plan.popular ? {borderColor:'#FF2A6D', boxShadow:'0 0 30px #FF2A6D22'} : {})}}>
              {plan.popular && <div style={{position:'absolute', top:-12, left:'50%', transform:'translateX(-50%)', background:'#FF2A6D', color:'#fff', fontSize:11, fontWeight:700, padding:'4px 14px', borderRadius:999}}>MOST POPULAR</div>}
              <div style={{fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:700, marginBottom:4}}>{plan.name}</div>
              <div style={{fontSize:42, fontWeight:800, color:'#FF2A6D', margin:'12px 0'}}>₹{plan.price}</div>
              <div style={{color:'#7B7D9D', fontSize:13, marginBottom:20}}>{plan.credits.toLocaleString()} credits · 30 days</div>
              {plan.features.map(f => (
                <div key={f} style={{display:'flex', gap:8, marginBottom:10, fontSize:14, color:'#E8E9F3'}}>
                  <span style={{color:'#FF2A6D'}}>✦</span>{f}
                </div>
              ))}
              <button className="btn-primary" style={{width:'100%', marginTop:20}} onClick={() => navigate(`/payment/${encodeURIComponent(plan.name)}`)}>
                Buy {plan.name}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
