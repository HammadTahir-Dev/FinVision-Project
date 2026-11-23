/**
 * Subscription.tsx — Plans & Billing: current plan, this month's usage,
 * plan cards with monthly/yearly toggle, checkout confirmation, invoices.
 */
import { useEffect, useMemo, useState } from "react";
import {
  Check, Crown, Zap, Building2, AlertCircle, CheckCircle, Info, RefreshCw, Receipt,
  Upload, MessageSquare, TrendingUp, FileText, X,
} from "lucide-react";
import {
  getPlans, getBilling, getPayments, checkoutPlan, cancelPlan, resumePlan, formatPrice,
  type Plan, type BillingSummary, type Payment,
} from "../../api";

type Cycle = "monthly" | "yearly";

const NAVY = "#0D1B3E";
const AMBER = "#F59E0B";

const USAGE_ROWS = [
  { key: "chat_queries" as const, label: "AI chat questions", Icon: MessageSquare },
  { key: "uploads"      as const, label: "File uploads",      Icon: Upload },
  { key: "forecasts"    as const, label: "Forecasts",         Icon: TrendingUp },
  { key: "reports"      as const, label: "Reports",           Icon: FileText },
];

function planIcon(code: string) {
  if (code === "business") return <Building2 size={18} />;
  if (code === "pro") return <Zap size={18} />;
  return <Crown size={18} />;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
}

const isFree = (p: Plan) => p.price_monthly === 0 && p.price_yearly === 0;

function Meter({ label, Icon, used, limit }: { label: string; Icon: any; used: number; limit: number }) {
  const unlimited = limit === -1;
  const pct = unlimited ? 0 : limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  const color = pct >= 100 ? "#EF4444" : pct >= 80 ? AMBER : "#10B981";
  return (
    <div style={{ padding: "12px 14px", borderRadius: 10, background: "#F8FAFC", border: "1px solid #E8EAF0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <Icon size={13} color="#64748B" />
        <span style={{ fontSize: "0.74rem", fontWeight: 600, color: "#374151", flex: 1 }}>{label}</span>
        <span style={{ fontSize: "0.74rem", fontWeight: 800, color: NAVY, fontVariantNumeric: "tabular-nums" }}>
          {used.toLocaleString()}<span style={{ color: "#94A3B8", fontWeight: 600 }}> / {unlimited ? "∞" : limit.toLocaleString()}</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "#E2E8F0", overflow: "hidden" }}>
        <div style={{ height: "100%", width: unlimited ? "100%" : `${pct}%`, background: unlimited ? "linear-gradient(90deg,#C7D2FE,#A5B4FC)" : color, borderRadius: 999, transition: "width 0.4s" }} />
      </div>
      <p style={{ fontSize: "0.64rem", color: pct >= 100 ? "#DC2626" : "#94A3B8", marginTop: 5, fontWeight: pct >= 100 ? 700 : 400 }}>
        {unlimited ? "Unlimited on your plan" : pct >= 100 ? "Limit reached — upgrade to continue" : `${(limit - used).toLocaleString()} left this month`}
      </p>
    </div>
  );
}

export function Subscription() {
  const [plans, setPlans]       = useState<Plan[]>([]);
  const [billing, setBilling]   = useState<BillingSummary | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [cycle, setCycle]       = useState<Cycle>("monthly");
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [notice, setNotice]     = useState<string | null>(null);
  const [confirm, setConfirm]   = useState<Plan | null>(null);

  async function load() {
    try {
      setLoading(true); setError(null);
      const [p, b, pay] = await Promise.all([getPlans(), getBilling(), getPayments()]);
      setPlans(p); setBilling(b); setPayments(pay);
      if (!isFree(b.plan)) setCycle(b.subscription.billing_cycle);
    } catch (e: any) {
      setError(`Could not load your subscription: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const bestSaving = useMemo(() => {
    const s = plans.filter(p => p.price_monthly > 0 && p.price_yearly > 0)
      .map(p => 1 - p.price_yearly / (p.price_monthly * 12));
    return s.length ? Math.round(Math.max(...s) * 100) : 0;
  }, [plans]);

  const current = billing?.plan;
  const sub = billing?.subscription;

  function ctaFor(p: Plan): { label: string; disabled: boolean } {
    if (!current || !sub) return { label: "Choose", disabled: true };
    const isCurrent = p.id === current.id && (isFree(p) || sub.billing_cycle === cycle);
    if (isCurrent && sub.cancel_at_period_end && !isFree(p)) return { label: "Resume plan", disabled: false };
    if (isCurrent) return { label: "Current plan", disabled: true };
    if (isFree(p)) {
      return sub.cancel_at_period_end ? { label: `Starts ${fmtDate(sub.current_period_end)}`, disabled: true }
                                      : { label: "Switch to Free", disabled: false };
    }
    if (p.id === current.id) return { label: `Switch to ${cycle}`, disabled: false };
    const price = (x: Plan) => x.price_monthly;
    return { label: price(p) > price(current) ? `Upgrade to ${p.name}` : `Switch to ${p.name}`, disabled: false };
  }

  async function confirmChange() {
    if (!confirm || !current || !sub) return;
    setBusy(true); setError(null);
    try {
      if (confirm.id === current.id && sub.cancel_at_period_end && (isFree(confirm) || sub.billing_cycle === cycle)) {
        setBilling(await resumePlan());
        setNotice(`Your ${confirm.name} plan will keep renewing.`);
      } else {
        const r = await checkoutPlan(confirm.code, cycle);
        setBilling(r.summary);
        setNotice(r.payment
          ? `You're now on ${r.payment.plan_name} (${r.payment.billing_cycle}). Invoice ${r.payment.reference}.`
          : `You'll move to ${confirm.name} on ${fmtDate(r.summary.subscription.current_period_end)}. You keep ${current.name} until then.`);
        setPayments(await getPayments());
      }
      setConfirm(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function doCancel() {
    if (!current || !window.confirm(`Cancel ${current.name}? You keep it until ${fmtDate(sub?.current_period_end)}, then move to Free.`)) return;
    setBusy(true); setError(null);
    try { setBilling(await cancelPlan()); setNotice(`${current.name} will end on ${fmtDate(sub?.current_period_end)}.`); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function doResume() {
    setBusy(true); setError(null);
    try { setBilling(await resumePlan()); setNotice("Your plan will keep renewing."); }
    catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }

  if (loading && !billing) {
    return <div style={{ padding: 40, textAlign: "center", color: "#94A3B8", fontSize: "0.85rem" }}>Loading your plan…</div>;
  }

  const card = { background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0" } as const;
  const confirmAmount = confirm ? (cycle === "yearly" ? confirm.price_yearly : confirm.price_monthly) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1180, margin: "0 auto", fontFamily: "Inter, sans-serif", paddingBottom: 24 }}>

      {error && (
        <div style={{ padding: "10px 14px", borderRadius: 9, background: "#FEF2F2", border: "1px solid #FECACA", display: "flex", gap: 8, alignItems: "center" }}>
          <AlertCircle size={15} color="#DC2626" /><span style={{ fontSize: "0.8rem", color: "#DC2626", flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><X size={14} color="#DC2626" /></button>
        </div>
      )}
      {notice && (
        <div style={{ padding: "10px 14px", borderRadius: 9, background: "#ECFDF5", border: "1px solid #A7F3D0", display: "flex", gap: 8, alignItems: "center" }}>
          <CheckCircle size={15} color="#059669" /><span style={{ fontSize: "0.8rem", color: "#065F46", flex: 1 }}>{notice}</span>
          <button onClick={() => setNotice(null)} style={{ background: "none", border: "none", cursor: "pointer", display: "flex" }}><X size={14} color="#065F46" /></button>
        </div>
      )}

      {/* Current plan + usage */}
      {billing && current && sub && (
        <div style={{ ...card, padding: 20, display: "grid", gridTemplateColumns: "minmax(240px, 300px) 1fr", gap: 20 }}>
          <div style={{ borderRadius: 10, padding: 18, background: `linear-gradient(135deg, ${NAVY}, #1A2D5A)`, color: "#fff", display: "flex", flexDirection: "column" }}>
            <p style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)" }}>Your plan</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
              <span style={{ color: AMBER, display: "flex" }}>{planIcon(current.code)}</span>
              <p style={{ fontSize: "1.35rem", fontWeight: 800 }}>{current.name}</p>
              {billing.unlimited_role && <span style={{ fontSize: "0.6rem", fontWeight: 700, padding: "2px 7px", borderRadius: 999, background: "rgba(245,158,11,0.2)", color: AMBER }}>Supervisor · no limits</span>}
            </div>
            <p style={{ fontSize: "0.85rem", marginTop: 4, color: "rgba(255,255,255,0.8)" }}>
              {isFree(current) ? "Free forever" :
                `${formatPrice(sub.billing_cycle === "yearly" ? current.price_yearly : current.price_monthly, current.currency)} / ${sub.billing_cycle === "yearly" ? "year" : "month"}`}
            </p>
            <div style={{ flex: 1 }} />
            <p style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.6)", marginTop: 16, lineHeight: 1.5 }}>
              {isFree(current) ? `Limits reset on ${fmtDate(billing.resets_at)}.`
                : sub.cancel_at_period_end ? <>Ends on <b style={{ color: "#FCA5A5" }}>{fmtDate(sub.current_period_end)}</b>, then you move to Free.</>
                : <>Renews on <b style={{ color: "#fff" }}>{fmtDate(sub.current_period_end)}</b>.</>}
            </p>
            {!isFree(current) && (
              <button onClick={sub.cancel_at_period_end ? doResume : doCancel} disabled={busy}
                style={{ marginTop: 10, padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.25)", background: sub.cancel_at_period_end ? AMBER : "transparent", color: sub.cancel_at_period_end ? NAVY : "rgba(255,255,255,0.8)", fontSize: "0.75rem", fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "Inter, sans-serif" }}>
                {sub.cancel_at_period_end ? "Keep my plan" : "Cancel plan"}
              </button>
            )}
          </div>

          <div>
            <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
              <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: NAVY }}>Usage this month</h3>
              <span style={{ marginLeft: "auto", fontSize: "0.7rem", color: "#94A3B8" }}>Resets {fmtDate(billing.resets_at)}</span>
              <button onClick={load} title="Refresh" style={{ marginLeft: 8, background: "none", border: "none", cursor: "pointer", display: "flex", color: "#94A3B8" }}><RefreshCw size={13} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 10 }}>
              {USAGE_ROWS.map(r => <Meter key={r.key} label={r.label} Icon={r.Icon} used={billing.usage[r.key].used} limit={billing.unlimited_role ? -1 : billing.usage[r.key].limit} />)}
            </div>
            <p style={{ fontSize: "0.7rem", color: "#64748B", marginTop: 10 }}>
              Maximum file size: <b>{billing.unlimited_role ? "no plan limit" : billing.max_file_mb ? `${billing.max_file_mb} MB` : "—"}</b>
            </p>
          </div>
        </div>
      )}

      {/* Demo-mode notice */}
      {billing?.payment_provider === "demo" && (
        <div style={{ padding: "10px 14px", borderRadius: 9, background: "#EFF6FF", border: "1px solid #BFDBFE", display: "flex", gap: 8, alignItems: "center" }}>
          <Info size={15} color="#2563EB" />
          <span style={{ fontSize: "0.78rem", color: "#1E40AF" }}>
            Payments are in <b>demo mode</b>: choosing a plan activates it instantly and nothing is charged.
          </span>
        </div>
      )}

      {/* Plans */}
      <div style={{ ...card, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
          <div>
            <h3 style={{ fontSize: "1rem", fontWeight: 800, color: NAVY }}>Choose a plan</h3>
            <p style={{ fontSize: "0.75rem", color: "#64748B", marginTop: 2 }}>Upgrade any time. Limits reset on the 1st of every month.</p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", background: "#F1F5F9", borderRadius: 9, padding: 3 }}>
            {(["monthly", "yearly"] as Cycle[]).map(c => (
              <button key={c} onClick={() => setCycle(c)}
                style={{ padding: "7px 14px", borderRadius: 7, border: "none", cursor: "pointer", fontSize: "0.76rem", fontWeight: 700, fontFamily: "Inter, sans-serif",
                         background: cycle === c ? "#fff" : "transparent", color: cycle === c ? NAVY : "#64748B", boxShadow: cycle === c ? "0 1px 3px rgba(0,0,0,0.08)" : "none" }}>
                {c === "monthly" ? "Monthly" : "Yearly"}
                {c === "yearly" && bestSaving > 0 && <span style={{ marginLeft: 6, fontSize: "0.62rem", padding: "1px 6px", borderRadius: 999, background: "#D1FAE5", color: "#047857" }}>Save {bestSaving}%</span>}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`, gap: 14 }}>
          {plans.map(p => {
            const cta = ctaFor(p);
            const isCurrent = current?.id === p.id;
            const price = cycle === "yearly" ? p.price_yearly : p.price_monthly;
            const perMonth = cycle === "yearly" && p.price_yearly > 0 ? p.price_yearly / 12 : null;
            return (
              <div key={p.id} style={{ position: "relative", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column",
                                       border: `${p.highlighted ? 2 : 1}px solid ${p.highlighted ? AMBER : isCurrent ? NAVY : "#E2E8F0"}`,
                                       background: p.highlighted ? "#FFFBEB" : "#fff" }}>
                {p.highlighted && <span style={{ position: "absolute", top: -11, left: 20, fontSize: "0.62rem", fontWeight: 800, padding: "3px 10px", borderRadius: 999, background: AMBER, color: NAVY, letterSpacing: "0.04em" }}>MOST POPULAR</span>}
                {isCurrent && <span style={{ position: "absolute", top: 14, right: 14, fontSize: "0.6rem", fontWeight: 800, padding: "2px 8px", borderRadius: 999, background: NAVY, color: "#fff" }}>CURRENT</span>}
                <div style={{ display: "flex", alignItems: "center", gap: 8, color: NAVY }}>
                  {planIcon(p.code)}<p style={{ fontSize: "1.05rem", fontWeight: 800 }}>{p.name}</p>
                </div>
                <p style={{ fontSize: "0.74rem", color: "#64748B", marginTop: 4, minHeight: 32 }}>{p.tagline}</p>
                <div style={{ marginTop: 10, display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ fontSize: "2rem", fontWeight: 800, color: NAVY, letterSpacing: "-0.02em" }}>{formatPrice(price, p.currency)}</span>
                  <span style={{ fontSize: "0.78rem", color: "#64748B" }}>{isFree(p) ? "" : cycle === "yearly" ? "/ year" : "/ month"}</span>
                </div>
                <p style={{ fontSize: "0.7rem", color: "#94A3B8", minHeight: 16 }}>
                  {perMonth ? `${formatPrice(Math.round(perMonth * 100) / 100, p.currency)} per month, billed yearly` : isFree(p) ? "No card needed" : "Billed monthly"}
                </p>
                <button disabled={cta.disabled || busy} onClick={() => setConfirm(p)}
                  style={{ marginTop: 14, padding: "10px 12px", borderRadius: 8, border: cta.disabled ? "1px solid #E2E8F0" : "none", fontSize: "0.8rem", fontWeight: 700, fontFamily: "Inter, sans-serif",
                           cursor: cta.disabled ? "default" : "pointer",
                           background: cta.disabled ? "#F8FAFC" : p.highlighted ? AMBER : NAVY,
                           color: cta.disabled ? "#94A3B8" : p.highlighted ? NAVY : "#fff" }}>
                  {cta.label}
                </button>
                <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
                  {p.features.map((f, i) => (
                    <li key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: "0.77rem", color: "#374151" }}>
                      <Check size={14} color="#10B981" style={{ flexShrink: 0, marginTop: 1 }} />{f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </div>

      {/* Billing history */}
      <div style={{ ...card, padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <Receipt size={16} color={NAVY} />
          <h3 style={{ fontSize: "0.9rem", fontWeight: 700, color: NAVY }}>Billing history</h3>
        </div>
        {payments.length === 0 ? (
          <p style={{ fontSize: "0.78rem", color: "#94A3B8", padding: "10px 0" }}>No payments yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.77rem" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#64748B", borderBottom: "1px solid #E8EAF0" }}>
                  {["Date", "Invoice", "Plan", "Period", "Amount", "Status"].map(h => <th key={h} style={{ padding: "8px 10px", fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #F1F5F9", color: NAVY }}>
                    <td style={{ padding: "9px 10px", whiteSpace: "nowrap" }}>{fmtDate(p.created_at)}</td>
                    <td style={{ padding: "9px 10px", fontFamily: "monospace", fontSize: "0.72rem" }}>{p.reference}</td>
                    <td style={{ padding: "9px 10px" }}>{p.plan_name} <span style={{ color: "#94A3B8" }}>· {p.billing_cycle}</span></td>
                    <td style={{ padding: "9px 10px", whiteSpace: "nowrap", color: "#64748B" }}>{fmtDate(p.period_start)} – {fmtDate(p.period_end)}</td>
                    <td style={{ padding: "9px 10px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{formatPrice(p.amount, p.currency)}</td>
                    <td style={{ padding: "9px 10px" }}>
                      <span style={{ fontSize: "0.65rem", fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: p.status === "paid" ? "#D1FAE5" : "#FEE2E2", color: p.status === "paid" ? "#047857" : "#B91C1C" }}>
                        {p.status}{p.provider === "demo" ? " (demo)" : ""}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      {confirm && current && sub && (
        <div onClick={() => !busy && setConfirm(null)} style={{ position: "fixed", inset: 0, background: "rgba(13,27,62,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 24, width: "100%", maxWidth: 420, boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>
            <h3 style={{ fontSize: "1.05rem", fontWeight: 800, color: NAVY }}>
              {isFree(confirm) ? "Switch to Free?" : confirm.id === current.id && sub.cancel_at_period_end && sub.billing_cycle === cycle ? `Keep ${confirm.name}?` : `Confirm ${confirm.name}`}
            </h3>
            {isFree(confirm) ? (
              <p style={{ fontSize: "0.82rem", color: "#475569", marginTop: 10, lineHeight: 1.6 }}>
                You keep <b>{current.name}</b> until <b>{fmtDate(sub.current_period_end)}</b>. After that you move to Free and its limits apply. You can change your mind before then.
              </p>
            ) : confirm.id === current.id && sub.cancel_at_period_end && sub.billing_cycle === cycle ? (
              <p style={{ fontSize: "0.82rem", color: "#475569", marginTop: 10, lineHeight: 1.6 }}>Your plan will keep renewing on {fmtDate(sub.current_period_end)}.</p>
            ) : (
              <>
                <div style={{ marginTop: 14, padding: 14, borderRadius: 10, background: "#F8FAFC", border: "1px solid #E8EAF0", fontSize: "0.82rem", color: NAVY }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>{confirm.name} · {cycle}</span><b>{formatPrice(confirmAmount, confirm.currency)}</b></div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#64748B", fontSize: "0.74rem", marginTop: 6 }}>
                    <span>Starts</span><span>Today</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#64748B", fontSize: "0.74rem", marginTop: 4 }}>
                    <span>Renews</span><span>every {cycle === "yearly" ? "year" : "month"} until canceled</span>
                  </div>
                </div>
                {!isFree(current) && <p style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 8 }}>Your new plan starts immediately and replaces {current.name}.</p>}
                {billing?.payment_provider === "demo" && (
                  <p style={{ fontSize: "0.74rem", color: "#1E40AF", marginTop: 8, display: "flex", gap: 6 }}><Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />Demo mode — no card is charged.</p>
                )}
              </>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 18, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirm(null)} disabled={busy}
                style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #E2E8F0", background: "#fff", color: "#475569", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", fontFamily: "Inter, sans-serif" }}>Back</button>
              <button onClick={confirmChange} disabled={busy}
                style={{ padding: "9px 16px", borderRadius: 8, border: "none", background: NAVY, color: "#fff", fontSize: "0.8rem", fontWeight: 700, cursor: busy ? "wait" : "pointer", fontFamily: "Inter, sans-serif" }}>
                {busy ? "Working…" : isFree(confirm) ? "Switch at period end" : confirm.id === current.id && sub.cancel_at_period_end && sub.billing_cycle === cycle ? "Keep plan" : `Pay ${formatPrice(confirmAmount, confirm.currency)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
