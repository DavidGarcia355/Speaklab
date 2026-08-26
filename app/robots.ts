import type { MetadataRoute } from "next";
import { SITE_URL } from "@/app/constants";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        "/",
        "/about",
        "/changelog",
        "/district",
        "/faq",
        "/feedback",
        "/pricing",
        "/privacy",
        "/students",
        "/teachers",
        "/terms",
      ],
      disallow: [
        "/a/",
        "/admin/",
        "/api/",
        "/billing",
        "/student/",
        "/teacher/",
        "/unauthorized",
      ],
    },
    host: SITE_URL,
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
