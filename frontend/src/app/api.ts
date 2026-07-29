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
    throw new Error(data.detail || `Request failed: ${response.status}`);
  }

  return data;
}

async function apiDownload(path: string, filename: string) {
  const token = getToken();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Download failed");
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

export interface QueryResponse {
  session_id:  number;
  message_id:  number;
  answer:      string;
  citations:   Citation[];
  latency_ms:  number;
}

export interface ChatMessage {
  id:         number;
  role:       "user" | "assistant";
  content:    string;
  citations:  Citation[] | null;
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

export async function listSessions(): Promise<any[]> {
  return apiFetch("/chat/sessions");
}

export async function getMessages(sessionId: number): Promise<ChatMessage[]> {
  return apiFetch(`/chat/sessions/${sessionId}/messages`);
}

export async function deleteSession(sessionId: number): Promise<void> {
  return apiFetch(`/chat/sessions/${sessionId}`, { method: "DELETE" });
}

export async function preprocessFile(
  fileId: number,
  command: string
): Promise<any> {
  return apiFetch("/chat/preprocess", {
    method: "POST",
    body: JSON.stringify({ file_id: fileId, command }),
  });
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
  const params = sheetName ? `?sheet_name=${sheetName}` : "";
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
