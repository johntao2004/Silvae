import { createContext, useContext } from "react";
import type { ChangePasswordInput, SessionUser } from "../domain/types";
import type { PageFailure } from "../pages/HttpErrorPage";

export interface AuthContextValue {
  user: SessionUser | null;
  ready: boolean;
  sessionError: string | null;
  sessionFailure?: PageFailure | null;
  retrySession: () => void;
  login: (username: string, password: string) => Promise<SessionUser>;
  setupOwner: (input: { username: string; displayName: string; password: string }) => Promise<SessionUser>;
  logout: () => Promise<void>;
  updateProfile: (input: { username: string; displayName: string; currentPassword: string }) => Promise<void>;
  changePassword: (input: ChangePasswordInput) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
