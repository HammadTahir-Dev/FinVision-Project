import React from "react";

export const inp: React.CSSProperties = {
  width:"100%", padding:"9px 12px", border:"1.5px solid #E2E8F0", borderRadius:8,
  fontSize:"0.85rem", color:"#0D1B3E", outline:"none", background:"#fff",
  boxSizing:"border-box", fontFamily:"Inter,sans-serif", transition:"border-color 0.18s",
};

export const lbl: React.CSSProperties = {
  fontSize:"0.72rem", fontWeight:700, color:"#64748B",
  textTransform:"uppercase", letterSpacing:"0.06em", display:"block", marginBottom:6,
};

export function Toggle({ val, onToggle }: { val:boolean; onToggle:()=>void }) {
  return (
    <button onClick={onToggle} style={{ background:"none", border:"none", cursor:"pointer", padding:0, display:"flex", flexShrink:0 }}>
      <div style={{ width:40, height:22, borderRadius:999, background:val?"#0D1B3E":"#E2E8F0", position:"relative", transition:"background 0.2s" }}>
        <div style={{ position:"absolute", top:3, left:val?21:3, width:16, height:16, borderRadius:"50%", background:"#fff", transition:"left 0.2s", boxShadow:"0 1px 3px rgba(0,0,0,0.2)" }}/>
      </div>
    </button>
  );
}

export function NotiRow({ label, desc, checked, onToggle }: { label:string; desc:string; checked:boolean; onToggle:()=>void }) {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid #F8FAFC" }}>
      <div>
        <p style={{ fontSize:"0.85rem", fontWeight:600, color:"#0D1B3E" }}>{label}</p>
        <p style={{ fontSize:"0.72rem", color:"#94A3B8", marginTop:2 }}>{desc}</p>
      </div>
      <Toggle val={checked} onToggle={onToggle}/>
    </div>
  );
}
