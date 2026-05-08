import { useNavigate } from 'react-router-dom'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div style={{background:'#0A0B1A', minHeight:'100vh', fontFamily:"'Plus Jakarta Sans', sans-serif"}}>

      {/* ── Navbar ── */}
      <nav style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding:'20px 48px', borderBottom:'1px solid #ffffff08'}}>
        <span style={{fontFamily:"'Syne', sans-serif", fontSize:22, fontWeight:800, color:'#FF2A6D', letterSpacing:'-0.5px'}}>
          ✦ NovaCraft
        </span>
        <div style={{display:'flex', gap:12}}>
          <button className="btn-outline" onClick={() => navigate('/login')}>Sign In</button>
          <button className="btn-primary" onClick={() => navigate('/register')}>Get Started</button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <div style={{textAlign:'center', padding:'100px 24px 60px', position:'relative'}}>
        {/* Glow orb */}
        <div style={{position:'absolute', top:60, left:'50%', transform:'translateX(-50%)', width:500, height:300, background:'radial-gradient(ellipse at center, #FF2A6D22 0%, transparent 70%)', pointerEvents:'none'}} />

        <div style={{display:'inline-block', background:'#FF2A6D18', border:'1px solid #FF2A6D44', borderRadius:999, padding:'6px 18px', fontSize:12, color:'#FF2A6D', fontWeight:600, marginBottom:24, letterSpacing:1}}>
          ✦ AI IMAGE &amp; VIDEO GENERATION
        </div>

        <h1 style={{fontFamily:"'Syne', sans-serif", fontSize:'clamp(42px, 7vw, 76px)', fontWeight:800, color:'#E8E9F3', lineHeight:1.05, marginBottom:24}}>
          Create Without<br />
          <span style={{color:'#FF2A6D'}}>Limits.</span>
        </h1>

        <p style={{fontSize:18, color:'#7B7D9D', maxWidth:520, margin:'0 auto 40px', lineHeight:1.7}}>
          Your imagination, amplified. Generate stunning AI images and videos — straight from your desktop or phone.
        </p>

        <div style={{display:'flex', gap:16, justifyContent:'center', flexWrap:'wrap'}}>
          <button className="btn-primary" style={{fontSize:16, padding:'14px 36px'}} onClick={() => navigate('/register')}>
            Start Creating Free
          </button>
          <button className="btn-outline" style={{fontSize:16, padding:'14px 36px'}} onClick={() => navigate('/login')}>
            I have an account
          </button>
        </div>
      </div>

      {/* ── Plans Preview ── */}
      <div style={{padding:'80px 24px', maxWidth:900, margin:'0 auto'}}>
        <h2 style={{fontFamily:"'Syne', sans-serif", textAlign:'center', fontSize:36, fontWeight:700, marginBottom:12}}>
          Simple Pricing
        </h2>
        <p style={{textAlign:'center', color:'#7B7D9D', marginBottom:48}}>Pay once, create endlessly for 30 days</p>

        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(300px, 1fr))', gap:24}}>
          {[
            { name:'Starter Ember', price:'₹899', credits:'30,000', tag:'Great for beginners', features:['Standard generation','30,000 credits','30-day access','Android + Windows app'] },
            { name:'Pro Inferno',   price:'₹1,299', credits:'60,000', tag:'Most Popular 🔥',   features:['Priority generation','60,000 credits','30-day access','Android + Windows app', 'Turbo mode'] },
          ].map((plan, i) => (
            <div key={plan.name} className="card" style={{position:'relative', ...(i===1 ? {borderColor:'#FF2A6D', boxShadow:'0 0 30px #FF2A6D22'} : {})}}>
              {i===1 && <div style={{position:'absolute', top:-12, left:'50%', transform:'translateX(-50%)', background:'#FF2A6D', color:'#fff', fontSize:11, fontWeight:700, padding:'4px 14px', borderRadius:999, letterSpacing:1}}>MOST POPULAR</div>}
              <div style={{color:'#7B7D9D', fontSize:12, fontWeight:600, marginBottom:8, letterSpacing:1}}>{plan.tag}</div>
              <div style={{fontFamily:"'Syne', sans-serif", fontSize:22, fontWeight:700, marginBottom:4}}>{plan.name}</div>
              <div style={{fontSize:40, fontWeight:800, color:'#FF2A6D', margin:'12px 0'}}>{plan.price}</div>
              <div style={{color:'#7B7D9D', fontSize:13, marginBottom:20}}>{plan.credits} credits · 30 days</div>
              {plan.features.map(f => (
                <div key={f} style={{display:'flex', alignItems:'center', gap:8, marginBottom:10, color:'#E8E9F3', fontSize:14}}>
                  <span style={{color:'#FF2A6D'}}>✦</span>{f}
                </div>
              ))}
              <button className="btn-primary" style={{width:'100%', marginTop:20}} onClick={() => navigate('/register')}>
                Get {plan.name}
              </button>
            </div>
          ))}
        </div>
      </div>

     

      {/* ── Footer ── */}
      <footer style={{textAlign:'center', padding:'32px', color:'#3D3F5C', fontSize:13, borderTop:'1px solid #ffffff08'}}>
        <span style={{color:'#FF2A6D', fontWeight:700}}>NovaCraft</span> · Independent platform · {new Date().getFullYear()}
      </footer>
    </div>
  )
}
