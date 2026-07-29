import { NotiRow } from "./SettingsShared";
import type { AppSettings } from "../types";

interface Props { settings: AppSettings; onChange: (p: Partial<AppSettings>) => void; }

const NOTI_LABELS: Record<keyof AppSettings["notiPrefs"], { label:string; desc:string }> = {
  forecastReady:  { label:"Forecast Ready",    desc:"When an AI forecast completes" },
  dataIndexed:    { label:"Data Indexed",      desc:"When a file finishes processing" },
  ragWarnings:    { label:"RAG Warnings",      desc:"When retrieval quality degrades" },
  reportExported: { label:"Report Exported",   desc:"When a report export completes" },
  systemAlerts:   { label:"System Alerts",     desc:"Critical alerts from supervisor" },
  weeklyDigest:   { label:"Weekly Digest",     desc:"Activity summary every Monday" },
};

export function NotificationsTab({ settings, onChange }: Props) {
  return (
    <div>
      <h3 style={{ color:"#0D1B3E", fontWeight:700, fontSize:"0.95rem", marginBottom:4 }}>Notification Preferences</h3>
      <p style={{ color:"#94A3B8", fontSize:"0.78rem", marginBottom:20 }}>Choose which events trigger in-app notifications.</p>
      {(Object.keys(settings.notiPrefs) as (keyof AppSettings["notiPrefs"])[]).map(key => (
        <NotiRow key={key}
          label={NOTI_LABELS[key].label}
          desc={NOTI_LABELS[key].desc}
          checked={settings.notiPrefs[key]}
          onToggle={() => onChange({ notiPrefs:{ ...settings.notiPrefs, [key]:!settings.notiPrefs[key] } })}/>
      ))}
    </div>
  );
}
