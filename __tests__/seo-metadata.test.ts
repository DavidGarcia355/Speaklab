import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { SITE_URL } from "@/app/constants";
import { createPublicMetadata } from "@/lib/public-metadata";
import nextConfig from "@/next.config";

describe("public discovery metadata", () => {
  it("builds canonical and social metadata on the production origin", () => {
    const metadata = createPublicMetadata({
      title: "Pricing",
      description: "Pricing details",
      path: "/pricing",
    });

    expect(String(metadata.alternates?.canonical)).toBe(`${SITE_URL}/pricing`);
    expect(metadata.openGraph).toMatchObject({
      url: new URL(`${SITE_URL}/pricing`),
      title: "Pricing | TryHabla",
      description: "Pricing details",
      images: [
        {
          url: new URL(`${SITE_URL}/opengraph-image`),
          width: 1200,
          height: 630,
        },
      ],
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Pricing | TryHabla",
      images: [{ url: new URL(`${SITE_URL}/twitter-image`) }],
    });
  });

  it("publishes only public routes in the sitemap and keeps private areas out of crawling", () => {
    const entries = sitemap();
    const urls = entries.map((entry) => entry.url);
    const policy = JSON.stringify(robots());

    expect(urls).toContain(`${SITE_URL}/`);
    expect(urls).toContain(`${SITE_URL}/privacy`);
    expect(urls).toContain(`${SITE_URL}/terms`);
    expect(urls.some((url) => url.includes("/teacher/") || url.includes("/student/"))).toBe(false);
    expect(policy).toContain('"/api/"');
    expect(policy).toContain(`${SITE_URL}/sitemap.xml`);
  });

  it("exposes a minimal install manifest", () => {
    expect(manifest()).toMatchObject({
      name: "TryHabla",
      start_url: "/",
      display: "standalone",
    });
  });

  it("permanently redirects the www host to the canonical apex once attached", async () => {
    expect(nextConfig.redirects).toBeTypeOf("function");
    const redirects = await nextConfig.redirects!();

    expect(redirects).toContainEqual({
      source: "/:path*",
      has: [{ type: "host", value: "www.tryhabla.com" }],
      destination: "https://tryhabla.com/:path*",
      permanent: true,
    });
  });
});
