/**
 * NotificationsPanel.tsx — Bell dropdown with real system log notifications.
 */
import { Dispatch, SetStateAction } from "react";
import { X, Check, CheckCheck, CheckCircle, AlertTriangle, Info } from "lucide-react";
import type { AppNotification } from "./types";

function NotiIcon({ type }: { type: AppNotification["type"] }) {
  const map = {
    success: { icon: <CheckCircle size={14} />, color: "#10B981", bg: "#D1FAE5" },
    info:    { icon: <Info size={14} />,         color: "#6366F1", bg: "#EDE9FE" },
    warn:    { icon: <AlertTriangle size={14} />, color: "#F59E0B", bg: "#FEF3C7" },
    error:   { icon: <AlertTriangle size={14} />, color: "#EF4444", bg: "#FEE2E2" },
  };
  const c = map[type];
  return (
    <div style={{ width:32, height:32, borderRadius:9, background:c.bg, color:c.color, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
      {c.icon}
    </div>
  );
}

interface Props {
  onClose: () => void;
  notifications: AppNotification[];
  setNotifications: Dispatch<SetStateAction<AppNotification[]>>;
}

export function NotificationsPanel({ onClose, notifications, setNotifications }: Props) {
  const unread = notifications.filter(n => !n.read).length;

  return (
    <div style={{ position:"absolute", top:52, right:80, width:360, zIndex:1000, background:"#fff", borderRadius:14, border:"1px solid #E8EAF0", boxShadow:"0 12px 40px rgba(0,0,0,0.14)", overflow:"hidden" }}>
      {/* Header */}
      <div style={{ padding:"16px 18px 12px", borderBottom:"1px solid #F0F2F7", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <h3 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem" }}>Notifications</h3>
          {unread > 0 && <span style={{ background:"#F59E0B", color:"#fff", borderRadius:999, fontSize:"0.65rem", fontWeight:700, padding:"2px 7px" }}>{unread} new</span>}
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {unread > 0 && (
            <button onClick={() => setNotifications(p => p.map(n => ({ ...n, read:true })))}
              style={{ display:"flex", alignItems:"center", gap:4, padding:"4px 10px", borderRadius:6, border:"1px solid #E8EAF0", background:"#fff", cursor:"pointer", fontSize:"0.72rem", color:"#5A6480", fontWeight:600, fontFamily:"Inter,sans-serif" }}>
              <CheckCheck size={12}/> All read
            </button>
          )}
          {notifications.length > 0 && (
            <button onClick={() => setNotifications([])}
              style={{ padding:"4px 10px", borderRadius:6, border:"1px solid #E8EAF0", background:"#fff", cursor:"pointer", fontSize:"0.72rem", color:"#EF4444", fontWeight:600, fontFamily:"Inter,sans-serif" }}>
              Clear
            </button>
          )}
          <button onClick={onClose} style={{ width:26, height:26, borderRadius:6, border:"1px solid #E8EAF0", background:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#94A3B8" }}>
            <X size={13}/>
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ maxHeight:400, overflowY:"auto", scrollbarWidth:"thin" }}>
        {notifications.length === 0 ? (
          <div style={{ padding:"40px 20px", textAlign:"center", color:"#94A3B8", fontSize:"0.85rem" }}>
            <CheckCircle size={32} color="#E8EAF0" style={{ margin:"0 auto 10px", display:"block" }}/>
            All caught up!
          </div>
        ) : notifications.map(n => (
          <div key={n.id}
            style={{ padding:"13px 18px", display:"flex", gap:12, background:n.read?"#fff":"#FAFBFF", borderBottom:"1px solid #F8F9FA", transition:"background 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#F8FAFC")}
            onMouseLeave={e => (e.currentTarget.style.background = n.read ? "#fff" : "#FAFBFF")}>
            <NotiIcon type={n.type}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:6 }}>
                <p style={{ fontSize:"0.82rem", fontWeight:n.read?500:700, color:"#0D1B3E", lineHeight:1.3 }}>{n.title}</p>
                {!n.read && <div style={{ width:7, height:7, borderRadius:"50%", background:"#F59E0B", flexShrink:0, marginTop:4 }}/>}
              </div>
              <p style={{ fontSize:"0.75rem", color:"#64748B", marginTop:3, lineHeight:1.45 }}>{n.body}</p>
              <p style={{ fontSize:"0.68rem", color:"#94A3B8", marginTop:5 }}>{n.time}</p>
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:4, flexShrink:0 }}>
              {!n.read && (
                <button onClick={() => setNotifications(p => p.map(x => x.id===n.id ? { ...x, read:true } : x))}
                  title="Mark read" style={{ width:22, height:22, borderRadius:5, border:"1px solid #E8EAF0", background:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#10B981" }}>
                  <Check size={11}/>
                </button>
              )}
              <button onClick={() => setNotifications(p => p.filter(x => x.id !== n.id))}
                title="Dismiss" style={{ width:22, height:22, borderRadius:5, border:"1px solid #E8EAF0", background:"#fff", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#94A3B8" }}>
                <X size={11}/>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
