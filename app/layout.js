import "./globals.css";
import { AuthGate, AuthProvider } from "./components/AuthProvider";
import AppShell from "./components/AppShell";
import { Toaster } from "./components/ui";

// Applied in <head> BEFORE first paint, or the app flashes light before going
// dark. Key must match THEME_KEY in lib/theme.js.
const THEME_SCRIPT = `try{if(localStorage.getItem("itrack-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

// Inline SVG favicon: no .png request for hotlink protection to block (§9).
const FAVICON = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#16488c"/>' +
  '<path d="M9 11.5 16 8l7 3.5v9L16 24l-7-3.5zM9 11.5 16 15l7-3.5M16 15v9" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>');

// Registered after load so it never competes with the first paint. sw.js
// itself explains what it caches (pages network-first, hashed files cache-first).
// Production only: `next dev` serves /_next/static/ under UNHASHED names, so the
// cache-first rule would pin a dev browser to stale code forever. In dev, remove
// any worker and cache left behind instead.
const SW_SCRIPT = process.env.NODE_ENV === "production"
  ? `if("serviceWorker" in navigator)addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})`
  : `if("serviceWorker" in navigator)navigator.serviceWorker.getRegistrations().then(function(rs){if(!rs.length)return;Promise.all(rs.map(function(r){return r.unregister()})).then(function(){return caches.keys()}).then(function(ks){return Promise.all(ks.map(function(k){return caches.delete(k)}))}).then(function(){location.reload()})})`;

export const metadata = {
  title: "ITrack — IT Asset Management",
  description: "Tomypak Flexible Packaging Sdn Bhd — IT hardware register and assignments",
};
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="icon" href={FAVICON} />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#16488c" />
        <script dangerouslySetInnerHTML={{ __html: SW_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>
          <AuthGate>
            <AppShell>{children}</AppShell>
          </AuthGate>
        </AuthProvider>
        <Toaster />
      </body>
    </html>
  );
}
