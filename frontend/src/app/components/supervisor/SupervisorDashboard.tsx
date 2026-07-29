/**
 * SupervisorDashboard.tsx — Main layout: sidebar nav + tab routing.
 * Imports the 3 tab components and shared types.
 */
import { useState } from "react";
import { Settings, Database, LogOut, Bell, Cpu, Shield, ChevronRight } from "lucide-react";
import type { AuthUser } from "@/app/auth";
import finvisionLogo from "@/imports/Gemini_Generated_Image_zcm87kzcm87kzcm8__1_-Photoroom.png";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import type { Tab } from "./shared";
import { ModelConfigTab }   from "./ModelConfigTab";
import { AIParamsTab }      from "./AIParamsTab";
import { SystemMonitorTab } from "./SystemMonitorTab";

interface Props { onLogout: () => void; user: AuthUser | null; }

export function SupervisorDashboard({ onLogout, user }: Props) {
  const displayName = user?.name ?? "Supervisor";
  const initials    = displayName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const [activeTab, setActiveTab] = useState<Tab>("model");

  const NAV_TABS = [
    { id:"model"     as Tab, icon:Cpu,      label:"Model Config",   desc:"LLM & Embedding" },
    { id:"ai-params" as Tab, icon:Settings, label:"AI Parameters",  desc:"RAG & Inference" },
    { id:"system"    as Tab, icon:Database, label:"System Monitor", desc:"DB & Backup" },
  ];

  const headerTitles: Record<Tab,{title:string;sub:string}> = {
    "model":     { title:"Model Configuration",  sub:"Manage LLM models — changes apply instantly to all queries" },
    "ai-params": { title:"AI / RAG Parameters",  sub:"Fine-tune inference and retrieval — saved to database" },
    "system":    { title:"System Monitoring",     sub:"Real-time database health, audit logs and backup management" },
  };

  return (
    <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", height:"100vh", background:"#F4F6FB", fontFamily:"Inter,sans-serif" }}>

      {/* ── Sidebar ── */}
      <div style={{ background:"#0D1B3E", display:"flex", flexDirection:"column", height:"100vh", position:"sticky", top:0 }}>

        {/* Logo */}
        <div style={{ padding:"20px 16px 14px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          <ImageWithFallback src={finvisionLogo} alt="FinVision"
            style={{ width:"100%", height:52, objectFit:"contain", objectPosition:"left center", display:"block" }}/>
          <div style={{ marginTop:8, display:"flex", alignItems:"center", gap:5 }}>
            <Shield size={10} color="rgba(255,255,255,0.35)"/>
            <p style={{ color:"rgba(255,255,255,0.35)", fontSize:"0.58rem", fontWeight:700, letterSpacing:"0.12em", textTransform:"uppercase" }}>System Supervisor</p>
          </div>
        </div>

        {/* User */}
        <div style={{ padding:"14px 16px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ width:34, height:34, borderRadius:"50%", background:"#EF4444", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ color:"#fff", fontWeight:700, fontSize:"0.8rem" }}>{initials}</span>
            </div>
            <div>
              <p style={{ color:"#fff", fontWeight:600, fontSize:"0.83rem" }}>{displayName}</p>
              <p style={{ color:"rgba(255,255,255,0.45)", fontSize:"0.68rem" }}>System Supervisor</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex:1, padding:"16px 12px" }}>
          <p style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.62rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8, paddingLeft:8 }}>Control Center</p>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {NAV_TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  style={{ width:"100%", display:"flex", alignItems:"center", gap:11, padding:"10px 12px", borderRadius:9, border:"none", cursor:"pointer", textAlign:"left", transition:"all 0.15s", background:active?"#F59E0B":"transparent", color:active?"#0D1B3E":"rgba(255,255,255,0.55)", fontFamily:"Inter,sans-serif" }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                  <tab.icon size={15} style={{ flexShrink:0 }}/>
                  <div>
                    <p style={{ fontWeight:active?700:500, fontSize:"0.83rem", lineHeight:1 }}>{tab.label}</p>
                    <p style={{ fontSize:"0.63rem", marginTop:2, opacity:0.65 }}>{tab.desc}</p>
                  </div>
                  {active && <ChevronRight size={14} style={{ marginLeft:"auto", flexShrink:0 }}/>}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Logout */}
        <div style={{ padding:"14px 12px", borderTop:"1px solid rgba(255,255,255,0.08)" }}>
          <button onClick={onLogout}
            style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px", border:"none", borderRadius:8, background:"transparent", cursor:"pointer", color:"rgba(255,255,255,0.4)", fontSize:"0.82rem", transition:"color 0.15s", fontFamily:"Inter,sans-serif" }}
            onMouseEnter={e => e.currentTarget.style.color = "#fff"}
            onMouseLeave={e => e.currentTarget.style.color = "rgba(255,255,255,0.4)"}>
            <LogOut size={15}/> Sign Out
          </button>
        </div>
      </div>

      {/* ── Main content ── */}
      <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>

        {/* Header */}
        <div style={{ background:"#fff", borderBottom:"1px solid #E8EAF0", padding:"0 28px", height:62, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
          <div>
            <h1 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"1.05rem", lineHeight:1 }}>{headerTitles[activeTab].title}</h1>
            <p style={{ color:"#64748B", fontSize:"0.75rem", marginTop:3 }}>{headerTitles[activeTab].sub}</p>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 12px", borderRadius:999, background:"#D1FAE5", border:"1px solid #6EE7B7" }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:"#10B981" }}/>
              <span style={{ fontSize:"0.7rem", fontWeight:700, color:"#065F46" }}>All Systems Operational</span>
            </div>
            <button style={{ width:34, height:34, borderRadius:8, border:"1.5px solid #E8EAF0", background:"#fff", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
              <Bell size={16} color="#64748B"/>
            </button>
          </div>
        </div>

        {/* Tab content */}
        <div style={{ flex:1, overflowY:"auto", scrollbarWidth:"none" }}>
          {activeTab === "model"     && <ModelConfigTab/>}
          {activeTab === "ai-params" && <AIParamsTab/>}
          {activeTab === "system"    && <SystemMonitorTab/>}
        </div>
      </div>
    </div>
  );
}
