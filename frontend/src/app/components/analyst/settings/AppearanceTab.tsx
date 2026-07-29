import { Sun, Moon } from "lucide-react";
import type { AppSettings } from "../types";
import { lbl } from "./SettingsShared";

interface Props { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; }

export function AppearanceTab({ settings, onChange }: Props) {
  return (
    <div>
      <h3 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem", marginBottom:4 }}>Appearance</h3>
      <p style={{ color:"#94A3B8", fontSize:"0.78rem", marginBottom:20 }}>Changes apply instantly to the dashboard.</p>

      <div style={{ marginBottom:22 }}>
        <label style={lbl}>Theme</label>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          {[{ val:"light", icon:<Sun size={16}/>, label:"Light" },{ val:"dark", icon:<Moon size={16}/>, label:"Dark (coming soon)" }].map(t => (
            <button key={t.val} disabled={t.val==="dark"}
              style={{ padding:12, borderRadius:10, border:"2px solid", borderColor:t.val==="light"?"#0D1B3E":"#E2E8F0", background:t.val==="light"?"#EEF0F5":"#fff", cursor:t.val==="dark"?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:10, opacity:t.val==="dark"?0.45:1, fontFamily:"Inter,sans-serif" }}>
              <div style={{ color:t.val==="light"?"#0D1B3E":"#94A3B8" }}>{t.icon}</div>
              <span style={{ fontSize:"0.85rem", fontWeight:600, color:t.val==="light"?"#0D1B3E":"#64748B" }}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom:22 }}>
        <label style={lbl}>Accent Color — <span style={{ color:settings.accentColor, fontWeight:700 }}>active</span></label>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {["#F59E0B","#6366F1","#10B981","#EF4444","#3B82F6","#EC4899","#0D1B3E"].map(c => (
            <button key={c} onClick={() => onChange({ accentColor:c })}
              style={{ width:34, height:34, borderRadius:"50%", background:c, border:settings.accentColor===c?"3px solid #0D1B3E":"3px solid transparent", cursor:"pointer", outline:settings.accentColor===c?`2px solid ${c}`:"none", outlineOffset:2, transition:"all 0.15s" }}/>
          ))}
        </div>
        <p style={{ fontSize:"0.7rem", color:"#94A3B8", marginTop:6 }}>Affects sidebar, badges and highlights.</p>
      </div>

      <div style={{ marginBottom:22 }}>
        <label style={lbl}>Font Size</label>
        <div style={{ display:"flex", gap:8 }}>
          {(["small","medium","large"] as AppSettings["fontSize"][]).map(s => (
            <button key={s} onClick={() => onChange({ fontSize:s })}
              style={{ flex:1, padding:9, borderRadius:8, border:"2px solid", borderColor:settings.fontSize===s?"#0D1B3E":"#E2E8F0", background:settings.fontSize===s?"#EEF0F5":"#fff", cursor:"pointer", fontSize:"0.83rem", fontWeight:settings.fontSize===s?700:500, color:settings.fontSize===s?"#0D1B3E":"#64748B", fontFamily:"Inter,sans-serif" }}>
              {s.charAt(0).toUpperCase()+s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label style={lbl}>Layout Density</label>
        <div style={{ display:"flex", gap:8 }}>
          {(["compact","comfortable","spacious"] as AppSettings["density"][]).map(d => (
            <button key={d} onClick={() => onChange({ density:d })}
              style={{ flex:1, padding:9, borderRadius:8, border:"2px solid", borderColor:settings.density===d?"#0D1B3E":"#E2E8F0", background:settings.density===d?"#EEF0F5":"#fff", cursor:"pointer", fontSize:"0.78rem", fontWeight:settings.density===d?700:500, color:settings.density===d?"#0D1B3E":"#64748B", fontFamily:"Inter,sans-serif" }}>
              {d.charAt(0).toUpperCase()+d.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
