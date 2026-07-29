/**
 * types.ts — Shared types, constants and helpers for Analyst Dashboard.
 */

export interface AppSettings {
  displayName: string;
  jobTitle: string;
  timezone: string;
  language: string;
  accentColor: string;
  fontSize: "small" | "medium" | "large";
  density: "compact" | "comfortable" | "spacious";
  defaultModel: string;
  responseStyle: string;
  citationsEnabled: boolean;
  streamingEnabled: boolean;
  voiceLang: string;
  notiPrefs: {
    forecastReady: boolean;
    dataIndexed: boolean;
    ragWarnings: boolean;
    reportExported: boolean;
    systemAlerts: boolean;
    weeklyDigest: boolean;
  };
}

export interface AppNotification {
  id: number;
  type: "success" | "info" | "warn" | "error";
  title: string;
  body: string;
  time: string;
  read: boolean;
}

export const FONT_SIZE_MAP = { small: "13px", medium: "15px", large: "17px" };
export const DENSITY_PAD_MAP = { compact: "10px", comfortable: "20px", spacious: "32px" };
export const SETTINGS_KEY = "fv_analyst_settings";

export const TABS = [
  { id: "upload",     label: "Upload Data",    icon: "Upload",        desc: "Source Management" },
  { id: "preprocess", label: "Preprocess",     icon: "Wand2",         desc: "Data Preparation" },
  { id: "chat",       label: "Analyze & Chat", icon: "MessageSquare", desc: "AI Workspace" },
  { id: "forecast",   label: "Forecast",       icon: "TrendingUp",    desc: "Predictive Analytics" },
  { id: "reports",    label: "My Reports",     icon: "FileText",      desc: "Export Engine" },
];

import type { AuthUser } from "@/app/auth";

export function defaultSettings(user: AuthUser | null): AppSettings {
  return {
    displayName: user?.name ?? "Analyst",
    jobTitle: "Senior Financial Analyst",
    timezone: "UTC+5 (PKT)",
    language: "English (US)",
    accentColor: "#F59E0B",
    fontSize: "medium",
    density: "comfortable",
    defaultModel: "llama-3.1-8b-instant",
    responseStyle: "balanced",
    citationsEnabled: true,
    streamingEnabled: true,
    voiceLang: "en-US",
    notiPrefs: {
      forecastReady: true, dataIndexed: true, ragWarnings: true,
      reportExported: false, systemAlerts: true, weeklyDigest: true,
    },
  };
}

export function loadSettings(user: AuthUser | null): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...defaultSettings(user), ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return defaultSettings(user);
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function initials(name: string) {
  return name.split(" ").map(w => w[0] ?? "").join("").slice(0, 2).toUpperCase();
}

export function mapLogToNotification(log: any, idx: number): AppNotification {
  const typeMap: Record<string, AppNotification["type"]> = {
    success: "success", info: "info", warn: "warn", error: "error",
  };
  return {
    id:    log.id ?? idx,
    type:  typeMap[log.level] ?? "info",
    title: log.event?.split(":")[0]?.trim() ?? "System Event",
    body:  log.event ?? "",
    time:  log.created_at
      ? new Date(log.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
      : "just now",
    read: false,
  };
}
