"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const LEGACY_THEME_KEY = "theme";

function getUserThemeKey(email: string) {
  return `theme:${email}`;
}

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [themeReady, setThemeReady] = useState(false);
  const [themeStorageKey, setThemeStorageKey] = useState(LEGACY_THEME_KEY);

  useEffect(() => {
    let active = true;

    async function loadThemePreference() {
      const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY);
      const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      setDark(legacyTheme ? legacyTheme === "dark" : systemDark);
      setThemeReady(true);

      try {
        const response = await fetch("/api/auth/session", { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load session.");
        const session = (await response.json()) as { user?: { email?: string | null } } | null;
        const email = session?.user?.email?.trim().toLowerCase();

        if (!active) return;

        if (!email) {
          setThemeStorageKey(LEGACY_THEME_KEY);
          return;
        }

        const nextThemeKey = getUserThemeKey(email);
        const savedTheme = localStorage.getItem(nextThemeKey) ?? localStorage.getItem(LEGACY_THEME_KEY);

        if (savedTheme) {
          localStorage.setItem(nextThemeKey, savedTheme);
        }

        setThemeStorageKey(nextThemeKey);
        setDark(savedTheme === "dark");
      } catch {
        if (!active) return;
        setThemeStorageKey(LEGACY_THEME_KEY);
      }
    }

    void loadThemePreference();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!themeReady) return;
    document.documentElement.classList.toggle("dark", dark);
  }, [dark, themeReady]);

  function toggle() {
    setDark((current) => {
      const next = !current;
      localStorage.setItem(themeStorageKey, next ? "dark" : "light");
      localStorage.setItem(LEGACY_THEME_KEY, next ? "dark" : "light");
      return next;
    });
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {dark ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
    </button>
  );
}
