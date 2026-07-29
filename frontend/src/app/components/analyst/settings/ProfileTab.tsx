import { inp, lbl } from "./SettingsShared";
import type { AppSettings } from "../types";
import { initials } from "../types";

interface Props { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; userEmail: string; }

export function ProfileTab({ settings, onChange, userEmail }: Props) {
  return (
    <div>
      <h3 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem", marginBottom:16 }}>Profile Information</h3>
      <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20, padding:16, background:"#F8FAFC", borderRadius:12, border:"1px solid #E8EAF0" }}>
        <div style={{ width:56, height:56, borderRadius:"50%", background:"#0D1B3E", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
          <span style={{ color:settings.accentColor, fontWeight:700, fontSize:"1.1rem" }}>{initials(settings.displayName)}</span>
        </div>
        <div>
          <p style={{ fontWeight:700, color:"#0D1B3E", fontSize:"0.95rem" }}>{settings.displayName}</p>
          <p style={{ color:"#94A3B8", fontSize:"0.78rem" }}>{settings.jobTitle} · {userEmail}</p>
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        <div>
          <label style={lbl}>Full Name</label>
          <input value={settings.displayName} onChange={e => onChange({ displayName:e.target.value })}
            style={inp} onFocus={e=>e.target.style.borderColor="#0D1B3E"} onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
          <p style={{ fontSize:"0.7rem", color:"#94A3B8", marginTop:4 }}>Updates everywhere instantly.</p>
        </div>
        <div>
          <label style={lbl}>Corporate Email</label>
          <input value={userEmail} disabled style={{ ...inp, background:"#F8FAFC", color:"#94A3B8", cursor:"not-allowed" }}/>
          <p style={{ fontSize:"0.7rem", color:"#94A3B8", marginTop:4 }}>Email cannot be changed. Contact your administrator.</p>
        </div>
        <div>
          <label style={lbl}>Job Title</label>
          <input value={settings.jobTitle} onChange={e => onChange({ jobTitle:e.target.value })}
            style={inp} onFocus={e=>e.target.style.borderColor="#0D1B3E"} onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
          <div>
            <label style={lbl}>Timezone</label>
            <select value={settings.timezone} onChange={e => onChange({ timezone:e.target.value })} style={{ ...inp, cursor:"pointer" }}>
              {["UTC+5 (PKT)","UTC-8 (Pacific)","UTC-5 (Eastern)","UTC+0 (GMT)","UTC+1 (CET)","UTC+5:30 (IST)","UTC+8 (SGT)"].map(z=><option key={z}>{z}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Language</label>
            <select value={settings.language} onChange={e => onChange({ language:e.target.value })} style={{ ...inp, cursor:"pointer" }}>
              {["English (US)","English (UK)","Spanish","French","German","Arabic"].map(l=><option key={l}>{l}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
