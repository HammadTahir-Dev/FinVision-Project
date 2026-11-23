/**
 * api.ts — Central API service for FinVision frontend.
 * All backend calls go through this file.
 * Base URL points to FastAPI backend at localhost:8000.
 */

const BASE_URL = "http://localhost:8000";

// ── Token Management ──────────────────────────────────────────────────────────

export function getToken(): string | null {
  return localStorage.getItem("fv_token");
}

export function setToken(token: string) {
  localStorage.setItem("fv_token", token);
}

export function clearToken() {
  localStorage.removeItem("fv_token");
  localStorage.removeItem("fv_session");
}

// ── Base Fetch ────────────────────────────────────────────────────────────────

async function apiFetch(
  path: string,
  options: RequestInit = {}
): Promise<any> {
  const token = getToken();

  const headers: Record<string, string> = {
    ...(options.body && !(options.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers as Record<string, string> || {}),
  };

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    window.location.href = "/";
    return;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof data.detail === "string" ? data.detail : `Request failed: ${response.status}`;
    // 402 = plan limit reached → the dashboard shows an "Upgrade" prompt
    if (response.status === 402) {
      window.dispatchEvent(new CustomEvent(PLAN_LIMIT_EVENT, { detail: message }));
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  return data;
}

export const PLAN_LIMIT_EVENT = "finvision:plan-limit";

async function apiDownload(path: string, filename: string) {
  const token = getToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 401) {
    clearToken();
    window.location.href = "/";
    return;
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.detail || "Download failed");
  }
  const blob = await response.blob();
  const url  = window.URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}


// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: "analyst" | "supervisor";
}

export async function login(
  email: string,
  password: string
): Promise<{ user: AuthUser } | { error: string }> {
  try {
    const formData = new URLSearchParams();
    formData.append("username", email);
    formData.append("password", password);

    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: formData.toString(),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    setToken(data.access_token);
    const user: AuthUser = {
      id:    data.user_id,
      name:  data.name,
      email: data.email,
      role:  data.role,
    };
    localStorage.setItem("fv_session", JSON.stringify(user));
    return { user };
  } catch (e: any) {
    return { error: e.message || "Login failed" };
  }
}

export async function register(
  name: string,
  email: string,
  password: string,
  role: "analyst" | "supervisor"
): Promise<{ user: AuthUser } | { error: string }> {
  try {
    const data = await apiFetch("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password, role }),
    });

    setToken(data.access_token);
    const user: AuthUser = {
      id:    data.user_id,
      name:  data.name,
      email: data.email,
      role:  data.role,
    };
    localStorage.setItem("fv_session", JSON.stringify(user));
    return { user };
  } catch (e: any) {
    return { error: e.message || "Registration failed" };
  }
}

export function getSession(): AuthUser | null {
  try {
    const raw = localStorage.getItem("fv_session");
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function logout() {
  clearToken();
}


// ── File Upload ───────────────────────────────────────────────────────────────

export interface UploadedFile {
  id:            number;
  filename:      string;
  original_name: string;
  file_type:     string;
  file_size:     number;
  status:        "processing" | "verified" | "failed";
  chunk_count:   number;
  is_active:     boolean;
  uploaded_at:   string;
  indexed_at:    string | null;
  error_msg:     string | null;
}

export async function uploadFile(file: File): Promise<UploadedFile> {
  const formData = new FormData();
  formData.append("file", file);

  const token = getToken();
  const response = await fetch(`${BASE_URL}/upload/file`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.detail || "Upload failed");
  return data;
}

export async function listFiles(): Promise<UploadedFile[]> {
  return apiFetch("/upload/files");
}

export async function toggleFileActive(fileId: number): Promise<UploadedFile> {
  return apiFetch(`/upload/files/${fileId}/toggle`, { method: "PATCH" });
}

export async function deleteFile(fileId: number): Promise<void> {
  return apiFetch(`/upload/files/${fileId}`, { method: "DELETE" });
}

export async function getFileStatus(fileId: number): Promise<UploadedFile> {
  return apiFetch(`/upload/files/${fileId}/status`);
}


// ── Chat & RAG ────────────────────────────────────────────────────────────────

export interface Citation {
  source:    string;
  page:      string;
  snippet:   string;
  relevance: number;
}

export interface ChartSpec {
  type:    "line" | "bar" | "area" | "pie";
  title:   string;
  x_label: string;
  y_label: string;
  series:  { key: string; name: string }[];
  data:    ({ label: string } & Record<string, number | string | null>)[];
}

export interface QueryResponse {
  session_id:  number;
  message_id:  number;
  answer:      string;
  citations:   Citation[];
  latency_ms:  number;
  chart?:      ChartSpec | null;
  audience?:   "plain" | "general" | "expert" | null;
}

export interface ChatMessage {
  id:         number;
  role:       "user" | "assistant";
  content:    string;
  citations:  Citation[] | null;
  chart?:     ChartSpec | null;
  latency_ms: number | null;
  created_at: string;
}

export async function sendQuery(
  question: string,
  sessionId?: number,
  activeFileIds?: number[]
): Promise<QueryResponse> {
  return apiFetch("/chat/query", {
    method: "POST",
    body: JSON.stringify({
      question,
      session_id:      sessionId || null,
      active_file_ids: activeFileIds || null,
    }),
  });
}

export interface ChatSessionSummary {
  id:            number;
  title:         string;
  created_at:    string | null;
  updated_at:    string | null;
  last_activity: string | null;
  message_count: number;
  preview:       string | null;
}

export async function listSessions(search?: string): Promise<ChatSessionSummary[]> {
  const q = search && search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
  return apiFetch(`/chat/sessions${q}`);
}

export async function renameSession(sessionId: number, title: string): Promise<ChatSessionSummary> {
  return apiFetch(`/chat/sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify({ title }) });
}

export async function getMessages(sessionId: number): Promise<ChatMessage[]> {
  return apiFetch(`/chat/sessions/${sessionId}/messages`);
}

export async function deleteSession(sessionId: number): Promise<void> {
  return apiFetch(`/chat/sessions/${sessionId}`, { method: "DELETE" });
}

// ── Preprocessing ─────────────────────────────────────────────────────────────

export interface DataProfile {
  rows:            number;
  columns:         number;
  total_nulls:     number;
  nulls_by_column: Record<string, number>;
  duplicate_rows:  number;
  dtypes:          Record<string, "number" | "date" | "text">;
}

export interface TablePreview {
  columns: string[];
  rows:    (string | number | boolean | null)[][];
}

export interface PreprocessStep {
  operation:   string;
  description: string;
  affected:    number;
  command:     string;
}

export interface PreprocessResult {
  success:       boolean;
  error?:        string;
  changed?:      boolean;
  parsed_by?:    "rules" | "ai";
  operation?:    string;
  description?:  string;
  steps?:        PreprocessStep[];
  sheet?:        string | null;
  sheets?:       string[];
  before_shape?: [number, number];
  after_shape?:  [number, number];
  before_nulls?: number;
  after_nulls?:  number;
  profile?:      DataProfile;
  preview?:      TablePreview;
  can_undo?:     boolean;
  file_size?:    number;
}

export interface FileSnapshot {
  sheet:    string | null;
  sheets:   string[];
  profile:  DataProfile;
  preview:  TablePreview;
  can_undo: boolean;
}

export async function preprocessFile(
  fileId: number,
  command: string,
  sheetName?: string | null
): Promise<PreprocessResult> {
  return apiFetch("/chat/preprocess", {
    method: "POST",
    body: JSON.stringify({ file_id: fileId, command, sheet_name: sheetName || null }),
  });
}

function sheetQuery(sheetName?: string | null) {
  return sheetName ? `?sheet_name=${encodeURIComponent(sheetName)}` : "";
}

export async function getPreprocessPreview(fileId: number, sheetName?: string | null): Promise<FileSnapshot> {
  return apiFetch(`/chat/preprocess/${fileId}/preview${sheetQuery(sheetName)}`);
}

export async function undoPreprocess(fileId: number, sheetName?: string | null): Promise<FileSnapshot & { success: boolean }> {
  return apiFetch(`/chat/preprocess/${fileId}/undo${sheetQuery(sheetName)}`, { method: "POST" });
}

export async function downloadPreprocessed(fileId: number, originalName: string) {
  const dot  = originalName.lastIndexOf(".");
  const name = dot > 0 ? `${originalName.slice(0, dot)}_cleaned${originalName.slice(dot)}` : `${originalName}_cleaned`;
  return apiDownload(`/chat/preprocess/${fileId}/download`, name);
}


// ── Forecasting ───────────────────────────────────────────────────────────────

export interface ForecastKPIs {
  metric:           string;
  current_value:    number;
  next_period:      number;
  yoy_growth_pct:   number;
  forecast_total:   number;
  forecast_best:    number;
  forecast_worst:   number;
  confidence_pct:   number;
  data_points:      number;
}

export interface ForecastChartPoint {
  date:        string;
  actual:      number | null;
  expected:    number | null;
  best:        number | null;
  worst:       number | null;
  is_forecast: boolean;
}

export interface ForecastResponse {
  id:          number;
  metric:      string;
  horizon:     string;
  chart_data:  ForecastChartPoint[];
  kpis:        ForecastKPIs;
  sheet_name:  string;
  data_points: number;
  created_at:  string;
}

export async function getFileMeta(
  fileId: number,
  sheetName?: string
): Promise<{ file_id: number; filename: string; sheets: string[]; metrics: string[] }> {
  const params = sheetName ? `?sheet_name=${encodeURIComponent(sheetName)}` : "";
  return apiFetch(`/forecast/file/${fileId}/meta${params}`);
}

export async function generateForecast(
  fileId: number,
  metric: string,
  horizon: "6M" | "12M" | "24M",
  sheetName?: string
): Promise<ForecastResponse> {
  return apiFetch("/forecast/generate", {
    method: "POST",
    body: JSON.stringify({
      file_id:    fileId,
      metric,
      horizon,
      sheet_name: sheetName || null,
    }),
  });
}

export async function listForecasts(): Promise<any[]> {
  return apiFetch("/forecast/results");
}


// ── Reports ───────────────────────────────────────────────────────────────────

export interface ReportRecord {
  id:           number;
  title:        string;
  report_type:  string;
  page_count:   number;
  file_size_kb: number;
  has_pdf:      boolean;
  has_excel:    boolean;
  created_at:   string;
}

export async function generateReport(payload: {
  report_type:  string;
  company_name: string;
  period:       string;
  file_ids?:    number[];
  forecast_id?: number;
}): Promise<ReportRecord> {
  return apiFetch("/reports/generate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listReports(): Promise<ReportRecord[]> {
  return apiFetch("/reports");
}

export async function downloadPDF(reportId: number, title: string) {
  return apiDownload(`/reports/${reportId}/download/pdf`, `${title}.pdf`);
}

export async function downloadExcel(reportId: number, title: string) {
  return apiDownload(`/reports/${reportId}/download/excel`, `${title}.xlsx`);
}

export async function deleteReport(reportId: number): Promise<void> {
  return apiFetch(`/reports/${reportId}`, { method: "DELETE" });
}


// ── Supervisor ────────────────────────────────────────────────────────────────

export async function getSystemSettings(): Promise<any> {
  return apiFetch("/supervisor/settings");
}

export async function updateSystemSettings(payload: {
  llm_model?:    string;
  temperature?:  number;
  max_tokens?:   number;
  chunk_size?:   number;
  k_value?:      number;
  top_p?:        number;
  freq_penalty?: number;
}): Promise<any> {
  return apiFetch("/supervisor/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function getAvailableModels(): Promise<any[]> {
  const data = await apiFetch("/supervisor/settings/models");
  return data.models;
}

export async function getSystemMonitor(): Promise<any> {
  return apiFetch("/supervisor/monitor");
}

export async function getSystemLogs(limit = 50, level?: string): Promise<any[]> {
  const params = new URLSearchParams({ limit: limit.toString() });
  if (level) params.append("level", level);
  return apiFetch(`/supervisor/logs?${params}`);
}

export async function getMetrics(days = 7): Promise<any> {
  return apiFetch(`/supervisor/metrics?days=${days}`);
}

export async function triggerBackup(backupType = "full"): Promise<any> {
  return apiFetch(`/supervisor/backup?backup_type=${backupType}`, { method: "POST" });
}

export async function getBackupHistory(): Promise<any[]> {
  return apiFetch("/supervisor/backup/history");
}

export async function sandboxQuery(payload: {
  question:     string;
  temperature?: number;
  max_tokens?:  number;
  k_value?:     number;
  llm_model?:   string;
}): Promise<any> {
  return apiFetch("/supervisor/sandbox", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listUsers(): Promise<any[]> {
  return apiFetch("/supervisor/users");
}

export async function toggleUser(userId: number): Promise<any> {
  return apiFetch(`/supervisor/users/${userId}/toggle`, { method: "PATCH" });
}

export async function getHealthCheck(): Promise<any> {
  return apiFetch("/health");
}


// ── Billing / Subscriptions ───────────────────────────────────────────────────

export type LimitKey = "uploads" | "chat_queries" | "forecasts" | "reports" | "max_file_mb";

export interface Plan {
  id:            number;
  code:          string;
  name:          string;
  tagline:       string | null;
  price_monthly: number;
  price_yearly:  number;
  currency:      string;
  limits:        Partial<Record<LimitKey, number>>;   // -1 = unlimited
  features:      string[];
  is_default:    boolean;
  is_active:     boolean;
  highlighted:   boolean;
  sort_order:    number;
  subscribers?:  number;
}

export interface BillingSummary {
  plan: Plan;
  subscription: {
    billing_cycle:        "monthly" | "yearly";
    status:               string;
    current_period_start: string | null;
    current_period_end:   string | null;
    cancel_at_period_end: boolean;
  };
  usage:            Record<"uploads" | "chat_queries" | "forecasts" | "reports", { used: number; limit: number }>;
  max_file_mb:      number | null;
  resets_at:        string;
  unlimited_role:   boolean;
  payment_provider: string;
}

export interface Payment {
  id:            number;
  reference:     string;
  plan_code:     string;
  plan_name:     string;
  billing_cycle: string;
  amount:        number;
  currency:      string;
  status:        string;
  provider:      string;
  period_start:  string | null;
  period_end:    string | null;
  created_at:    string | null;
}

export const BILLING_CHANGED_EVENT = "finvision:billing-changed";

export async function getPlans(): Promise<Plan[]> {
  return apiFetch("/billing/plans");
}

export async function getBilling(): Promise<BillingSummary> {
  return apiFetch("/billing/me");
}

export async function checkoutPlan(planCode: string, cycle: "monthly" | "yearly"): Promise<{ summary: BillingSummary; payment: Payment | null }> {
  const r = await apiFetch("/billing/checkout", { method: "POST", body: JSON.stringify({ plan_code: planCode, billing_cycle: cycle }) });
  window.dispatchEvent(new Event(BILLING_CHANGED_EVENT));
  return r;
}

export async function cancelPlan(): Promise<BillingSummary> {
  const r = await apiFetch("/billing/cancel", { method: "POST" });
  window.dispatchEvent(new Event(BILLING_CHANGED_EVENT));
  return r;
}

export async function resumePlan(): Promise<BillingSummary> {
  const r = await apiFetch("/billing/resume", { method: "POST" });
  window.dispatchEvent(new Event(BILLING_CHANGED_EVENT));
  return r;
}

export async function getPayments(): Promise<Payment[]> {
  return apiFetch("/billing/payments");
}

// Supervisor
export async function adminGetPlans(): Promise<Plan[]> {
  return apiFetch("/billing/admin/plans");
}

export async function adminUpdatePlan(id: number, patch: Partial<Plan>): Promise<Plan> {
  return apiFetch(`/billing/admin/plans/${id}`, { method: "PUT", body: JSON.stringify(patch) });
}

export async function adminCreatePlan(plan: Partial<Plan> & { code: string; name: string }): Promise<Plan> {
  return apiFetch("/billing/admin/plans", { method: "POST", body: JSON.stringify(plan) });
}

export async function adminBillingStats(): Promise<{
  total_subscriptions: number; paying: number; mrr: Record<string, number>;
  revenue_this_month: Record<string, number>; payment_provider: string;
}> {
  return apiFetch("/billing/admin/stats");
}

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString()}`;
  }
}
