"use client";
import { createContext, useContext } from "react";

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

// Auth disabled for local / single-user mode.
// Every caller gets a stub admin user; login/register/logout are no-ops.
const STUB_USER: AuthUser = {
  id: 1,
  email: "local@dev",
  display_name: "Local",
  is_admin: true,
};

const AuthContext = createContext<AuthContextType | null>({
  user: STUB_USER,
  isLoading: false,
  login: async () => undefined,
  register: async () => undefined,
  logout: () => undefined,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <AuthContext.Provider
      value={{
        user: STUB_USER,
        isLoading: false,
        login: async () => undefined,
        register: async () => undefined,
        logout: () => undefined,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  return ctx ?? {
    user: STUB_USER,
    isLoading: false,
    login: async () => undefined,
    register: async () => undefined,
    logout: () => undefined,
  };
}
