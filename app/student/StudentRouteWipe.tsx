"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const transitionArt = {
  recordings: "/mascot/hablaman-transition-recordings-v2.webp",
  classes: "/mascot/hablaman-transition-classes-v1.webp",
  assignments: "/mascot/hablaman-transition-assignments-v1.webp",
  record: "/mascot/hablaman-transition-record-v1.webp",
} as const;

const transitionWords = {
  recordings: "VOICE LOG",
  classes: "CLASSES",
  assignments: "ASSIGNMENTS",
  record: "READY TO SPEAK",
} as const;

const transitionKickers = {
  recordings: "My takes. My progress.",
  classes: "Choose my next move.",
  assignments: "Mission briefing incoming.",
  record: "Mic on. Lock in.",
} as const;

type TransitionVariant = keyof typeof transitionArt;

function getTransitionVariant(pathname: string): TransitionVariant {
  if (pathname.startsWith("/a/")) return "record";
  if (pathname.startsWith("/student/class/")) return "assignments";
  if (pathname === "/student" || pathname === "/student/") return "recordings";
  return "classes";
}

export default function StudentRouteWipe() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const variant = getTransitionVariant(pathname);

  useEffect(() => {
    const nextVariant =
      variant === "recordings"
        ? "classes"
        : variant === "classes"
          ? "assignments"
          : variant === "assignments"
            ? "record"
            : null;
    if (nextVariant) {
      const nextImage = new window.Image();
      nextImage.src = transitionArt[nextVariant];
    }

    const fallback = window.setTimeout(() => setVisible(false), 1150);
    return () => window.clearTimeout(fallback);
  }, [variant]);

  if (!visible) return null;

  return (
    <div
      className={`student-route-wipe is-${variant}`}
      aria-hidden="true"
      onAnimationEnd={(event) => {
        if (event.currentTarget === event.target) setVisible(false);
      }}
    >
      <span className="student-route-index" aria-hidden="true">
        {variant === "recordings" ? "01" : variant === "classes" ? "02" : variant === "assignments" ? "03" : "04"}
      </span>
      <span className="student-route-copy">
        <span className="student-route-kicker">{transitionKickers[variant]}</span>
        <span className="student-route-word">{transitionWords[variant]}</span>
      </span>
      <span className="student-route-props">
        <span />
        <span />
        <span />
      </span>
      <span className="student-route-flight-line student-route-flight-line-left" />
      <Image
        className="student-route-hablaman"
        src={transitionArt[variant]}
        alt=""
        width={768}
        height={768}
        sizes="(max-width: 620px) 260px, 480px"
        preload
        unoptimized
      />
      <span className="student-route-flight-line student-route-flight-line-right" />
    </div>
  );
}
