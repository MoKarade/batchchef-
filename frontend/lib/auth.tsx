"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "./api";

export interface AuthUser {
  id: number;
  email: string;
  display_name: string | null;
  is_admin: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, display_name?: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function setToken(t: string) {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  localStorage.setItem("auth_token", t);
  document.cookie = `auth_token=${t}; path=/; max-age=2592000; SameSite=Lax${secure}`;
  api.defaults.headers.common["Authorization"] = `Bearer ${t}`;
}

function clearToken() {
  localStorage.removeItem("auth_token");
  document.cookie = "auth_token=; path=/; max-age=0";
  delete api.defaults.headers.common["Authorization"];
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearToken();
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("auth_token");
    if (!stored) { setIsLoading(false); return; }
    api.defaults.headers.common["Authorization"] = `Bearer ${stored}`;
    api.get<AuthUser>("/api/auth/me")
      .then(res => setUser(res.data))
      .catch(() => clearToken())
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ access_token: string; user_id: number; display_name: string | null; is_admin?: boolean }>("/api/auth/login", { email, password });
    setToken(res.data.access_token);
    setUser({ id: res.data.user_id, email, display_name: res.data.display_name, is_admin: res.data.is_admin ?? false });
  }, []);

  const register = useCallback(async (email: string, password: string, display_name?: string) => {
    const res = await api.post<{ access_token: string; user_id: number; display_name: string | null }>("/api/auth/register", { email, password, display_name });
    setToken(res.data.access_token);
    setUser({ id: res.data.user_id, email, display_name: res.data.display_name, is_admin: false });
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
