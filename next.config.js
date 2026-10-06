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
};
