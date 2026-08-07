"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import ThemeToggle from "@/components/ui/theme-toggle";
import { useAppSession, type SessionUser } from "@/components/auth/app-session-provider";

type AccountToolbarProps = {
  activeMarket?: "forex" | "futures";
  compact?: boolean;
  persistActiveMarket?: (market: "forex" | "futures") => Promise<void>;
  persistTheme?: (theme: "dark" | "light") => Promise<void>;
};

async function settingsResponse(response: Response): Promise<{ error?: string; user?: SessionUser }> {
  const payload = (await response.json().catch(() => ({}))) as { error?: unknown; user?: SessionUser };
  return { error: typeof payload.error === "string" ? payload.error : undefined, user: payload.user };
}

export default function AccountToolbar({ activeMarket, compact = false, persistActiveMarket, persistTheme }: AccountToolbarProps) {
  const { logout, onlineUsers, setUser, user } = useAppSession();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(false);
  const [username, setUsername] = useState(user.username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setUsername(user.username), [user.username]);

  useEffect(() => {
    if (!isOpen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setIsOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  async function patchSettings(payload: Record<string, unknown>) {
    const response = await fetch("/api/auth/settings", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await settingsResponse(response);
    if (!response.ok) throw new Error(result.error ?? "Settings update failed.");
    if (result.user) setUser(result.user);
    return result.user;
  }

  async function saveUsername(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      await patchSettings({ username });
      setMessage("Username updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Username update failed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }
    setIsSaving(true);
    try {
      await patchSettings({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Password updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Password update failed.");
    } finally {
      setIsSaving(false);
    }
  }

  async function changeTheme(theme: "dark" | "light") {
    const updated = await patchSettings({ theme }).catch(() => undefined);
    if (user.role === "admin" && persistTheme) await persistTheme(theme).catch(() => undefined);
    if (updated) setMessage("Appearance saved.");
  }

  function switchMarket(nextMarket: "forex" | "futures") {
    if (!activeMarket || activeMarket === nextMarket) return;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("market", nextMarket);
    nextParams.delete("strategies");
    nextParams.delete("strategySizes");
    if (user.role === "admin" && persistActiveMarket) void persistActiveMarket(nextMarket).catch(() => undefined);
    setIsOpen(false);
    window.requestAnimationFrame(() => router.push(`${pathname}?${nextParams.toString()}`, { scroll: false }));
  }

  return (
    <>
      <div className={`accountToolbar${compact ? " is-compact" : ""}`}>
        {!compact ? <span className="accountIdentity"><i className="presenceDot" />Logged in as <strong>{user.username}</strong><small>{user.role}</small></span> : null}
        <button aria-label="Open settings" className="accountGear" onClick={() => { setIsOpen(true); setError(""); setMessage(""); }} title="Settings" type="button">⚙</button>
        {!compact ? <button className="accountLogout" onClick={() => void logout()} type="button">Log out</button> : null}
      </div>
      {isOpen && typeof document !== "undefined" ? createPortal(
        <div className="accountSettingsLayer" role="presentation">
          <button aria-label="Close settings" className="accountSettingsBackdrop" onClick={() => setIsOpen(false)} type="button" />
          <section aria-labelledby="account-settings-title" aria-modal="true" className="accountSettingsPanel" role="dialog">
            <header>
              <div>
                <span>Account</span>
                <h2 id="account-settings-title">Settings</h2>
              </div>
              <button aria-label="Close settings" className="accountSettingsClose" onClick={() => setIsOpen(false)} ref={closeRef} type="button">×</button>
            </header>
            <div className="accountSettingsSummary">
              <span className="accountAvatar">{user.username.slice(0, 2).toUpperCase()}</span>
              <div><strong>{user.username}</strong><small>{user.role === "admin" ? "Workspace administrator" : "Workspace member"} · {Math.max(1, onlineUsers.length)} online</small></div>
            </div>
            {activeMarket ? (
              <div className="accountSettingsBlock marketSetting">
                <div><strong>Trading workspace</strong><small>Choose which market dashboard is active.</small></div>
                <div className="settingsSegmented" role="group" aria-label="Trading workspace">
                  {(["forex", "futures"] as const).map((market) => (
                    <button aria-pressed={activeMarket === market} className={activeMarket === market ? "is-active" : ""} key={market} onClick={() => switchMarket(market)} type="button">{market === "forex" ? "Forex" : "Futures"}</button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="accountSettingsBlock appearanceSetting">
              <div><strong>Appearance</strong><small>Switch between dark and light workspace themes.</small></div>
              <ThemeToggle initialTheme={user.theme} onThemeChange={changeTheme} />
            </div>
            <form className="accountSettingsBlock" onSubmit={saveUsername}>
              <label><span>Username</span><input autoCapitalize="none" autoComplete="username" maxLength={24} onChange={(event) => setUsername(event.target.value.toLowerCase())} required value={username} /></label>
              <button disabled={isSaving || username === user.username} type="submit">Save username</button>
            </form>
            <form className="accountSettingsBlock" onSubmit={savePassword}>
              <label><span>Current password</span><input autoComplete="current-password" minLength={8} onChange={(event) => setCurrentPassword(event.target.value)} required type="password" value={currentPassword} /></label>
              <label><span>New password</span><input autoComplete="new-password" minLength={8} onChange={(event) => setNewPassword(event.target.value)} required type="password" value={newPassword} /></label>
              <label><span>Confirm new password</span><input autoComplete="new-password" minLength={8} onChange={(event) => setConfirmPassword(event.target.value)} required type="password" value={confirmPassword} /></label>
              <button disabled={isSaving} type="submit">Update password</button>
            </form>
            {error ? <p className="accountSettingsMessage is-error" role="alert">{error}</p> : null}
            {message ? <p className="accountSettingsMessage">{message}</p> : null}
            <button className="accountSettingsLogout" onClick={() => void logout()} type="button">Log out of Korra</button>
          </section>
        </div>,
        document.body
      ) : null}
    </>
  );
}
