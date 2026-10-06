"use client";
import { useEffect, useState } from "react";

// The DOM is the source of truth for the theme, not React state: the class on
// <html> is set before first paint by the inline script in app/layout.js, and
// toggling flips that class, writes localStorage, then notifies listeners.
// Light is the default and prefers-color-scheme is ignored ON PURPOSE: company
// phones usually run a dark OS, and a dark register surprises first-time users.
export const THEME_KEY = "itrack-theme";
const listeners = new Set();

export function toggleTheme() {
  const dark = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", dark);
  try { localStorage.setItem(THEME_KEY, dark ? "dark" : "light"); } catch { /* private mode */ }
  listeners.forEach((fn) => fn(dark));
}

// dark === null until mount, so nothing renders a theme-dependent value during
// hydration. (The toggle's own sun/moon swap is pure CSS and needs none of this.)
export function useTheme() {
  const [dark, setDark] = useState(null);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    listeners.add(setDark);
    return () => listeners.delete(setDark);
  }, []);
  return { dark, toggle: toggleTheme };
}
