import Image from "next/image";
import type { ReactNode } from "react";

type AudienceHeroProps = {
  actions: ReactNode;
  artHeight?: number;
  artSrc?: string;
  artWidth?: number;
  description: string;
  eyebrow: string;
  index: string;
  sticker: string;
  title: string;
  tone: "teacher" | "district";
};

export default function AudienceHero({
  actions,
  artHeight = 1254,
  artSrc,
  artWidth = 1254,
  description,
  eyebrow,
  index,
  sticker,
  title,
  tone,
}: AudienceHeroProps) {
  return (
    <section className={`audience-hero audience-hero-${tone}`}>
      <div className="audience-hero-copy">
        <p className="pill">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        <div className="actions hero-actions">{actions}</div>
      </div>
      <div className="audience-hero-art" aria-hidden="true">
        <span className="audience-hero-index">{index}</span>
        <span className="audience-hero-sticker">{sticker}</span>
        {artSrc ? (
          <Image
            src={artSrc}
            alt=""
            width={artWidth}
            height={artHeight}
            sizes="(max-width: 620px) 210px, 320px"
            preload
          />
        ) : null}
      </div>
    </section>
  );
}
