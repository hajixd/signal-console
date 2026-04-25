"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

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

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const currentTheme = readTheme();
    setTheme(currentTheme);
    applyTheme(currentTheme);
  }, []);

  function toggleTheme() {
    const nextTheme: Theme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem(STORAGE_KEY, nextTheme);
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }

  return (
    <button type="button" className="themeToggle" onClick={toggleTheme} aria-pressed={theme === "light"} aria-label="Toggle light mode">
      <span className="themeLightLabel">Light</span>
      <span className="themeDarkLabel">Dark</span>
    </button>
  );
}
