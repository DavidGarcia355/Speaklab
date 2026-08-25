import type { MetadataRoute } from "next";
import { SITE_URL } from "@/app/constants";

const PUBLIC_ROUTES = [
  ["/", 1],
  ["/teachers", 0.9],
  ["/students", 0.8],
  ["/district", 0.8],
  ["/pricing", 0.8],
  ["/about", 0.6],
  ["/faq", 0.6],
  ["/feedback", 0.5],
  ["/changelog", 0.4],
  ["/privacy", 0.4],
  ["/terms", 0.4],
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_ROUTES.map(([path, priority]) => ({
    url: new URL(path, SITE_URL).toString(),
    changeFrequency: path === "/changelog" ? "monthly" : "weekly",
    priority,
  }));
}
