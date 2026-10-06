// Every colour is a CSS variable (app/globals.css), redefined under .dark, so
// dark mode is one class flip on <html> instead of a dark: twin per utility.
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./lib/**/*.{js,jsx}"],
  darkMode: "class",
  theme: {
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "rgb(255 255 255 / <alpha-value>)",
      black: "rgb(0 0 0 / <alpha-value>)",
      bg: token("bg"),
      surface: token("surface"),
      sunken: token("sunken"),
      border: token("border"),
      fg: token("fg"),
      muted: token("muted"),
      brand: token("brand"),
      "brand-fg": token("brand-fg"),
      ok: token("ok"),
      warn: token("warn"),
      danger: token("danger"),
      info: token("info"),
    },
    extend: {
      fontFamily: {
        sans: ["system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica Neue", "Arial", "sans-serif"],
      },
    },
  },
  plugins: [],
};
