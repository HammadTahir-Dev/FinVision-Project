/**
 * shared.tsx — Shared components, types and constants for Supervisor Dashboard.
 */
import { Info, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

export type Tab = "model" | "ai-params" | "system" | "plans";

export const PRESETS = {
  precise:  { temperature: 0.10, max_tokens: 4096, chunk_size: 256,  k_value: 10, top_p: 0.85, freq_penalty: 0.10 },
  balanced: { temperature: 0.35, max_tokens: 2048, chunk_size: 512,  k_value: 6,  top_p: 0.90, freq_penalty: 0.20 },
  creative: { temperature: 0.80, max_tokens: 1024, chunk_size: 1024, k_value: 4,  top_p: 0.95, freq_penalty: 0.40 },
};

export function SliderControl({ label, value, min, max, step, unit, description, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; description?: string; onChange: (v: number) => void;
}) {
  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <div>
          <label style={{ fontSize:"0.82rem", fontWeight:600, color:"#0D1B3E" }}>{label}</label>
          {description && <p style={{ fontSize:"0.7rem", color:"#94A3B8", marginTop:1 }}>{description}</p>}
        </div>
        <span style={{ fontSize:"0.83rem", fontWeight:700, color:"#0D1B3E", background:"#EEF0F5", padding:"3px 10px", borderRadius:6, fontFamily:"monospace", minWidth:72, textAlign:"center" }}>
          {typeof value==="number" && !Number.isInteger(value) ? value.toFixed(2) : value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width:"100%", accentColor:"#0D1B3E", cursor:"pointer", height:4 }} />
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:"0.62rem", color:"#94A3B8", marginTop:3 }}>
        <span>{min}{unit}</span><span>{max}{unit}</span>
      </div>
    </div>
  );
}

export function LevelIcon({ level }: { level: string }) {
  const map: Record<string,{icon:React.ReactNode;color:string;bg:string}> = {
    info:    { icon:<Info size={12}/>,          color:"#6366F1", bg:"#EDE9FE" },
    warn:    { icon:<AlertTriangle size={12}/>,  color:"#F59E0B", bg:"#FEF3C7" },
    success: { icon:<CheckCircle size={12}/>,   color:"#10B981", bg:"#D1FAE5" },
    error:   { icon:<XCircle size={12}/>,       color:"#EF4444", bg:"#FEE2E2" },
  };
  const c = map[level] || map.info;
  return (
    <div style={{ width:22, height:22, borderRadius:6, background:c.bg, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, color:c.color }}>
      {c.icon}
    </div>
  );
}
