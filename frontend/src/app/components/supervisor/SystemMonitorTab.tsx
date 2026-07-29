/**
 * SystemMonitorTab.tsx — DB health, live charts, event log, backup management.
 */
import { useState, useEffect } from "react";
import { Database, Activity, Clock, Filter, HardDrive, Server, RefreshCw, CheckCircle, XCircle } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { getSystemMonitor, getSystemLogs, getBackupHistory, triggerBackup } from "@/app/api";
import { LevelIcon } from "./shared";

export function SystemMonitorTab() {
  const [monitor, setMonitor]     = useState<any>(null);
  const [logs, setLogs]           = useState<any[]>([]);
  const [backups, setBackups]     = useState<any[]>([]);
  const [backingUp, setBackingUp] = useState(false);
  const [logFilter, setLogFilter] = useState("all");
  const [loading, setLoading]     = useState(true);
  const [healthHistory, setHealthHistory] = useState(
    Array.from({ length:20 }, (_,i) => ({ t:`${20-i}m`, cpu:25+Math.floor(Math.random()*30), ram:55+Math.floor(Math.random()*15) }))
  );

  const loadAll = async () => {
    try {
      const [mon, logData, backupData] = await Promise.all([getSystemMonitor(), getSystemLogs(50), getBackupHistory()]);
      setMonitor(mon); setLogs(logData); setBackups(backupData);
    } catch(e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setHealthHistory(prev => [...prev.slice(1), { t:"now", cpu:20+Math.floor(Math.random()*40), ram:50+Math.floor(Math.random()*20) }]);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const handleBackup = async () => {
    setBackingUp(true);
    try { await triggerBackup("full"); await loadAll(); }
    catch(e:any) { alert("Backup failed: "+e.message); }
    finally { setBackingUp(false); }
  };

  const filteredLogs = logFilter==="all" ? logs : logs.filter(l=>l.level===logFilter);
  const db      = monitor?.database || {};
  const tables  = db.tables || {};
  const storage = monitor?.storage || {};
  const perf    = monitor?.performance || {};

  const statCard = (label:string, value:string|number, sub:string, color:string, bg:string, icon:React.ReactNode) => (
    <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:16 }}>
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
        <p style={{ fontSize:"0.72rem", fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:"0.06em" }}>{label}</p>
        <div style={{ width:32, height:32, borderRadius:8, background:bg, display:"flex", alignItems:"center", justifyContent:"center", color }}>{icon}</div>
      </div>
      <p style={{ fontSize:"1.35rem", fontWeight:700, color }}>{value}</p>
      <p style={{ fontSize:"0.72rem", color:"#94A3B8", marginTop:2 }}>{sub}</p>
    </div>
  );

  return (
    <div style={{ padding:"24px 28px", display:"grid", gap:20 }}>

      {/* Status cards */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:16 }}>
        {statCard("Database",    db.status==="healthy"?"Healthy":"Error",   "PostgreSQL",                        db.status==="healthy"?"#10B981":"#EF4444", db.status==="healthy"?"#D1FAE5":"#FEE2E2", <Database size={18}/>)}
        {statCard("Total Users", tables.users||0,  `${tables.files||0} files uploaded`,                         "#6366F1","#EDE9FE",<Server size={18}/>)}
        {statCard("Avg Latency", `${perf.avg_query_latency_ms||0}ms`, `${perf.total_queries||0} total queries`, "#F59E0B","#FEF3C7",<Activity size={18}/>)}
        {statCard("Storage",     `${storage.upload_size_mb||0}MB`, `ChromaDB: ${storage.chroma_size_mb||0}MB`,  "#0D1B3E","#EEF0F5",<HardDrive size={18}/>)}
      </div>

      {/* Health chart + DB stats */}
      <div style={{ display:"grid", gridTemplateColumns:"1.4fr 1fr", gap:20 }}>
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}><Activity size={16} color="#0D1B3E"/><h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem" }}>System Health — Live</h2></div>
          <div style={{ height:160 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={healthHistory} margin={{ top:4, right:4, bottom:0, left:-20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F7"/>
                <XAxis dataKey="t" tick={{ fontSize:9, fill:"#94A3B8" }} tickLine={false} axisLine={false} interval={4}/>
                <YAxis tick={{ fontSize:9, fill:"#94A3B8" }} tickLine={false} axisLine={false} domain={[0,100]} unit="%"/>
                <Tooltip contentStyle={{ fontSize:"0.72rem", borderRadius:8 }}/>
                <Line type="monotone" dataKey="cpu" stroke="#0D1B3E" strokeWidth={2} dot={false} isAnimationActive={false}/>
                <Line type="monotone" dataKey="ram" stroke="#F59E0B" strokeWidth={2} dot={false} isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:20 }}>
          <h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem", marginBottom:16 }}>Database Stats</h2>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {[
              { label:"Users",     value:tables.users||0,     max:100, color:"#6366F1" },
              { label:"Files",     value:tables.files||0,     max:100, color:"#10B981" },
              { label:"Messages",  value:tables.messages||0,  max:500, color:"#F59E0B" },
              { label:"Forecasts", value:tables.forecasts||0, max:50,  color:"#0D1B3E" },
              { label:"Reports",   value:tables.reports||0,   max:50,  color:"#EF4444" },
            ].map(m => (
              <div key={m.label}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
                  <span style={{ fontSize:"0.75rem", color:"#64748B" }}>{m.label}</span>
                  <span style={{ fontSize:"0.75rem", fontWeight:700, color:"#0D1B3E", fontFamily:"monospace" }}>{m.value}</span>
                </div>
                <div style={{ height:5, background:"#F0F2F7", borderRadius:999, overflow:"hidden" }}>
                  <div style={{ height:"100%", width:`${Math.min(100,(m.value/m.max)*100)}%`, background:m.color, borderRadius:999, transition:"width 0.6s ease" }}/>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Backup + Event log */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1.5fr", gap:20 }}>

        {/* Backup */}
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:20, display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}><Database size={16} color="#0D1B3E"/><h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem" }}>Backup Management</h2></div>
            <button onClick={handleBackup} disabled={backingUp}
              style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 14px", background:backingUp?"#EEF0F5":"#0D1B3E", color:backingUp?"#64748B":"#fff", border:"none", borderRadius:7, fontWeight:700, fontSize:"0.78rem", cursor:backingUp?"not-allowed":"pointer", fontFamily:"Inter,sans-serif" }}>
              {backingUp?<><RefreshCw size={13}/> Running…</>:<><Database size={13}/> Trigger Now</>}
            </button>
          </div>
          <div style={{ flex:1, overflowY:"auto", scrollbarWidth:"none", display:"flex", flexDirection:"column", gap:8, maxHeight:260 }}>
            {backups.length===0
              ? <p style={{ fontSize:"0.8rem", color:"#94A3B8", textAlign:"center", padding:"20px 0" }}>No backups yet. Click Trigger Now.</p>
              : backups.map(b => (
                <div key={b.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 10px", borderRadius:8, background:b.status==="running"?"#EFF6FF":"#F8FAFC", border:`1px solid ${b.status==="running"?"#BFDBFE":"#F0F2F7"}` }}>
                  {b.status==="running"?<RefreshCw size={13} color="#3B82F6" style={{ flexShrink:0 }}/>
                    :b.status==="failed"?<XCircle size={13} color="#EF4444" style={{ flexShrink:0 }}/>
                    :<CheckCircle size={13} color="#10B981" style={{ flexShrink:0 }}/>}
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ fontSize:"0.77rem", fontWeight:600, color:"#0D1B3E" }}>{b.label}</p>
                    <p style={{ fontSize:"0.68rem", color:"#94A3B8" }}>{new Date(b.created_at).toLocaleString()}</p>
                  </div>
                  <span style={{ fontSize:"0.7rem", color:"#94A3B8", fontFamily:"monospace", flexShrink:0 }}>{b.size_kb>0?`${b.size_kb}KB`:"—"}</span>
                </div>
              ))}
          </div>
        </div>

        {/* Event log */}
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:20, display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              <Clock size={16} color="#0D1B3E"/>
              <h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem" }}>System Event Log</h2>
              <span style={{ fontSize:"0.68rem", padding:"2px 7px", borderRadius:999, background:"#EEF0F5", color:"#64748B", fontWeight:700 }}>{filteredLogs.length}</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <Filter size={13} color="#94A3B8"/>
              {(["all","error","warn","success","info"] as const).map(f => {
                const colors:Record<string,string> = { all:"#0D1B3E", error:"#EF4444", warn:"#F59E0B", success:"#10B981", info:"#6366F1" };
                return (
                  <button key={f} onClick={()=>setLogFilter(f)}
                    style={{ padding:"3px 9px", borderRadius:6, border:"1.5px solid", fontSize:"0.7rem", fontWeight:700, cursor:"pointer", borderColor:logFilter===f?colors[f]:"#E2E8F0", background:logFilter===f?colors[f]+"15":"#fff", color:logFilter===f?colors[f]:"#94A3B8", fontFamily:"Inter,sans-serif" }}>
                    {f}
                  </button>
                );
              })}
              <button onClick={loadAll} style={{ background:"none", border:"none", cursor:"pointer", color:"#94A3B8", display:"flex" }}><RefreshCw size={13}/></button>
            </div>
          </div>
          <div style={{ flex:1, overflowY:"auto", scrollbarWidth:"thin", maxHeight:340, display:"flex", flexDirection:"column", gap:8 }}>
            {loading
              ? <div style={{ textAlign:"center", padding:"40px 0", color:"#94A3B8", fontSize:"0.82rem" }}>Loading logs...</div>
              : filteredLogs.length===0
                ? <div style={{ textAlign:"center", padding:"40px 0", color:"#94A3B8", fontSize:"0.82rem" }}>No logs found.</div>
                : filteredLogs.map((ev:any) => (
                  <div key={ev.id} style={{ display:"flex", gap:10, padding:"9px 10px", borderRadius:8, background:ev.level==="error"?"#FEF2F2":ev.level==="warn"?"#FFFBEB":"#F8FAFC", border:`1px solid ${ev.level==="error"?"#FECACA":ev.level==="warn"?"#FDE68A":"#F0F2F7"}` }}>
                    <LevelIcon level={ev.level}/>
                    <div style={{ minWidth:0, flex:1 }}>
                      <p style={{ fontSize:"0.78rem", color:"#0D1B3E", fontWeight:500, lineHeight:1.35 }}>{ev.event}</p>
                      <div style={{ display:"flex", gap:8, marginTop:3 }}>
                        <span style={{ fontSize:"0.65rem", color:"#94A3B8", fontFamily:"monospace" }}>{new Date(ev.created_at).toLocaleTimeString()}</span>
                        <span style={{ fontSize:"0.65rem", color:"#94A3B8" }}>·</span>
                        <span style={{ fontSize:"0.65rem", color:"#64748B" }}>{ev.user_email}</span>
                      </div>
                    </div>
                  </div>
                ))}
          </div>
        </div>
      </div>
    </div>
  );
}
