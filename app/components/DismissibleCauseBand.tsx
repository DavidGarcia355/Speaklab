"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Ribbon, X } from "lucide-react";

const STORAGE_KEY = "habla-home-cause-dismissed";

export default function DismissibleCauseBand() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        setVisible(localStorage.getItem(STORAGE_KEY) !== "dismissed");
      } catch {
        setVisible(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "dismissed");
    } catch {
      // Keep dismissal working for this page view when storage is unavailable.
    }
  }

  if (!visible) return null;

  return (
    <section className="pricing-cause-band home-cause-band" aria-labelledby="home-cause-heading">
      <button
        type="button"
        className="home-cause-dismiss"
        aria-label="Hide this section permanently on this browser"
        onClick={dismiss}
      >
        <X size={20} aria-hidden="true" />
      </button>
      <div className="pricing-cause-icon" aria-hidden="true">
        <Ribbon className="cancer-ribbon-icon" data-awareness-ribbon="peach" size={34} />
      </div>
      <div>
        <p className="pill pill-subtle">Why Habla matters to me</p>
        <h2 id="home-cause-heading">Built for my mom. Supporting her fight.</h2>
        <p>
          My mom is a Spanish teacher fighting recurrent endometrial cancer. She is the reason
          Habla exists. I built it to make her classroom easier, and now I&apos;m building it into
          something that can help me support her as much as possible. The current core pilot is
          free, and proceeds from any optional AI plan later offered will go toward her fight.
        </p>
      </div>
      <div className="actions home-cause-actions">
        <Link className="btn btn-primary" href="/about">
          Read our story
          <ArrowRight size={17} aria-hidden="true" />
        </Link>
        <a
          className="btn btn-ghost"
          href="https://paypal.me/DavidGarcia355"
          target="_blank"
          rel="noreferrer"
        >
          Support my mom
          <ArrowUpRight size={17} aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
