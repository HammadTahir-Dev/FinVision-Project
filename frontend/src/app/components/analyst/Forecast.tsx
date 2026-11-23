import { useState, useEffect } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import {
  TrendingUp, TrendingDown, Minus, Zap, DollarSign,
  BarChart2, PieChart, RefreshCw, AlertCircle,
} from "lucide-react";
import {
  listFiles, getFileMeta, generateForecast,
  type UploadedFile, type ForecastResponse, type ForecastChartPoint,
} from "../../api";

// ── Custom Tooltip ────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0D1B3E", borderRadius: 10, padding: "12px 16px", color: "#fff", fontSize: "0.78rem", boxShadow: "0 8px 24px rgba(0,0,0,0.25)", minWidth: 180 }}>
      <p style={{ fontWeight: 700, marginBottom: 8, color: "#F59E0B" }}>{label}</p>
      {payload.filter((p: any) => p.value != null && !(payload.some((q: any) => q.name === "Actual" && q.value != null) && p.name !== "Actual")).map((p: any) => (
        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", gap: 16, margin: "3px 0" }}>
          <span style={{ color: "rgba(255,255,255,0.65)", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, display: "inline-block" }} />
            {p.name}
          </span>
          <strong style={{ color: p.color }}>{Number(p.value).toLocaleString()}</strong>
        </div>
      ))}
    </div>
  );
};

function formatNumber(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return Number(n.toFixed(2)).toLocaleString();
}

// ── Main Component ────────────────────────────────────────────────────────────
export function Forecast() {
  const [files, setFiles]             = useState<UploadedFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<number | null>(null);
  const [sheets, setSheets]           = useState<string[]>([]);
  const [metrics, setMetrics]         = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>("");
  const [selectedMetric, setSelectedMetric] = useState<string>("");
  const [horizon, setHorizon]         = useState<"6M" | "12M" | "24M">("12M");
  const [forecast, setForecast]       = useState<ForecastResponse | null>(null);
  const [loading, setLoading]         = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(true);

  // Load verified files on mount
  useEffect(() => {
    (async () => {
      try {
        setLoadingFiles(true);
        const all = await listFiles();
        const verified = all.filter(f => f.status === "verified" && (f.file_type === "csv" || f.file_type === "xlsx"));
        setFiles(verified);
        if (verified.length > 0) setSelectedFile(verified[0].id);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoadingFiles(false);
      }
    })();
  }, []);

  // Load sheets + metrics when the file changes, and metrics again when the
  // sheet changes (previously the metric list always came from the first sheet)
  async function loadMeta(fileId: number, sheetName?: string) {
    try {
      setLoadingMeta(true); setError(null);
      setMetrics([]); setSelectedMetric("");
      if (!sheetName) { setSheets([]); setSelectedSheet(""); }
      const meta = await getFileMeta(fileId, sheetName);
      if (!sheetName) {
        setSheets(meta.sheets);
        if (meta.sheets.length > 0) setSelectedSheet(meta.sheets[0]);
      }
      setMetrics(meta.metrics);
      if (meta.metrics.length > 0) setSelectedMetric(meta.metrics[0]);
      else setError("No numeric columns found to forecast in this " + (sheetName ? "sheet." : "file."));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMeta(false);
    }
  }

  useEffect(() => {
    if (selectedFile) { setForecast(null); loadMeta(selectedFile); }
  }, [selectedFile]);

  const handleGenerate = async () => {
    if (!selectedFile || !selectedMetric) {
      setError("Please select a file and metric first.");
      return;
    }
    setLoading(true); setError(null); setForecast(null);
    try {
      const sheetArg = sheets.length > 1 ? selectedSheet : undefined;   // CSV meta reports a dummy "Sheet1"
      const result = await generateForecast(selectedFile, selectedMetric, horizon, sheetArg || undefined);
      setForecast(result);
    } catch (e: any) {
      setError(e.message || "Forecast generation failed.");
    } finally {
      setLoading(false);
    }
  };

  // Build chart data
  const lastActualIdx = forecast ? forecast.chart_data.map(p => p.is_forecast).lastIndexOf(false) : -1;
  const chartData = forecast?.chart_data.map((p: ForecastChartPoint, i: number) => {
    // Start the forecast lines at the last actual point so there's no visual gap
    const join = i === lastActualIdx && lastActualIdx < forecast.chart_data.length - 1;
    return {
      date:     p.date,
      Actual:   p.actual,
      Expected: join ? p.actual : p.expected,
      Best:     join ? p.actual : p.best,
      Worst:    join ? p.actual : p.worst,
    };
  }) || [];

  const historical  = forecast?.chart_data.filter(p => !p.is_forecast) ?? [];
  const todayMarker = historical.length ? historical[historical.length - 1].date : undefined;
  const kpis        = forecast?.kpis;

  const allValues = chartData.flatMap(d => [d.Actual, d.Expected, d.Best, d.Worst].filter(v => v !== null && v !== undefined) as number[]);
  const lo = allValues.length ? Math.min(...allValues) : 0;
  const hi = allValues.length ? Math.max(...allValues) : 100;
  const pad = Math.max((hi - lo) * 0.08, Math.abs(hi) * 0.02, 1);
  const yMin = Math.floor(lo >= 0 ? Math.max(0, lo - pad) : lo - pad);
  const yMax = Math.ceil(hi + pad);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 16, minHeight: 0, fontFamily: "Inter, sans-serif" }}>

      {/* Control bar */}
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", padding: "16px 20px", display: "flex", alignItems: "flex-end", gap: 16, flexShrink: 0, flexWrap: "wrap" }}>

        {/* File selector */}
        <div>
          <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 7 }}>Data Source</label>
          {loadingFiles ? (
            <div style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Loading files...</div>
          ) : files.length === 0 ? (
            <div style={{ fontSize: "0.82rem", color: "#EF4444" }}>No verified CSV/Excel files. Upload first.</div>
          ) : (
            <select value={selectedFile || ""} onChange={e => setSelectedFile(Number(e.target.value))}
              style={{ padding: "8px 12px", border: "1.5px solid #E2E8F0", borderRadius: 8, fontSize: "0.82rem", color: "#0D1B3E", outline: "none", cursor: "pointer" }}>
              {files.map(f => (
                <option key={f.id} value={f.id}>{f.original_name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Sheet selector (XLSX only) */}
        {sheets.length > 1 && (
          <div>
            <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 7 }}>Sheet</label>
            <select value={selectedSheet} onChange={e => { setSelectedSheet(e.target.value); setForecast(null); if (selectedFile) loadMeta(selectedFile, e.target.value); }}
              style={{ padding: "8px 12px", border: "1.5px solid #E2E8F0", borderRadius: 8, fontSize: "0.82rem", color: "#0D1B3E", outline: "none", cursor: "pointer" }}>
              {sheets.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        )}

        {/* Metric selector */}
        <div>
          <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 7 }}>
            Metric {loadingMeta && <span style={{ color: "#F59E0B" }}>loading...</span>}
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {metrics.length === 0 && !loadingMeta && (
              <span style={{ fontSize: "0.82rem", color: "#94A3B8" }}>Select a file first</span>
            )}
            {metrics.map(m => (
              <button key={m} onClick={() => setSelectedMetric(m)}
                style={{
                  padding: "8px 14px", borderRadius: 8, border: "1.5px solid",
                  borderColor: selectedMetric === m ? "#0D1B3E" : "#E2E8F0",
                  background: selectedMetric === m ? "#0D1B3E" : "#fff",
                  color: selectedMetric === m ? "#fff" : "#64748B",
                  fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
                }}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div style={{ width: 1, height: 40, background: "#E8EAF0" }} />

        {/* Horizon */}
        <div>
          <label style={{ fontSize: "0.68rem", fontWeight: 700, color: "#64748B", textTransform: "uppercase", letterSpacing: "0.07em", display: "block", marginBottom: 7 }}>Time Horizon</label>
          <div style={{ display: "flex", gap: 5 }}>
            {(["6M", "12M", "24M"] as const).map(h => (
              <button key={h} onClick={() => setHorizon(h)}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "1.5px solid", cursor: "pointer",
                  fontSize: "0.82rem", fontWeight: 600, transition: "all 0.15s",
                  borderColor: horizon === h ? "#0D1B3E" : "#E2E8F0",
                  background: horizon === h ? "#0D1B3E" : "#fff",
                  color: horizon === h ? "#fff" : "#64748B",
                }}>
                {h}
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        <button onClick={handleGenerate} disabled={loading || !selectedFile || !selectedMetric}
          style={{
            marginLeft: "auto", padding: "10px 22px",
            background: loading ? "#1A2D5A" : "#F59E0B",
            color: loading ? "#fff" : "#0D1B3E",
            border: "none", borderRadius: 9, fontWeight: 700,
            fontSize: "0.87rem", cursor: loading ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
            opacity: (!selectedFile || !selectedMetric) ? 0.5 : 1,
          }}>
          {loading ? <RefreshCw size={15} className="animate-spin" /> : <Zap size={15} />}
          {loading ? "Generating…" : "Generate Forecast"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: "10px 16px", borderRadius: 8, background: "#FEF2F2", border: "1px solid #FECACA", display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
          <AlertCircle size={15} color="#DC2626" />
          <p style={{ fontSize: "0.82rem", color: "#DC2626", flex: 1 }}>{error}</p>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#DC2626" }}>×</button>
        </div>
      )}

      {/* Empty state */}
      {!forecast && !loading && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0" }}>
          <div style={{ width: 60, height: 60, borderRadius: 16, background: "#F8FAFC", border: "1px solid #E8EAF0", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <TrendingUp size={28} color="#CBD5E1" />
          </div>
          <p style={{ fontWeight: 600, color: "#64748B", fontSize: "0.9rem" }}>No forecast generated yet</p>
          <p style={{ color: "#94A3B8", fontSize: "0.8rem" }}>Select a file, metric and horizon then click Generate Forecast</p>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0" }}>
          <RefreshCw size={32} color="#F59E0B" className="animate-spin" />
          <p style={{ fontWeight: 600, color: "#0D1B3E" }}>Generating Prophet forecast…</p>
          <p style={{ color: "#94A3B8", fontSize: "0.8rem" }}>Training on your data and projecting {horizon} ahead</p>
        </div>
      )}

      {/* Forecast results */}
      {forecast && !loading && (
        <div style={{ flex: 1, display: "grid", gap: 16, gridTemplateColumns: "1fr 210px", minHeight: 0 }}>

          {/* Chart */}
          <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E8EAF0", padding: 20, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16, flexShrink: 0 }}>
              <div>
                <h3 style={{ color: "#0D1B3E", fontWeight: 700, fontSize: "0.95rem" }}>
                  {forecast.metric} Forecast — {forecast.horizon} Horizon
                </h3>
                <p style={{ color: "#64748B", fontSize: "0.75rem", marginTop: 3 }}>
                  {forecast.data_points} historical data points · Prophet AI model
                </p>
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {[
                  { color: "#0D1B3E", label: "Actual" },
                  { color: "#F59E0B", label: "Expected" },
                  { color: "#10B981", label: "Best Case" },
                  { color: "#EF4444", label: "Worst Case" },
                ].map(({ color, label }) => (
                  <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <svg width="20" height="8">
                      <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="2" strokeDasharray={label === "Actual" ? "0" : "5 3"} />
                    </svg>
                    <span style={{ fontSize: "0.68rem", color: "#64748B" }}>{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F2F7" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94A3B8" }} tickLine={false} axisLine={false} interval={Math.max(0, Math.floor(chartData.length / 8))} />
                  <YAxis tick={{ fontSize: 10, fill: "#94A3B8" }} tickLine={false} axisLine={false} tickFormatter={v => formatNumber(v)} domain={[yMin, yMax]} width={64} />
                  <Tooltip content={<CustomTooltip />} />
                  {todayMarker && (
                    <ReferenceLine x={todayMarker} stroke="#CBD5E1" strokeDasharray="4 3"
                      label={{ value: "Now", fill: "#94A3B8", fontSize: 9, position: "insideTopRight" }} />
                  )}
                  <Line dataKey="Actual"   stroke="#0D1B3E" strokeWidth={2.5} dot={{ r: 3, fill: "#0D1B3E", strokeWidth: 0 }} connectNulls={false} animationDuration={600} />
                  <Line dataKey="Best"     stroke="#10B981" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} animationDuration={700} />
                  <Line dataKey="Worst"    stroke="#EF4444" strokeWidth={1.5} strokeDasharray="5 4" dot={false} connectNulls={false} animationDuration={700} />
                  <Line dataKey="Expected" stroke="#F59E0B" strokeWidth={2.2} strokeDasharray="7 3" dot={false} connectNulls={false} animationDuration={800} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div style={{ marginTop: 12, padding: "8px 12px", borderRadius: 8, background: "#F8FAFC", border: "1px solid #E8EAF0", display: "flex", gap: 8, alignItems: "flex-start", flexShrink: 0 }}>
              <Zap size={13} color="#F59E0B" style={{ flexShrink: 0, marginTop: 1 }} />
              <p style={{ fontSize: "0.72rem", color: "#64748B", lineHeight: 1.5 }}>
                Prophet AI model trained on {forecast.data_points} data points from {forecast.sheet_name !== "default" ? forecast.sheet_name : "your file"}. Confidence interval: 95%.
              </p>
            </div>
          </div>

          {/* KPI Cards */}
          {kpis && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, overflowY: "auto", scrollbarWidth: "none" }}>
              {[
                { label: "Current Value",       value: formatNumber(kpis.current_value),    sub: "Latest data point",          icon: DollarSign,  color: "#0D1B3E", bg: "#EEF0F5" },
                { label: "Next Period",          value: formatNumber(kpis.next_period),      sub: "Expected next month",        icon: TrendingUp,  color: "#F59E0B", bg: "#FEF3C7" },
                { label: "YoY Growth",           value: `${kpis.yoy_growth_pct > 0 ? "+" : ""}${kpis.yoy_growth_pct.toFixed(1)}%`, sub: "Year over year", icon: kpis.yoy_growth_pct >= 0 ? TrendingUp : TrendingDown, color: kpis.yoy_growth_pct >= 0 ? "#10B981" : "#EF4444", bg: kpis.yoy_growth_pct >= 0 ? "#D1FAE5" : "#FEE2E2" },
                { label: "Best Case Total",      value: formatNumber(kpis.forecast_best),   sub: "Optimistic scenario",        icon: TrendingUp,  color: "#10B981", bg: "#D1FAE5" },
                { label: "Worst Case Total",     value: formatNumber(kpis.forecast_worst),  sub: "Conservative scenario",      icon: TrendingDown,color: "#EF4444", bg: "#FEE2E2" },
                { label: "Forecast Confidence",  value: `${kpis.confidence_pct.toFixed(1)}%`, sub: "Model accuracy score",   icon: Zap,         color: "#6366F1", bg: "#EDE9FE" },
                { label: "Data Points",          value: String(kpis.data_points),           sub: "Historical records used",    icon: BarChart2,   color: "#64748B", bg: "#F1F5F9" },
              ].map(kpi => (
                <div key={kpi.label} style={{ background: "#fff", borderRadius: 10, border: "1px solid #E8EAF0", padding: "13px 14px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                    <p style={{ fontSize: "0.67rem", color: "#64748B", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: 1.3 }}>{kpi.label}</p>
                    <div style={{ width: 28, height: 28, borderRadius: 7, background: kpi.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <kpi.icon size={13} color={kpi.color} />
                    </div>
                  </div>
                  <p style={{ fontSize: "1.2rem", fontWeight: 800, color: kpi.color, lineHeight: 1 }}>{kpi.value}</p>
                  <p style={{ fontSize: "0.68rem", color: "#94A3B8", marginTop: 4 }}>{kpi.sub}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
