/** @type {import('next').NextConfig} */
module.exports = {
  // Static export: Apache/DirectAdmin shared hosting, no Node process in
  // production. No app/api, no middleware, and `redirects` here are IGNORED —
  // a retired route is a page that calls router.replace().
  output: "export",
  // Apache serves /route/index.html; every pathname therefore arrives with a
  // trailing slash. Normalise reads with (usePathname() || "/").replace(/\/+$/, "") || "/".
  trailingSlash: true,
  images: { unoptimized: true },
  // A release build can use its own folder (NEXT_DIST_DIR=.next-build) so it
  // never overwrites the .next a running `next dev` is serving from.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
