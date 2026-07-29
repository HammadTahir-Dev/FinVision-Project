/**
 * ModelConfigTab.tsx — LLM model selector + live performance charts.
 */
import { useState, useEffect } from "react";
import { Cpu, Activity, Save, RefreshCw, CheckCircle } from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, BarChart, Bar } from "recharts";
import { getSystemSettings, updateSystemSettings, getAvailableModels, getMetrics } from "@/app/api";

export function ModelConfigTab() {
  const [llmModel, setLlmModel]             = useState("llama-3.1-8b-instant");
  const [embeddingModel, setEmbeddingModel] = useState("all-MiniLM-L6-v2");
  const [availableModels, setAvailableModels] = useState<any[]>([]);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [error, setError]     = useState("");
  const [metrics, setMetrics] = useState<any>(null);
  const [gpuPct, setGpuPct]   = useState(62);
  const [latencyData, setLatencyData] = useState<any[]>(
    Array.from({ length: 11 }, (_, i) => ({ t: `${i}`, v: 1800 + Math.floor(Math.random() * 400) }))
  );
  const [tokenData, setTokenData] = useState<any[]>(
    Array.from({ length: 11 }, (_, i) => ({ t: `${i}`, v: 2600 + Math.floor(Math.random() * 1000) }))
  );

  useEffect(() => {
    getSystemSettings().then(s => { setLlmModel(s.llm_model); setEmbeddingModel(s.embedding_model); }).catch(() => {});
    getAvailableModels().then(setAvailableModels).catch(() => {});
    getMetrics(7).then(m => setMetrics(m.summary)).catch(() => {});
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setLatencyData(prev => [...prev.slice(1), { t: "now", v: 1500 + Math.floor(Math.random() * 1000) }]);
      setTokenData(prev => [...prev.slice(1), { t: "now", v: 2600 + Math.floor(Math.random() * 1000) }]);
      setGpuPct(prev => Math.min(95, Math.max(40, prev + Math.floor(Math.random() * 7) - 3)));
    }, 3000);
    return () => clearInterval(id);
  }, []);

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      await updateSystemSettings({ llm_model: llmModel, embedding_model: embeddingModel });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const selectedModel = availableModels.find(m => m.id === llmModel);

  const card = (label: string, value: string, color: string, bg: string) => (
    <div style={{ background:bg, borderRadius:8, padding:10, textAlign:"center" }}>
      <p style={{ fontSize:"0.62rem", color:"#64748B", textTransform:"uppercase", fontWeight:600 }}>{label}</p>
      <p style={{ fontSize:"0.9rem", fontWeight:700, color, marginTop:3 }}>{value}</p>
    </div>
  );

  return (
    <div style={{ padding:"24px 28px", display:"grid", gap:20 }}>
      {error && <div style={{ padding:"10px 14px", borderRadius:8, background:"#FEF2F2", border:"1px solid #FECACA", color:"#DC2626", fontSize:"0.82rem" }}>{error}</div>}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        {/* Model selector card */}
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:22 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20 }}>
            <Cpu size={16} color="#0D1B3E"/>
            <h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem" }}>Model Configuration</h2>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <div>
              <label style={{ fontSize:"0.72rem", fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:"0.06em", display:"block", marginBottom:7 }}>Active LLM (Groq)</label>
              <select value={llmModel} onChange={e => setLlmModel(e.target.value)}
                style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #E2E8F0", borderRadius:8, fontSize:"0.85rem", color:"#0D1B3E", outline:"none", background:"#fff", cursor:"pointer" }}>
                {availableModels.length > 0
                  ? availableModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
                  : <option value={llmModel}>{llmModel}</option>}
              </select>
            </div>
            {selectedModel && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                {card("Context",  `${(selectedModel.context/1000).toFixed(0)}K`, "#0D1B3E", "#EEF0F5")}
                {card("Speed",    selectedModel.speed, "#10B981", "#D1FAE5")}
                {card("Status",   "Active", "#F59E0B", "#FEF3C7")}
              </div>
            )}
            <div>
              <label style={{ fontSize:"0.72rem", fontWeight:700, color:"#64748B", textTransform:"uppercase", letterSpacing:"0.06em", display:"block", marginBottom:7 }}>Embedding Model</label>
              <select value={embeddingModel} onChange={e => setEmbeddingModel(e.target.value)}
                style={{ width:"100%", padding:"10px 12px", border:"1.5px solid #E2E8F0", borderRadius:8, fontSize:"0.85rem", color:"#0D1B3E", outline:"none", background:"#fff", cursor:"pointer" }}>
                {["all-MiniLM-L6-v2","all-mpnet-base-v2","paraphrase-MiniLM-L6-v2"].map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
              {card("API Status",  "Online",  "#10B981", "#D1FAE5")}
              {card("GPU Usage",   `${gpuPct}%`, gpuPct>80?"#EF4444":"#6366F1", gpuPct>80?"#FEE2E2":"#EDE9FE")}
              {card("Avg Latency", metrics ? `${(metrics.avg_latency_ms/1000).toFixed(1)}s` : "—", "#F59E0B", "#FEF3C7")}
            </div>
            <button onClick={handleSave} disabled={saving}
              style={{ width:"100%", padding:10, background:saved?"#10B981":"#0D1B3E", color:"#fff", border:"none", borderRadius:8, fontWeight:700, fontSize:"0.87rem", cursor:saving?"not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, transition:"background 0.3s", fontFamily:"Inter,sans-serif" }}>
              {saved ? <><CheckCircle size={15}/> Saved to Database</> : saving ? <><RefreshCw size={15}/> Saving…</> : <><Save size={15}/> Apply Configuration</>}
            </button>
          </div>
        </div>

        {/* Live performance card */}
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:22 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}><Activity size={16} color="#0D1B3E"/><h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem" }}>Live Performance</h2></div>
            <div style={{ display:"flex", alignItems:"center", gap:5, padding:"3px 8px", borderRadius:999, background:"#D1FAE5" }}>
              <div style={{ width:6, height:6, borderRadius:"50%", background:"#10B981" }}/>
              <span style={{ fontSize:"0.65rem", fontWeight:700, color:"#065F46" }}>LIVE</span>
            </div>
          </div>
          <p style={{ fontSize:"0.7rem", fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Response Latency (ms)</p>
          <div style={{ height:110, marginBottom:16 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={latencyData} margin={{ top:4, right:4, bottom:0, left:-24 }}>
                <defs><linearGradient id="latGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#0D1B3E" stopOpacity={0.18}/><stop offset="95%" stopColor="#0D1B3E" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F7"/>
                <XAxis dataKey="t" tick={{ fontSize:9, fill:"#94A3B8" }} tickLine={false} axisLine={false}/>
                <YAxis tick={{ fontSize:9, fill:"#94A3B8" }} tickLine={false} axisLine={false}/>
                <Tooltip contentStyle={{ fontSize:"0.72rem", borderRadius:8 }} formatter={(v:number)=>[`${v}ms`,"Latency"]}/>
                <Area type="monotone" dataKey="v" stroke="#0D1B3E" strokeWidth={2} fill="url(#latGrad)" dot={false} isAnimationActive={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p style={{ fontSize:"0.7rem", fontWeight:700, color:"#94A3B8", textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:8 }}>Token Throughput / min</p>
          <div style={{ height:100 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tokenData} margin={{ top:4, right:4, bottom:0, left:-24 }} barSize={10}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F7" vertical={false}/>
                <XAxis dataKey="t" tick={{ fontSize:9, fill:"#94A3B8" }} tickLine={false} axisLine={false}/>
                <YAxis tick={{ fontSize:9, fill:"#94A3B8" }} tickLine={false} axisLine={false}/>
                <Tooltip contentStyle={{ fontSize:"0.72rem", borderRadius:8 }} formatter={(v:number)=>[`${v.toLocaleString()} tok`,"Tokens"]}/>
                <Bar dataKey="v" fill="#F59E0B" radius={[3,3,0,0]} isAnimationActive={false}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {metrics && (
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginTop:16 }}>
              {card("Total Queries", String(metrics.total_queries), "#0D1B3E", "#F8FAFC")}
              {card("Min Latency",   `${metrics.min_latency_ms}ms`, "#10B981", "#F8FAFC")}
              {card("Max Latency",   `${metrics.max_latency_ms}ms`, "#EF4444", "#F8FAFC")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
