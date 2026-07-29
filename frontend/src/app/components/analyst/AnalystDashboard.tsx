import React, { useState, useRef, useEffect, useCallback } from "react";
import { Upload, MessageSquare, TrendingUp, FileText, LogOut, Bell, Settings, Wand2 } from "lucide-react";
import type { AuthUser } from "@/app/auth";
import finvisionLogo from "@/imports/Gemini_Generated_Image_zcm87kzcm87kzcm8__1_-Photoroom.png";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import { UploadData }     from "./UploadData";
import { AnalyzeChat }    from "./AnalyzeChat";
import { PreprocessData } from "./PreprocessData";
import { Forecast }       from "./Forecast";
import { MyReports }      from "./MyReports";
import { NotificationsPanel } from "./NotificationsPanel";
import { SettingsDrawer }     from "./settings/SettingsDrawer";
import {
  loadSettings, saveSettings, defaultSettings, initials,
  mapLogToNotification, FONT_SIZE_MAP, DENSITY_PAD_MAP,
  type AppSettings, type AppNotification,
} from "./types";
import { getSystemLogs } from "@/app/api";

const TABS = [
  { id:"upload",     label:"Upload Data",    Icon:Upload,        desc:"Source Management" },
  { id:"preprocess", label:"Preprocess",     Icon:Wand2,         desc:"Data Preparation" },
  { id:"chat",       label:"Analyze & Chat", Icon:MessageSquare, desc:"AI Workspace" },
  { id:"forecast",   label:"Forecast",       Icon:TrendingUp,    desc:"Predictive Analytics" },
  { id:"reports",    label:"My Reports",     Icon:FileText,      desc:"Export Engine" },
];

function useClickOutside(ref: React.RefObject<HTMLElement | null>, cb: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) cb(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [ref, cb]);
}

interface Props { onLogout: () => void; user: AuthUser | null; }

export function AnalystDashboard({ onLogout, user }: Props) {
  const [settings, setSettingsState]      = useState<AppSettings>(() => loadSettings(user));
  const [activeTab, setActiveTab]         = useState("upload");
  const [showNotifications, setShowNoti]  = useState(false);
  const [showSettings, setShowSettings]   = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const notiRef = useRef<HTMLDivElement>(null);
  useClickOutside(notiRef, () => setShowNoti(false));

  // Load real notifications from system logs
  useEffect(() => {
    getSystemLogs(15).then(logs => setNotifications(logs.map(mapLogToNotification))).catch(() => {});
  }, []);

  // Poll every 30s for new notifications
  useEffect(() => {
    const id = setInterval(() => {
      getSystemLogs(15).then(logs => {
        setNotifications(prev => logs.map((l: any, i: number) => ({
          ...mapLogToNotification(l, i),
          read: prev.find(p => p.id === l.id)?.read ?? false,
        })));
      }).catch(() => {});
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const updateSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState(prev => { const next = { ...prev, ...patch }; saveSettings(next); return next; });
  }, []);

  const unread   = notifications.filter(n => !n.read).length;
  const name     = settings.displayName;
  const ini      = initials(name);
  const accent   = settings.accentColor;
  const tabInfo  = TABS.find(t => t.id === activeTab)!;

  return (
    <div style={{ display:"grid", gridTemplateColumns:"220px 1fr", height:"100vh", background:"#F4F6FB", fontFamily:"Inter,sans-serif", fontSize:FONT_SIZE_MAP[settings.fontSize] }}>

      {/* Sidebar */}
      <div style={{ background:"#0D1B3E", display:"flex", flexDirection:"column", height:"100vh", position:"sticky", top:0 }}>
        <div style={{ padding:"20px 16px 16px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          <ImageWithFallback src={finvisionLogo} alt="FinVision" style={{ width:"100%", height:52, objectFit:"contain", objectPosition:"left center", display:"block" }}/>
        </div>
        <div style={{ padding:"14px 18px", borderBottom:"1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:36, height:36, borderRadius:"50%", background:accent, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.8rem" }}>{ini}</span>
            </div>
            <div style={{ overflow:"hidden" }}>
              <p style={{ color:"#fff", fontWeight:600, fontSize:"0.83rem", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{name}</p>
              <p style={{ color:"rgba(255,255,255,0.45)", fontSize:"0.68rem" }}>{settings.jobTitle}</p>
            </div>
          </div>
        </div>
        <nav style={{ flex:1, padding:"14px 12px" }}>
          <p style={{ color:"rgba(255,255,255,0.3)", fontSize:"0.62rem", fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:8, paddingLeft:8 }}>Workspace</p>
          <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
            {TABS.map(tab => {
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  style={{ width:"100%", display:"flex", alignItems:"center", gap:12, padding:"10px 12px", borderRadius:9, border:"none", cursor:"pointer", textAlign:"left", transition:"all 0.15s", background:active?accent:"transparent", color:active?"#0D1B3E":"rgba(255,255,255,0.6)", fontFamily:"Inter,sans-serif" }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = "rgba(255,255,255,0.07)"; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = "transparent"; }}>
                  <tab.Icon size={16} style={{ flexShrink:0 }}/>
                  <div>
                    <p style={{ fontWeight:active?700:500, fontSize:"0.83rem", lineHeight:1 }}>{tab.label}</p>
                    <p style={{ fontSize:"0.63rem", marginTop:2, opacity:0.7 }}>{tab.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </nav>
        <div style={{ padding:"14px 12px", borderTop:"1px solid rgba(255,255,255,0.08)" }}>
          <button onClick={onLogout}
            style={{ width:"100%", display:"flex", alignItems:"center", gap:10, padding:"10px 12px", border:"none", borderRadius:8, background:"transparent", cursor:"pointer", color:"rgba(255,255,255,0.4)", fontSize:"0.82rem", transition:"color 0.15s", fontFamily:"Inter,sans-serif" }}
            onMouseEnter={e => e.currentTarget.style.color="#fff"}
            onMouseLeave={e => e.currentTarget.style.color="rgba(255,255,255,0.4)"}>
            <LogOut size={15}/> Sign Out
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>
        {/* Header */}
        <div style={{ background:"#fff", borderBottom:"1px solid #E8EAF0", padding:"0 28px", height:62, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, position:"relative", zIndex:100 }}>
          <div>
            <h1 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"1.05rem", lineHeight:1 }}>{tabInfo.label}</h1>
            <p style={{ color:"#64748B", fontSize:"0.75rem", marginTop:3 }}>{tabInfo.desc}</p>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {/* Bell */}
            <div ref={notiRef} style={{ position:"relative" }}>
              <button onClick={() => setShowNoti(v => !v)}
                style={{ width:36, height:36, borderRadius:9, border:"1.5px solid", borderColor:showNotifications?"#0D1B3E":"#E8EAF0", background:showNotifications?"#EEF0F5":"#fff", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", position:"relative", transition:"all 0.15s" }}>
                <Bell size={17} color={showNotifications?"#0D1B3E":"#64748B"}/>
                {unread > 0 && (
                  <span style={{ position:"absolute", top:4, right:4, minWidth:16, height:16, borderRadius:999, background:accent, border:"2px solid #fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"0.55rem", fontWeight:800, color:"#fff", padding:"0 3px" }}>
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
              {showNotifications && (
                <NotificationsPanel
                  onClose={() => setShowNoti(false)}
                  notifications={notifications}
                  setNotifications={setNotifications}/>
              )}
            </div>
            {/* Settings */}
            <button onClick={() => setShowSettings(true)}
              style={{ width:36, height:36, borderRadius:9, border:"1.5px solid #E8EAF0", background:"#fff", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", transition:"all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor="#0D1B3E"; e.currentTarget.style.background="#EEF0F5"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor="#E8EAF0"; e.currentTarget.style.background="#fff"; }}>
              <Settings size={17} color="#64748B"/>
            </button>
            {/* Avatar */}
            <div style={{ width:36, height:36, borderRadius:"50%", background:"#0D1B3E", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
              <span style={{ color:accent, fontWeight:700, fontSize:"0.78rem" }}>{ini}</span>
            </div>
          </div>
        </div>

        {/* Tab content */}
        <div style={{ flex:1, padding:DENSITY_PAD_MAP[settings.density], overflow:"auto", scrollbarWidth:"none" }}>
          <div style={{ height:"100%" }}>
            {activeTab === "upload"     && <UploadData/>}
            {activeTab === "preprocess" && <PreprocessData/>}
            {activeTab === "chat"       && <AnalyzeChat/>}
            {activeTab === "forecast"   && <Forecast/>}
            {activeTab === "reports"    && <MyReports/>}
          </div>
        </div>
      </div>

      {/* Settings drawer */}
      {showSettings && (
        <SettingsDrawer
          settings={settings}
          onChange={updateSettings}
          onClose={() => setShowSettings(false)}
          userEmail={user?.email ?? "analyst@finvision.com"}/>
      )}
    </div>
  );
}
