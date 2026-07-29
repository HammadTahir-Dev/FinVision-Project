/**
 * SettingsDrawer.tsx — Main settings panel. Imports all 5 tab components.
 */
import { useState } from "react";
import type { ElementType } from "react";
import { X, User, Bell, Palette, Brain, Shield, Save, CheckCircle } from "lucide-react";
import type { AppSettings } from "../types";
import { ProfileTab }       from "./ProfileTab";
import { NotificationsTab } from "./NotificationsTab";
import { AppearanceTab }    from "./AppearanceTab";
import { AIPrefsTab }       from "./AIPrefsTab";
import { SecurityTab }      from "./SecurityTab";

type SettingsTab = "profile" | "notifications" | "appearance" | "ai" | "security";

const NAV: { id: SettingsTab; icon: ElementType; label: string }[] = [
  { id:"profile",       icon:User,    label:"Profile" },
  { id:"notifications", icon:Bell,    label:"Notifications" },
  { id:"appearance",    icon:Palette, label:"Appearance" },
  { id:"ai",            icon:Brain,   label:"AI Preferences" },
  { id:"security",      icon:Shield,  label:"Security" },
];

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  onClose: () => void;
  userEmail: string;
}

export function SettingsDrawer({ settings, onChange, onClose, userEmail }: Props) {
  const [tab, setTab]     = useState<SettingsTab>("profile");
  const [saved, setSaved] = useState(false);

  const handleSave = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  return (
    <div style={{ position:"fixed", inset:0, zIndex:2000, display:"flex" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ flex:1, background:"rgba(0,0,0,0.35)" }}/>
      <div style={{ width:680, background:"#fff", height:"100vh", display:"flex", flexDirection:"column", boxShadow:"-12px 0 48px rgba(0,0,0,0.15)", animation:"slideIn 0.22s ease" }}>

        {/* Header */}
        <div style={{ padding:"20px 24px", borderBottom:"1px solid #E8EAF0", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div>
            <h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"1.1rem" }}>Settings</h2>
            <p style={{ color:"#94A3B8", fontSize:"0.78rem", marginTop:2 }}>Changes apply immediately and are saved automatically</p>
          </div>
          <button onClick={onClose} style={{ width:32, height:32, borderRadius:8, border:"1.5px solid #E8EAF0", background:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#64748B" }}>
            <X size={16}/>
          </button>
        </div>

        <div style={{ display:"flex", flex:1, overflow:"hidden" }}>
          {/* Sidebar nav */}
          <div style={{ width:170, background:"#F8FAFC", borderRight:"1px solid #E8EAF0", padding:"14px 10px", flexShrink:0 }}>
            {NAV.map(n => (
              <button key={n.id} onClick={() => setTab(n.id)}
                style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px", borderRadius:8, border:"none", cursor:"pointer", textAlign:"left", marginBottom:2, transition:"all 0.15s", background:tab===n.id?"#0D1B3E":"transparent", color:tab===n.id?"#fff":"#64748B", fontFamily:"Inter,sans-serif" }}>
                <n.icon size={15} style={{ flexShrink:0 }}/>
                <span style={{ fontSize:"0.83rem", fontWeight:tab===n.id?700:500 }}>{n.label}</span>
              </button>
            ))}
          </div>

          {/* Content pane */}
          <div style={{ flex:1, overflowY:"auto", padding:24, scrollbarWidth:"thin" }}>
            {tab === "profile"       && <ProfileTab       settings={settings} onChange={onChange} userEmail={userEmail}/>}
            {tab === "notifications" && <NotificationsTab settings={settings} onChange={onChange}/>}
            {tab === "appearance"    && <AppearanceTab    settings={settings} onChange={onChange}/>}
            {tab === "ai"            && <AIPrefsTab       settings={settings} onChange={onChange}/>}
            {tab === "security"      && <SecurityTab/>}
          </div>
        </div>

        {/* Footer — only for tabs that don't have their own save button */}
        {tab !== "security" && tab !== "ai" && (
          <div style={{ padding:"14px 24px", borderTop:"1px solid #E8EAF0", display:"flex", justifyContent:"flex-end", gap:10, flexShrink:0 }}>
            <button onClick={onClose} style={{ padding:"9px 20px", border:"1.5px solid #E2E8F0", borderRadius:8, background:"#fff", color:"#64748B", fontWeight:600, fontSize:"0.85rem", cursor:"pointer", fontFamily:"Inter,sans-serif" }}>Close</button>
            <button onClick={handleSave}
              style={{ padding:"9px 24px", background:saved?"#10B981":"#0D1B3E", color:"#fff", border:"none", borderRadius:8, fontWeight:700, fontSize:"0.85rem", cursor:"pointer", display:"flex", alignItems:"center", gap:8, transition:"background 0.25s", fontFamily:"Inter,sans-serif" }}>
              {saved?<><CheckCircle size={15}/> Saved!</>:<><Save size={15}/> Save Changes</>}
            </button>
          </div>
        )}
      </div>
      <style>{`@keyframes slideIn { from { transform:translateX(100%); opacity:0; } to { transform:translateX(0); opacity:1; } }`}</style>
    </div>
  );
}
