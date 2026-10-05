/**
 * AIParamsTab.tsx — RAG & inference parameter sliders + live sandbox console.
 */
import { useState, useEffect } from "react";
import { Settings, Zap, Save, RefreshCw, CheckCircle, RotateCcw, Play } from "lucide-react";
import { getSystemSettings, updateSystemSettings, sandboxQuery } from "@/app/api";
import { SliderControl, PRESETS } from "./shared";

export function AIParamsTab() {
  const [temperature, setTemperature] = useState(0.35);
  const [maxTokens, setMaxTokens]     = useState(2048);
  const [chunkSize, setChunkSize]     = useState(512);
  const [kVal, setKVal]               = useState(6);
  const [topP, setTopP]               = useState(0.90);
  const [freqPenalty, setFreqPenalty] = useState(0.20);
  const [activePreset, setActivePreset] = useState<string|null>("balanced");
  const [llmModel, setLlmModel]       = useState("openai/gpt-oss-20b");
  const [saving, setSaving]           = useState(false);
  const [saved, setSaved]             = useState(false);
  const [error, setError]             = useState("");
  const [sandboxPrompt, setSandboxPrompt] = useState("");
  const [sandboxResult, setSandboxResult] = useState("");
  const [sandboxMeta, setSandboxMeta] = useState<any>(null);
  const [testing, setTesting]         = useState(false);

  useEffect(() => {
    getSystemSettings().then(s => {
      setTemperature(s.temperature); setMaxTokens(s.max_tokens);
      setChunkSize(s.chunk_size);   setKVal(s.k_value);
      setTopP(s.top_p);             setFreqPenalty(s.freq_penalty);
      setLlmModel(s.llm_model);
    }).catch(() => {});
  }, []);

  const applyPreset = (name: "precise"|"balanced"|"creative") => {
    const p = PRESETS[name];
    setTemperature(p.temperature); setMaxTokens(p.max_tokens);
    setChunkSize(p.chunk_size);   setKVal(p.k_value);
    setTopP(p.top_p);             setFreqPenalty(p.freq_penalty);
    setActivePreset(name);
  };

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      await updateSystemSettings({ temperature, max_tokens:maxTokens, chunk_size:chunkSize, k_value:kVal, top_p:topP, freq_penalty:freqPenalty });
      setSaved(true); setTimeout(() => setSaved(false), 2500);
    } catch (e:any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const runSandbox = async () => {
    if (!sandboxPrompt.trim()) return;
    setTesting(true); setSandboxResult(""); setSandboxMeta(null);
    try {
      const r = await sandboxQuery({ question:sandboxPrompt, temperature, max_tokens:maxTokens, k_value:kVal, llm_model:llmModel });
      setSandboxResult(r.answer || "No response.");
      setSandboxMeta({ latency:r.latency_ms, citations:r.citations?.length||0, chunks:kVal });
    } catch (e:any) { setSandboxResult(`Error: ${e.message}`); }
    finally { setTesting(false); }
  };

  const presets = [
    { key:"precise",  label:"Precise",  desc:"Low temp, high retrieval", color:"#6366F1" },
    { key:"balanced", label:"Balanced", desc:"Recommended defaults",      color:"#10B981" },
    { key:"creative", label:"Creative", desc:"Higher temperature",        color:"#F59E0B" },
  ];

  return (
    <div style={{ padding:"24px 28px", display:"grid", gap:20 }}>
      {error && <div style={{ padding:"10px 14px", borderRadius:8, background:"#FEF2F2", border:"1px solid #FECACA", color:"#DC2626", fontSize:"0.82rem" }}>{error}</div>}

      {/* Presets */}
      <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:20 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
          <h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem" }}>Configuration Presets</h2>
          <span style={{ fontSize:"0.72rem", color:"#94A3B8" }}>Select or fine-tune manually</span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16 }}>
          {presets.map(p => (
            <button key={p.key} onClick={() => applyPreset(p.key as any)}
              style={{ padding:14, borderRadius:10, border:"2px solid", borderColor:activePreset===p.key?p.color:"#E2E8F0", background:activePreset===p.key?p.color+"12":"#fff", cursor:"pointer", textAlign:"left", transition:"all 0.15s", fontFamily:"Inter,sans-serif" }}>
              <p style={{ fontWeight:700, fontSize:"0.88rem", color:activePreset===p.key?p.color:"#0D1B3E" }}>{p.label}</p>
              <p style={{ fontSize:"0.72rem", color:"#94A3B8", marginTop:3 }}>{p.desc}</p>
              {activePreset===p.key && <div style={{ marginTop:6, display:"flex", alignItems:"center", gap:4 }}><CheckCircle size={11} color={p.color}/><span style={{ fontSize:"0.68rem", color:p.color, fontWeight:600 }}>Active</span></div>}
            </button>
          ))}
        </div>
      </div>

      {/* Sliders */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:22 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20 }}><Zap size={16} color="#0D1B3E"/><h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem" }}>Inference Parameters</h2></div>
          <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
            <SliderControl label="Temperature"      value={temperature}  min={0}   max={1}    step={0.01}  unit=""      description="Controls output randomness."       onChange={v=>{setTemperature(v);setActivePreset(null);}}/>
            <SliderControl label="Max Output Tokens" value={maxTokens}   min={256} max={8000} step={256}   unit=" tok"  description="Maximum tokens per response."      onChange={v=>{setMaxTokens(v);setActivePreset(null);}}/>
            <SliderControl label="Top-P"             value={topP}        min={0.1} max={1}    step={0.01}  unit=""      description="Nucleus sampling probability."    onChange={v=>{setTopP(v);setActivePreset(null);}}/>
            <SliderControl label="Frequency Penalty" value={freqPenalty} min={0}   max={2}    step={0.05}  unit=""      description="Penalises repeated tokens."       onChange={v=>{setFreqPenalty(v);setActivePreset(null);}}/>
          </div>
        </div>

        <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:22, display:"flex", flexDirection:"column", gap:20 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20 }}><Settings size={16} color="#0D1B3E"/><h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem" }}>RAG Retrieval Parameters</h2></div>
            <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
              <SliderControl label="Chunk Size"       value={chunkSize} min={128} max={2000} step={128} unit=" chars" description="Character length of indexed chunks." onChange={v=>{setChunkSize(v);setActivePreset(null);}}/>
              <SliderControl label="k-Retrieval Depth" value={kVal}    min={1}   max={20}   step={1}   unit=" chunks" description="Top chunks passed to LLM as context." onChange={v=>{setKVal(v);setActivePreset(null);}}/>
            </div>
          </div>
          <div style={{ display:"flex", gap:12, marginTop:"auto" }}>
            <button onClick={()=>applyPreset("balanced")}
              style={{ display:"flex", alignItems:"center", gap:6, padding:"10px 16px", border:"1.5px solid #E2E8F0", borderRadius:8, background:"#fff", color:"#64748B", fontWeight:600, fontSize:"0.83rem", cursor:"pointer", fontFamily:"Inter,sans-serif" }}>
              <RotateCcw size={14}/> Reset
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ flex:1, padding:10, background:saved?"#10B981":"#F59E0B", color:saved?"#fff":"#0D1B3E", border:"none", borderRadius:8, fontWeight:700, fontSize:"0.87rem", cursor:saving?"not-allowed":"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:8, transition:"background 0.3s", fontFamily:"Inter,sans-serif" }}>
              {saved?<><CheckCircle size={15}/> Saved!</>:saving?<><RefreshCw size={15}/> Saving…</>:<><Save size={15}/> Save to Database</>}
            </button>
          </div>
        </div>
      </div>

      {/* Sandbox */}
      <div style={{ background:"#fff", borderRadius:12, border:"1px solid #E8EAF0", padding:22 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:16 }}>
          <Play size={16} color="#0D1B3E"/>
          <h2 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem" }}>Live Prompt Sandbox</h2>
          <span style={{ marginLeft:"auto", fontSize:"0.72rem", color:"#94A3B8" }}>Real RAG queries your files · Model: <strong style={{ color:"#0D1B3E" }}>{llmModel}</strong></span>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            <textarea value={sandboxPrompt} onChange={e=>setSandboxPrompt(e.target.value)}
              placeholder="e.g. What is the total revenue?" rows={5}
              style={{ resize:"none", padding:"12px 14px", border:"1.5px solid #E2E8F0", borderRadius:8, fontSize:"0.84rem", color:"#0D1B3E", outline:"none", fontFamily:"Inter,sans-serif", lineHeight:1.65, width:"100%", boxSizing:"border-box" }}
              onFocus={e=>e.target.style.borderColor="#0D1B3E"}
              onBlur={e=>e.target.style.borderColor="#E2E8F0"}/>
            <button onClick={runSandbox} disabled={testing||!sandboxPrompt.trim()}
              style={{ padding:11, background:sandboxPrompt.trim()&&!testing?"#0D1B3E":"#EEF0F5", color:sandboxPrompt.trim()&&!testing?"#fff":"#94A3B8", border:"none", borderRadius:8, fontWeight:700, fontSize:"0.87rem", cursor:sandboxPrompt.trim()&&!testing?"pointer":"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", gap:8, fontFamily:"Inter,sans-serif" }}>
              {testing?<><RefreshCw size={14}/> Running…</>:<><Play size={14}/> Run Test Prompt</>}
            </button>
            <div style={{ background:"#F8FAFC", borderRadius:8, padding:"10px 12px", border:"1px solid #E2E8F0" }}>
              <p style={{ fontSize:"0.68rem", fontWeight:700, color:"#64748B", textTransform:"uppercase", marginBottom:6 }}>Active Config</p>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:4 }}>
                {[["Temp",temperature.toFixed(2)],["Top-P",topP.toFixed(2)],["Max Tok",maxTokens],["Chunk",`${chunkSize}c`],["k-val",kVal],["Penalty",freqPenalty.toFixed(2)]].map(([k,v])=>(
                  <div key={k as string} style={{ display:"flex", justifyContent:"space-between", fontSize:"0.72rem" }}>
                    <span style={{ color:"#94A3B8" }}>{k}</span>
                    <span style={{ color:"#0D1B3E", fontFamily:"monospace", fontWeight:600 }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {sandboxMeta && (
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
                {[
                  { label:"Latency",   value:`${sandboxMeta.latency}ms`, color:sandboxMeta.latency>3000?"#EF4444":"#10B981", bg:sandboxMeta.latency>3000?"#FEE2E2":"#D1FAE5" },
                  { label:"Citations", value:sandboxMeta.citations, color:"#6366F1", bg:"#EDE9FE" },
                  { label:"k-Chunks",  value:`top-${sandboxMeta.chunks}`, color:"#F59E0B", bg:"#FEF3C7" },
                ].map(s=>(
                  <div key={s.label} style={{ background:s.bg, borderRadius:8, padding:8, textAlign:"center" }}>
                    <p style={{ fontSize:"0.62rem", color:"#64748B", textTransform:"uppercase", fontWeight:600 }}>{s.label}</p>
                    <p style={{ fontSize:"0.88rem", fontWeight:700, color:s.color, marginTop:2, fontFamily:"monospace" }}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}
            <div style={{ flex:1, background:sandboxResult?"#0D1B3E":"#F8FAFC", borderRadius:8, padding:14, border:"1px solid #E2E8F0", minHeight:160, overflow:"auto" }}>
              {sandboxResult
                ? <pre style={{ fontSize:"0.75rem", color:"#E2E8F0", fontFamily:"monospace", whiteSpace:"pre-wrap", lineHeight:1.65, margin:0 }}>{sandboxResult}</pre>
                : <p style={{ fontSize:"0.82rem", color:"#CBD5E1", fontStyle:"italic", textAlign:"center", marginTop:40 }}>Real RAG response will appear here</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
