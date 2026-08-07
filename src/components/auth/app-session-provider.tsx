"use client";

import { FormEvent, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT,
  clearSavedAccountMode,
  saveAccountMode
} from "@/components/auto-trading/auto-trade-account-mode";

export type SessionUser = {
  createdAt: string;
  id: string;
  role: "admin" | "user";
  theme: "dark" | "light";
  username: string;
};

export type OnlineSessionUser = Pick<SessionUser, "id" | "role" | "username"> & {
  area: string;
  lastSeen: string;
};

type AppSessionContextValue = {
  logout: () => Promise<void>;
  onlineUsers: OnlineSessionUser[];
  refreshPresence: () => Promise<void>;
  setUser: (user: SessionUser) => void;
  user: SessionUser;
};

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

function applyUserTheme(theme: SessionUser["theme"]) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem("trading-bot-theme", theme);
  window.localStorage.removeItem("signal-console-theme");
}

function currentArea(): string {
  if (typeof window === "undefined") return "Home";
  if (window.location.pathname.startsWith("/research")) return "Research";
  if (window.location.pathname.startsWith("/tour")) return "Product Tour";
  const hash = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  if (!hash) return "Home";
  return hash.split("-").map((part) => part ? `${part[0]?.toUpperCase()}${part.slice(1)}` : "").join(" ");
}

async function parseAuthResponse(response: Response): Promise<{ error?: string; user?: SessionUser }> {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown; user?: SessionUser };
  return { error: typeof payload.error === "string" ? payload.error : undefined, user: payload.user };
}

export function useAppSession(): AppSessionContextValue {
  const context = useContext(AppSessionContext);
  if (!context) throw new Error("useAppSession must be used inside AppSessionProvider.");
  return context;
}

export default function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [onlineUsers, setOnlineUsers] = useState<OnlineSessionUser[]>([]);
  const [status, setStatus] = useState<"loading" | "guest" | "ready">("loading");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const acceptUser = useCallback((nextUser: SessionUser) => {
    setUserState(nextUser);
    saveAccountMode(nextUser.role === "admin" ? "Admin" : "User");
    applyUserTheme(nextUser.theme);
    setStatus("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then(parseAuthResponse)
      .then((payload) => {
        if (cancelled) return;
        if (payload.user) acceptUser(payload.user);
        else {
          clearSavedAccountMode();
          setStatus("guest");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("guest");
      });
    return () => { cancelled = true; };
  }, [acceptUser]);

  const refreshPresence = useCallback(async () => {
    if (!user || document.visibilityState !== "visible") return;
    await fetch("/api/auth/presence", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ area: currentArea() })
    }).catch(() => undefined);
    const response = await fetch("/api/auth/presence", { cache: "no-store", credentials: "same-origin" }).catch(() => null);
    if (!response?.ok) return;
    const payload = (await response.json().catch(() => ({}))) as { online?: OnlineSessionUser[] };
    setOnlineUsers(Array.isArray(payload.online) ? payload.online : []);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void refreshPresence();
    const interval = window.setInterval(() => void refreshPresence(), 30_000);
    const handleRefresh = () => void refreshPresence();
    document.addEventListener("visibilitychange", handleRefresh);
    window.addEventListener("hashchange", handleRefresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleRefresh);
      window.removeEventListener("hashchange", handleRefresh);
    };
  }, [refreshPresence, user]);

  async function handleAuthSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (authMode === "register" && password !== confirmPassword) {
      setAuthError("Passwords do not match.");
      return;
    }
    setIsSubmitting(true);
    setAuthError("");
    try {
      const response = await fetch(authMode === "register" ? "/api/auth/register" : "/api/auth/session", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, username })
      });
      const payload = await parseAuthResponse(response);
      if (!response.ok || !payload.user) throw new Error(payload.error ?? "Could not continue.");
      setPassword("");
      setConfirmPassword("");
      acceptUser(payload.user);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not continue.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const logout = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin" }).catch(() => undefined);
    clearSavedAccountMode();
    window.dispatchEvent(new Event(AUTO_TRADE_ACCOUNT_MODE_CHANGE_EVENT));
    setUserState(null);
    setOnlineUsers([]);
    setPassword("");
    setConfirmPassword("");
    setAuthError("");
    setAuthMode("login");
    setStatus("guest");
  }, []);

  const contextValue = useMemo<AppSessionContextValue | null>(() => user ? ({
    logout,
    onlineUsers,
    refreshPresence,
    setUser: acceptUser,
    user
  }) : null, [acceptUser, logout, onlineUsers, refreshPresence, user]);

  if (status === "loading") {
    return (
      <main className="appAuthScreen appAuthLoading" aria-busy="true">
        <div className="appAuthPulse" />
        <span>Opening secure workspace</span>
      </main>
    );
  }

  if (!contextValue) {
    return (
      <main className="appAuthScreen">
        <section className="appAuthCard" aria-labelledby="app-auth-title">
          <div className="appAuthBrand">
            <span className="appAuthMark">K</span>
            <div>
              <p>Korra workspace</p>
              <h1 id="app-auth-title">Welcome back</h1>
            </div>
          </div>
          <div className="appAuthTabs" role="tablist" aria-label="Account access">
            <button aria-selected={authMode === "login"} className={authMode === "login" ? "is-active" : ""} onClick={() => { setAuthMode("login"); setAuthError(""); }} role="tab" type="button">Log in</button>
            <button aria-selected={authMode === "register"} className={authMode === "register" ? "is-active" : ""} onClick={() => { setAuthMode("register"); setAuthError(""); }} role="tab" type="button">Create account</button>
          </div>
          <form className="appAuthForm" onSubmit={handleAuthSubmit}>
            <label>
              <span>Username</span>
              <input autoCapitalize="none" autoComplete="username" autoFocus maxLength={24} onChange={(event) => { setUsername(event.target.value.toLowerCase()); setAuthError(""); }} placeholder="your_username" required value={username} />
            </label>
            <label>
              <span>Password</span>
              <input autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={8} onChange={(event) => { setPassword(event.target.value); setAuthError(""); }} placeholder="8+ characters" required type="password" value={password} />
            </label>
            {authMode === "register" ? (
              <label>
                <span>Confirm password</span>
                <input autoComplete="new-password" minLength={8} onChange={(event) => { setConfirmPassword(event.target.value); setAuthError(""); }} placeholder="Repeat password" required type="password" value={confirmPassword} />
              </label>
            ) : null}
            {authError ? <p className="appAuthError" role="alert">{authError}</p> : null}
            <button className="appAuthSubmit" disabled={isSubmitting} type="submit">
              {isSubmitting ? "Please wait…" : authMode === "login" ? "Enter workspace" : "Create account"}
            </button>
          </form>
          <p className="appAuthFootnote">The first account created is the workspace administrator.</p>
        </section>
      </main>
    );
  }

  return <AppSessionContext.Provider value={contextValue}>{children}</AppSessionContext.Provider>;
}
