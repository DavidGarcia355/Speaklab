import type { Metadata } from "next";
import { APP_NAME, SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from "@/app/constants";

type PublicMetadataOptions = Readonly<{
  title: string;
  description?: string;
  path: `/${string}` | "/";
  home?: boolean;
}>;

/** Keeps public-page canonical and share metadata aligned with the production origin. */
export function createPublicMetadata({
  title,
  description = SITE_DESCRIPTION,
  path,
  home = false,
}: PublicMetadataOptions): Metadata {
  const canonical = new URL(path, SITE_URL);
  const socialTitle = home ? SITE_TITLE : `${title} | ${APP_NAME}`;
  const socialImage = {
    url: new URL("/opengraph-image", SITE_URL),
    width: 1200,
    height: 630,
    alt: "TryHabla speaking practice for language classrooms",
  };

  return {
    title: home ? { absolute: SITE_TITLE } : title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: canonical,
      siteName: APP_NAME,
      title: socialTitle,
      description,
      images: [socialImage],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [
        {
          ...socialImage,
          url: new URL("/twitter-image", SITE_URL),
        },
      ],
    },
  };
}
