"use client";

import { useEffect, useState, useTransition } from "react";
import { useAutoTradeAdminMode } from "@/components/auto-trading/use-auto-trade-account-mode";

type Theme = "dark" | "light";
type ThemeToggleProps = {
  initialTheme?: Theme;
  persistTheme?: (theme: Theme) => Promise<void>;
};

const STORAGE_KEY = "trading-bot-theme";
const LEGACY_STORAGE_KEY = "signal-console-theme";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

function readTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
  return stored === "light" ? "light" : "dark";
}

export default function ThemeToggle({ initialTheme, persistTheme }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>("dark");
  const [, startSavingTheme] = useTransition();
  const canPersistTheme = useAutoTradeAdminMode();

  useEffect(() => {
    const currentTheme = initialTheme ?? readTheme();
    setTheme(currentTheme);
    applyTheme(currentTheme);
  }, [initialTheme]);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    if (canPersistTheme && persistTheme) {
      startSavingTheme(() => {
        void persistTheme(nextTheme).catch((error) => console.error("Failed to save theme", error));
      });
    }
  }

  return (
    <button type="button" className="themeToggle" onClick={toggleTheme} aria-pressed={theme === "light"} aria-label="Toggle light mode">
      <span className="themeLightLabel">Light</span>
      <span className="themeDarkLabel">Dark</span>
    </button>
  );
}
