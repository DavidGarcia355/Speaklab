"use client";

import { useEffect } from "react";
import Script from "next/script";
import { usePathname } from "next/navigation";
import {
  analyticsDestination,
  ensureGoogleTag,
  normalizeAnalyticsPath,
  trackAnalyticsEvent,
} from "@/lib/analytics";

const GA_ID = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID?.trim() || "";
const GTM_ID = process.env.NEXT_PUBLIC_GOOGLE_TAG_MANAGER_ID?.trim() || "";

function setGaDisabled(disabled: boolean) {
  if (!GA_ID) return;
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_ID}`] = disabled;
}

export default function GoogleAnalytics() {
  const pathname = usePathname();
  const pagePath = normalizeAnalyticsPath(pathname);

  useEffect(() => {
    if (!GA_ID) return;

    setGaDisabled(!pagePath);
    if (!pagePath) return;

    const gtag = ensureGoogleTag();
    gtag("config", GA_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    gtag("event", "page_view", {
      page_path: pagePath,
      page_location: `${window.location.origin}${pagePath}`,
      page_title: document.title,
    });
  }, [pagePath]);

  useEffect(() => {
    if (!GTM_ID || !pagePath) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "tryhabla_page_view",
      page_path: pagePath,
      page_title: document.title,
    });
  }, [pagePath]);

  useEffect(() => {
    if (!pagePath) return;

    function captureNavigation(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      trackAnalyticsEvent("navigation_click", {
        destination: analyticsDestination(anchor.href, window.location.origin),
      });
    }

    document.addEventListener("click", captureNavigation, true);
    return () => {
      document.removeEventListener("click", captureNavigation, true);
    };
  }, [pagePath]);

  if (!pagePath || (!GA_ID && !GTM_ID)) return null;

  return (
    <>
      {GA_ID ? (
        <>
          <Script
            id="tryhabla-ga4-loader"
            src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_ID)}`}
            strategy="afterInteractive"
          />
          <Script id="tryhabla-ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config','${GA_ID}',{send_page_view:false,allow_google_signals:false,allow_ad_personalization_signals:false});`}
          </Script>
        </>
      ) : null}

      {GTM_ID ? (
        <Script id="tryhabla-gtm-init" strategy="afterInteractive">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}
        </Script>
      ) : null}
    </>
  );
}
