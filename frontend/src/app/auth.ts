/**
 * auth.ts — Re-exports from api.ts for backward compatibility.
 * All auth logic now goes through the real backend API.
 */
export type { AuthUser } from "./api";
export { login, register, getSession, logout } from "./api";
