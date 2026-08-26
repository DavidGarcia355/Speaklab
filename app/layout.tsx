import type { Metadata } from "next";
import { DM_Sans, Space_Mono } from "next/font/google";
import {
  APP_NAME,
  SITE_DESCRIPTION,
  SITE_TITLE,
  SITE_URL,
} from "@/app/constants";
import SiteFooter from "@/app/components/SiteFooter";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const spaceMono = Space_Mono({
  variable: "--font-geist-mono",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: `%s | ${APP_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: APP_NAME,
  category: "education",
  creator: "TryHabla",
  publisher: "TryHabla",
  keywords: [
    "language teaching",
    "speaking assignments",
    "student audio",
    "classroom feedback",
  ],
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: APP_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d)}catch(e){}",
          }}
        />
      </head>
      <body
        className={`${dmSans.variable} ${spaceMono.variable} antialiased`}
      >
        <div className="site-shell">
          {children}
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
