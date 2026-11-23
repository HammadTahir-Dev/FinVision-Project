/**
 * PlansTab.tsx — Supervisor: edit subscription plans (prices, currency, limits,
 * features, visibility) and see subscribers / revenue. Changes apply instantly.
 */
import { useEffect, useState } from "react";
import { Save, CheckCircle, Users, DollarSign, TrendingUp, CreditCard, Plus, AlertCircle, Eye, EyeOff, Star } from "lucide-react";
import {
  adminGetPlans, adminUpdatePlan, adminCreatePlan, adminBillingStats, formatPrice,
  type Plan, type LimitKey,
} from "@/app/api";

const NAVY = "#0D1B3E";
const LIMITS: { key: LimitKey; label: string; unit?: string }[] = [
  { key: "uploads",      label: "File uploads / month" },
  { key: "chat_queries", label: "AI questions / month" },
  { key: "forecasts",    label: "Forecasts / month" },
  { key: "reports",      label: "Reports / month" },
  { key: "max_file_mb",  label: "Max file size", unit: "MB" },
];

type Draft = Plan & { featuresText: string };
const toDraft = (p: Plan): Draft => ({ ...p, featuresText: (p.features || []).join("\n") });

const input = { width: "100%", padding: "7px 9px", borderRadius: 7, border: "1px solid #E2E8F0", fontSize: "0.8rem", color: NAVY, fontFamily: "Inter, sans-serif", outline: "none", boxSizing: "border-box" } as const;
const lbl = { fontSize: "0.66rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.06em", display: "block", marginBottom: 4 } as const;

function money(map: Record<string, number>) {
  const e = Object.entries(map);
  return e.length ? e.map(([c, v]) => formatPrice(v, c)).join(" + ") : formatPrice(0, "USD");
}

export function PlansTab() {
  const [plans, setPlans]   = useState<Draft[]>([]);
  const [stats, setStats]   = useState<Awaited<ReturnType<typeof adminBillingStats>> | null>(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [saved, setSaved]   = useState<number | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [newPlan, setNewPlan] = useState({ code: "", name: "", price_monthly: 0, price_yearly: 0 });
  const [showNew, setShowNew] = useState(false);

  async function load() {
    try {
      const [p, s] = await Promise.all([adminGetPlans(), adminBillingStats()]);
      setPlans(p.map(toDraft)); setStats(s);
    } catch (e: any) { setError(e.message); }
  }
  useEffect(() => { load(); }, []);

  const edit = (id: number, patch: Partial<Draft>) => setPlans(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p));
  const editLimit = (id: number, key: LimitKey, v: number) =>
    setPlans(prev => prev.map(p => p.id === id ? { ...p, limits: { ...p.limits, [key]: v } } : p));

  async function save(p: Draft) {
    setSaving(p.id); setError(null);
    try {
      const updated = await adminUpdatePlan(p.id, {
        name: p.name, tagline: p.tagline, price_monthly: Number(p.price_monthly), price_yearly: Number(p.price_yearly),
        currency: p.currency, limits: p.limits, features: p.featuresText.split("\n"),
        is_active: p.is_active, highlighted: p.highlighted, sort_order: Number(p.sort_order),
      });
      setPlans(prev => prev.map(x => x.id === p.id ? { ...toDraft(updated), subscribers: x.subscribers } : x));
      setSaved(p.id); setTimeout(() => setSaved(null), 2500);
      adminBillingStats().then(setStats).catch(() => {});
    } catch (e: any) { setError(`${p.name}: ${e.message}`); }
    finally { setSaving(null); }
  }

  async function create() {
    setError(null);
    try {
      await adminCreatePlan({ ...newPlan, features: [] });
      setNewPlan({ code: "", name: "", price_monthly: 0, price_yearly: 0 }); setShowNew(false);
      load();
    } catch (e: any) { setError(e.message); }
  }

  const statCards = stats ? [
    { icon: <Users size={16} />, label: "Paying subscribers", value: `${stats.paying} / ${stats.total_subscriptions}`, color: "#6366F1" },
    { icon: <TrendingUp size={16} />, label: "Monthly recurring revenue", value: money(stats.mrr), color: "#10B981" },
    { icon: <DollarSign size={16} />, label: "Revenue this month", value: money(stats.revenue_this_month), color: "#F59E0B" },
    { icon: <CreditCard size={16} />, label: "Payment provider", value: stats.payment_provider === "demo" ? "Demo (no charges)" : stats.payment_provider, color: "#64748B" },
  ] : [];

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 18, fontFamily: "Inter, sans-serif" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        {statCards.map(c => (
          <div key={c.label} style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, color: c.color }}>{c.icon}<span style={{ fontSize: "0.7rem", fontWeight: 700, color: "#64748B" }}>{c.label}</span></div>
            <p style={{ fontSize: "1.15rem", fontWeight: 800, color: NAVY, marginTop: 8 }}>{c.value}</p>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 9, background: "#FEF2F2", border: "1px solid #FECACA", display: "flex", gap: 8, alignItems: "center" }}>
          <AlertCircle size={15} color="#DC2626" /><span style={{ fontSize: "0.8rem", color: "#DC2626" }}>{error}</span>
        </div>
      )}

      <p style={{ fontSize: "0.78rem", color: "#64748B" }}>
        Changes apply immediately to the pricing page and to everyone's limits. Use <b>-1</b> for unlimited. Existing subscribers renew at the new price.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        {plans.map(p => (
          <div key={p.id} style={{ background: "#fff", borderRadius: 12, border: `1px solid ${p.is_active ? "#E8EAF0" : "#FECACA"}`, padding: 18, display: "flex", flexDirection: "column", gap: 12, opacity: p.is_active ? 1 : 0.8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input value={p.name} onChange={e => edit(p.id, { name: e.target.value })} style={{ ...input, fontWeight: 800, fontSize: "0.95rem", flex: 1 }} />
              <span style={{ fontSize: "0.65rem", fontFamily: "monospace", color: "#94A3B8" }}>{p.code}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#EEF0F5", color: "#5A6480" }}>{p.subscribers ?? 0} subscriber{p.subscribers === 1 ? "" : "s"}</span>
              {p.is_default && <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#DBEAFE", color: "#1E40AF" }}>Default for new users</span>}
            </div>
            <div>
              <label style={lbl}>Tagline</label>
              <input value={p.tagline ?? ""} onChange={e => edit(p.id, { tagline: e.target.value })} style={input} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 80px", gap: 8 }}>
              <div><label style={lbl}>Monthly price</label><input type="number" min={0} step="0.01" value={p.price_monthly} onChange={e => edit(p.id, { price_monthly: e.target.value as any })} style={input} /></div>
              <div><label style={lbl}>Yearly price</label><input type="number" min={0} step="0.01" value={p.price_yearly} onChange={e => edit(p.id, { price_yearly: e.target.value as any })} style={input} /></div>
              <div><label style={lbl}>Currency</label><input value={p.currency} maxLength={3} onChange={e => edit(p.id, { currency: e.target.value.toUpperCase() })} style={input} /></div>
            </div>
            <div>
              <label style={lbl}>Limits</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {LIMITS.map(l => {
                  const v = p.limits?.[l.key] ?? -1;
                  const unlimited = v === -1;
                  return (
                    <div key={l.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, fontSize: "0.77rem", color: "#374151" }}>{l.label}</span>
                      <input type="number" min={0} disabled={unlimited} value={unlimited ? "" : v} placeholder="∞"
                        onChange={e => editLimit(p.id, l.key, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                        style={{ ...input, width: 90, background: unlimited ? "#F8FAFC" : "#fff" }} />
                      <span style={{ fontSize: "0.7rem", color: "#94A3B8", width: 22 }}>{l.unit ?? ""}</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.7rem", color: "#64748B", cursor: "pointer", width: 82 }}>
                        <input type="checkbox" checked={unlimited} onChange={e => editLimit(p.id, l.key, e.target.checked ? -1 : (l.key === "max_file_mb" ? 50 : 100))} />
                        Unlimited
                      </label>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={lbl}>Features shown on the card (one per line)</label>
              <textarea value={p.featuresText} rows={5} onChange={e => edit(p.id, { featuresText: e.target.value })} style={{ ...input, resize: "vertical", lineHeight: 1.5 }} />
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "#374151", cursor: p.is_default ? "not-allowed" : "pointer" }}>
                <input type="checkbox" checked={p.is_active} disabled={p.is_default} onChange={e => edit(p.id, { is_active: e.target.checked })} />
                {p.is_active ? <Eye size={13} /> : <EyeOff size={13} />} Visible to users
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "#374151", cursor: "pointer" }}>
                <input type="checkbox" checked={p.highlighted} onChange={e => edit(p.id, { highlighted: e.target.checked })} />
                <Star size={13} /> "Most popular"
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "0.75rem", color: "#374151" }}>
                Order <input type="number" value={p.sort_order} onChange={e => edit(p.id, { sort_order: Number(e.target.value) })} style={{ ...input, width: 56, padding: "4px 6px" }} />
              </label>
            </div>
            <button onClick={() => save(p)} disabled={saving === p.id}
              style={{ marginTop: "auto", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 12px", borderRadius: 8, border: "none", background: saved === p.id ? "#10B981" : NAVY, color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: saving === p.id ? "wait" : "pointer", fontFamily: "Inter, sans-serif" }}>
              {saved === p.id ? <><CheckCircle size={14} /> Saved</> : <><Save size={14} /> {saving === p.id ? "Saving…" : `Save ${p.name}`}</>}
            </button>
          </div>
        ))}

        {/* New plan */}
        <div style={{ background: "#fff", borderRadius: 12, border: "1px dashed #CBD5E1", padding: 18, display: "flex", flexDirection: "column", gap: 10, justifyContent: showNew ? "flex-start" : "center", alignItems: showNew ? "stretch" : "center", minHeight: 160 }}>
          {!showNew ? (
            <button onClick={() => setShowNew(true)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", color: "#64748B", fontSize: "0.85rem", fontWeight: 700, fontFamily: "Inter, sans-serif" }}>
              <Plus size={16} /> Add a plan
            </button>
          ) : (
            <>
              <p style={{ fontWeight: 800, color: NAVY, fontSize: "0.9rem" }}>New plan</p>
              <div><label style={lbl}>Code (e.g. team)</label><input value={newPlan.code} onChange={e => setNewPlan({ ...newPlan, code: e.target.value.toLowerCase() })} style={input} /></div>
              <div><label style={lbl}>Name</label><input value={newPlan.name} onChange={e => setNewPlan({ ...newPlan, name: e.target.value })} style={input} /></div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><label style={lbl}>Monthly</label><input type="number" min={0} value={newPlan.price_monthly} onChange={e => setNewPlan({ ...newPlan, price_monthly: Number(e.target.value) })} style={input} /></div>
                <div><label style={lbl}>Yearly</label><input type="number" min={0} value={newPlan.price_yearly} onChange={e => setNewPlan({ ...newPlan, price_yearly: Number(e.target.value) })} style={input} /></div>
              </div>
              <p style={{ fontSize: "0.7rem", color: "#94A3B8" }}>Starts with unlimited usage and 50 MB files — set limits after creating it.</p>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setShowNew(false)} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", cursor: "pointer", fontSize: "0.78rem", fontFamily: "Inter, sans-serif" }}>Cancel</button>
                <button onClick={create} disabled={!newPlan.code || !newPlan.name} style={{ flex: 1, padding: "8px", borderRadius: 8, border: "none", background: NAVY, color: "#fff", cursor: "pointer", fontSize: "0.78rem", fontWeight: 700, fontFamily: "Inter, sans-serif", opacity: !newPlan.code || !newPlan.name ? 0.5 : 1 }}>Create</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
