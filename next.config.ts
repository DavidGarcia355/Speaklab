import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://accounts.google.com https://apis.google.com https://login.microsoftonline.com https://js.stripe.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://lh3.googleusercontent.com https://authjs.dev https://graph.microsoft.com https://*.stripe.com https://*.stripe.network",
  "connect-src 'self' https://accounts.google.com https://*.googleapis.com https://login.microsoftonline.com https://graph.microsoft.com https://*.upstash.io https://*.vercel-storage.com https://*.stripe.com https://*.stripe.network",
  "media-src 'self' blob: data:",
  "frame-src 'self' https://accounts.google.com https://login.microsoftonline.com https://*.stripe.com",
].join("; ");

const nextConfig: NextConfig = {
  // Next 16.3 currently conflicts with Vercel's build adapter when standalone
  // output is enabled. Docker still needs standalone; Vercel supplies its own
  // traced output and should not receive this setting.
  output: process.env.VERCEL ? undefined : "standalone",
  poweredByHeader: false,
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.tryhabla.com" }],
        destination: "https://tryhabla.com/:path*",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "microphone=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Content-Security-Policy", value: csp },
        ],
      },
    ];
  },
};

export default nextConfig;
