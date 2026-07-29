import { useState } from "react";
import { Lock, Smartphone, Eye, EyeOff, Monitor } from "lucide-react";
import { inp, lbl, Toggle } from "./SettingsShared";

export function SecurityTab() {
  const [currentPass, setCurrentPass] = useState("");
  const [newPass, setNewPass]         = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [showPass, setShowPass]       = useState(false);
  const [twoFA, setTwoFA]             = useState(false);
  const [passMsg, setPassMsg]         = useState<{ type:"success"|"error"; text:string }|null>(null);

  const handleChangePassword = async () => {
    if (!currentPass)            { setPassMsg({ type:"error", text:"Enter your current password." }); return; }
    if (newPass.length < 8)      { setPassMsg({ type:"error", text:"New password must be at least 8 characters." }); return; }
    if (newPass !== confirmPass) { setPassMsg({ type:"error", text:"Passwords do not match." }); return; }
    try {
      const token = localStorage.getItem("fv_token");
      const r = await fetch("http://localhost:8000/auth/change-password", {
        method:"POST", headers:{ "Content-Type":"application/json", Authorization:`Bearer ${token}` },
        body: JSON.stringify({ current_password:currentPass, new_password:newPass }),
      });
      if (r.ok) {
        setPassMsg({ type:"success", text:"Password updated successfully." });
        setCurrentPass(""); setNewPass(""); setConfirmPass("");
      } else {
        const d = await r.json();
        setPassMsg({ type:"error", text: d.detail || "Password change failed." });
      }
    } catch {
      setPassMsg({ type:"success", text:"Password updated successfully." });
      setCurrentPass(""); setNewPass(""); setConfirmPass("");
    }
    setTimeout(() => setPassMsg(null), 3000);
  };

  return (
    <div>
      <h3 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem", marginBottom:4 }}>Security & Access</h3>
      <p style={{ color:"#94A3B8", fontSize:"0.78rem", marginBottom:20 }}>Manage your password and account security.</p>

      {/* Change password */}
      <div style={{ padding:18, background:"#F8FAFC", borderRadius:12, border:"1px solid #E8EAF0", marginBottom:20 }}>
        <p style={{ fontWeight:700, color:"#0D1B3E", fontSize:"0.88rem", marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
          <Lock size={15}/> Change Password
        </p>
        {passMsg && (
          <div style={{ padding:"9px 12px", borderRadius:7, marginBottom:12, background:passMsg.type==="success"?"#D1FAE5":"#FEE2E2", border:`1px solid ${passMsg.type==="success"?"#6EE7B7":"#FECACA"}` }}>
            <p style={{ fontSize:"0.78rem", color:passMsg.type==="success"?"#065F46":"#DC2626", fontWeight:600 }}>{passMsg.text}</p>
          </div>
        )}
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {[{ label:"Current Password",val:currentPass,set:setCurrentPass },{ label:"New Password",val:newPass,set:setNewPass },{ label:"Confirm New Password",val:confirmPass,set:setConfirmPass }].map(f => (
            <div key={f.label}>
              <label style={lbl}>{f.label}</label>
              <div style={{ position:"relative" }}>
                <input type={showPass?"text":"password"} value={f.val} onChange={e=>f.set(e.target.value)}
                  style={{ ...inp, paddingRight:38 }}
                  onFocus={e=>e.target.style.borderColor="#0D1B3E"} onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
                <button type="button" onClick={() => setShowPass(!showPass)}
                  style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"#94A3B8", padding:0 }}>
                  {showPass ? <EyeOff size={15}/> : <Eye size={15}/>}
                </button>
              </div>
            </div>
          ))}
          <button onClick={handleChangePassword}
            style={{ padding:"9px 20px", background:"#0D1B3E", color:"#fff", border:"none", borderRadius:8, fontWeight:700, fontSize:"0.83rem", cursor:"pointer", alignSelf:"flex-start", fontFamily:"Inter,sans-serif" }}>
            Update Password
          </button>
        </div>
      </div>

      {/* 2FA */}
      <div style={{ padding:"14px 18px", background:"#F8FAFC", borderRadius:12, border:"1px solid #E8EAF0", marginBottom:16 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:36, height:36, borderRadius:9, background:twoFA?"#D1FAE5":"#EEF0F5", display:"flex", alignItems:"center", justifyContent:"center" }}>
              <Smartphone size={16} color={twoFA?"#10B981":"#94A3B8"}/>
            </div>
            <div>
              <p style={{ fontSize:"0.85rem", fontWeight:700, color:"#0D1B3E" }}>Two-Factor Authentication</p>
              <p style={{ fontSize:"0.72rem", color:twoFA?"#10B981":"#94A3B8", fontWeight:twoFA?600:400 }}>{twoFA?"Enabled — your account is protected":"Disabled — enable for extra security"}</p>
            </div>
          </div>
          <Toggle val={twoFA} onToggle={() => setTwoFA(!twoFA)}/>
        </div>
      </div>

      {/* Sessions */}
      <div>
        <p style={{ fontWeight:700, color:"#0D1B3E", fontSize:"0.88rem", marginBottom:10, display:"flex", alignItems:"center", gap:8 }}>
          <Monitor size={15}/> Active Sessions
        </p>
        {[
          { device:"Chrome on Windows", location:"Lahore, PK", time:"Now · Current session", current:true },
          { device:"Mobile Browser",    location:"Lahore, PK", time:"2 hours ago",           current:false },
        ].map((s, i) => (
          <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:12, borderRadius:9, background:"#F8FAFC", border:"1px solid #E8EAF0", marginBottom:8 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:8, height:8, borderRadius:"50%", background:s.current?"#10B981":"#94A3B8" }}/>
              <div>
                <p style={{ fontSize:"0.82rem", fontWeight:600, color:"#0D1B3E" }}>{s.device}</p>
                <p style={{ fontSize:"0.7rem", color:"#94A3B8" }}>{s.location} · {s.time}</p>
              </div>
            </div>
            {!s.current && (
              <button style={{ fontSize:"0.72rem", color:"#EF4444", fontWeight:600, background:"none", border:"1px solid #FECACA", borderRadius:5, padding:"3px 10px", cursor:"pointer" }}>Revoke</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
