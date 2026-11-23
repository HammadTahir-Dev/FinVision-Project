/**
 * ChatChart.tsx — draws the chart the AI returns when a user asks for a graph.
 * Line / bar / area / pie, with a Chart ⇄ Table toggle and CSV download.
 */
import { useState, type ReactElement } from "react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { BarChart3, Table2, Download } from "lucide-react";
import type { ChartSpec } from "../../api";

const COLORS = ["#0D1B3E", "#F59E0B", "#10B981", "#6366F1", "#EF4444", "#0EA5E9", "#A855F7", "#64748B"];

function compact(n: number): string {
  if (n === null || n === undefined || !isFinite(n)) return "";
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Number(n.toFixed(2)).toLocaleString();
}
const full = (n: any) => (typeof n === "number" ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(n ?? "—"));

export function ChatChart({ spec }: { spec: ChartSpec }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const { type, data, series } = spec;
  if (!data?.length || !series?.length) return null;

  const downloadCsv = () => {
    const head = [spec.x_label || "Label", ...series.map(s => s.name)];
    const rows = data.map(d => [d.label, ...series.map(s => d[s.key] ?? "")]);
    const csv = [head, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${(spec.title || "chart").replace(/[^\w-]+/g, "_").slice(0, 50)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const manyLabels = data.length > 8;
  const axisProps = {
    x: { dataKey: "label", tick: { fontSize: 10, fill: "#64748B" }, interval: manyLabels ? Math.ceil(data.length / 10) - 1 : 0,
         angle: manyLabels ? -30 : 0, textAnchor: manyLabels ? "end" : "middle", height: manyLabels ? 46 : 24 } as any,
    y: { tick: { fontSize: 10, fill: "#64748B" }, tickFormatter: compact, width: 48 } as any,
  };
  const tooltip = <Tooltip formatter={(v: any, name: any) => [full(v), name]} contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #E2E8F0" }} />;
  const legend = series.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null;

  let chart: ReactElement;
  if (type === "pie") {
    const s = series[0];
    chart = (
      <PieChart>
        <Pie data={data} dataKey={s.key} nameKey="label" outerRadius="75%" innerRadius="40%" paddingAngle={1}
             label={({ percent }: any) => `${(percent * 100).toFixed(0)}%`} labelLine={false} isAnimationActive={false}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        {tooltip}
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    );
  } else if (type === "bar") {
    chart = (
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F5" vertical={false} />
        <XAxis {...axisProps.x} /><YAxis {...axisProps.y} />{tooltip}{legend}
        {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} isAnimationActive={false} />)}
      </BarChart>
    );
  } else if (type === "area") {
    chart = (
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F5" vertical={false} />
        <XAxis {...axisProps.x} /><YAxis {...axisProps.y} />{tooltip}{legend}
        {series.map((s, i) => <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={COLORS[i % COLORS.length]} fill={COLORS[i % COLORS.length]} fillOpacity={0.15} isAnimationActive={false} />)}
      </AreaChart>
    );
  } else {
    chart = (
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#EEF0F5" vertical={false} />
        <XAxis {...axisProps.x} /><YAxis {...axisProps.y} />{tooltip}{legend}
        {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2.2}
                                     dot={data.length <= 24 ? { r: 3 } : false} connectNulls isAnimationActive={false} />)}
      </LineChart>
    );
  }

  const btn = (active: boolean) => ({
    display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
    border: "1px solid " + (active ? "#0D1B3E" : "#E2E8F0"), background: active ? "#0D1B3E" : "#fff",
    color: active ? "#fff" : "#64748B", fontSize: "0.68rem", fontWeight: 600, fontFamily: "Inter, sans-serif",
  });

  return (
    <div className="fv-chat-chart" style={{ marginTop: 12, background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 10px 6px", width: "100%", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        <p style={{ flex: 1, minWidth: 0, fontSize: "0.78rem", fontWeight: 700, color: "#0D1B3E", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{spec.title}</p>
        <button style={btn(view === "chart")} onClick={() => setView("chart")} title="Chart"><BarChart3 size={11} /> Chart</button>
        <button style={btn(view === "table")} onClick={() => setView("table")} title="Data table"><Table2 size={11} /> Table</button>
        <button style={btn(false)} onClick={downloadCsv} title="Download data as CSV"><Download size={11} /> CSV</button>
      </div>
      {view === "chart" ? (
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer width="100%" height="100%">{chart}</ResponsiveContainer>
        </div>
      ) : (
        <div style={{ maxHeight: 240, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.72rem" }}>
            <thead><tr>
              <th style={{ textAlign: "left", padding: "5px 8px", color: "#64748B", borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, background: "#fff" }}>{spec.x_label || "Label"}</th>
              {series.map(s => <th key={s.key} style={{ textAlign: "right", padding: "5px 8px", color: "#64748B", borderBottom: "1px solid #E2E8F0", position: "sticky", top: 0, background: "#fff" }}>{s.name}</th>)}
            </tr></thead>
            <tbody>{data.map((d, i) => (
              <tr key={i} style={{ background: i % 2 ? "#F8FAFC" : "#fff" }}>
                <td style={{ padding: "4px 8px", color: "#0D1B3E" }}>{d.label}</td>
                {series.map(s => <td key={s.key} style={{ padding: "4px 8px", textAlign: "right", color: "#0D1B3E", fontVariantNumeric: "tabular-nums" }}>{full(d[s.key])}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
