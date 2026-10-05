import { useState, useEffect } from "react";
import { Save, RotateCcw } from "lucide-react";
import { getAvailableModels, updateSystemSettings } from "@/app/api";
import type { AppSettings } from "../types";
import { inp, lbl, Toggle } from "./SettingsShared";

interface Props { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; }

export function AIPrefsTab({ settings, onChange }: Props) {
  const [saving, setSaving]             = useState(false);
  const [saved, setSaved]               = useState(false);
  const [availableModels, setAvailableModels] = useState<any[]>([]);

  useEffect(() => { getAvailableModels().then(setAvailableModels).catch(()=>{}); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSystemSettings({ llm_model: settings.defaultModel });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch(e) { console.error(e); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <h3 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem", marginBottom:4 }}>AI Preferences</h3>
      <p style={{ color:"#94A3B8", fontSize:"0.78rem", marginBottom:20 }}>Saved to backend — affects all AI queries system-wide.</p>
      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        <div>
          <label style={lbl}>Preferred LLM Model</label>
          <select value={settings.defaultModel} onChange={e => onChange({ defaultModel:e.target.value })} style={{ ...inp, cursor:"pointer" }}>
            {availableModels.length > 0
              ? availableModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
              : ["openai/gpt-oss-20b","llama-3.1-70b-versatile","gemma2-9b-it"].map(m => <option key={m}>{m}</option>)}
          </select>
          <p style={{ fontSize:"0.7rem", color:"#94A3B8", marginTop:4 }}>Updates the active model for all AI queries system-wide.</p>
        </div>

        <div>
          <label style={lbl}>Response Style</label>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10 }}>
            {[{ val:"concise",label:"Concise",desc:"Short, direct" },{ val:"balanced",label:"Balanced",desc:"Detail + clarity" },{ val:"detailed",label:"Detailed",desc:"Full explanation" }].map(s => (
              <button key={s.val} onClick={() => onChange({ responseStyle:s.val })}
                style={{ padding:12, borderRadius:9, border:"2px solid", borderColor:settings.responseStyle===s.val?"#0D1B3E":"#E2E8F0", background:settings.responseStyle===s.val?"#EEF0F5":"#fff", cursor:"pointer", textAlign:"left", fontFamily:"Inter,sans-serif" }}>
                <p style={{ fontWeight:700, fontSize:"0.83rem", color:settings.responseStyle===s.val?"#0D1B3E":"#64748B" }}>{s.label}</p>
                <p style={{ fontSize:"0.68rem", color:"#94A3B8", marginTop:3 }}>{s.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label style={lbl}>Voice Input Language</label>
          <select value={settings.voiceLang} onChange={e => onChange({ voiceLang:e.target.value })} style={{ ...inp, cursor:"pointer" }}>
            {[["en-US","English (US)"],["en-GB","English (UK)"],["es-ES","Spanish"],["fr-FR","French"],["de-DE","German"],["ar-SA","Arabic"],["zh-CN","Chinese"]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {[
          { key:"citationsEnabled" as const, label:"Show Source Citations", desc:"Display references alongside AI responses" },
          { key:"streamingEnabled" as const,  label:"Streaming Responses",  desc:"Stream tokens as they are generated" },
        ].map(t => (
          <div key={t.key} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0", borderTop:"1px solid #F8FAFC" }}>
            <div>
              <p style={{ fontSize:"0.85rem", fontWeight:600, color:"#0D1B3E" }}>{t.label}</p>
              <p style={{ fontSize:"0.72rem", color:"#94A3B8", marginTop:2 }}>{t.desc}</p>
            </div>
            <Toggle val={settings[t.key]} onToggle={() => onChange({ [t.key]:!settings[t.key] })}/>
          </div>
        ))}

        <button onClick={handleSave} disabled={saving}
          style={{ padding:"10px 20px", background:saving?"#1A2D5A":"#0D1B3E", color:"#fff", border:"none", borderRadius:8, fontWeight:700, fontSize:"0.85rem", cursor:saving?"not-allowed":"pointer", display:"flex", alignItems:"center", gap:8, alignSelf:"flex-start", fontFamily:"Inter,sans-serif" }}>
          {saving?<><RotateCcw size={14}/> Saving…</>:<><Save size={14}/> Save AI Preferences</>}
        </button>
      </div>
    </div>
  );
}
