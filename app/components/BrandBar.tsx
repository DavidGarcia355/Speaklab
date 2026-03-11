"use client";

import Link from "next/link";
import { APP_NAME } from "@/app/constants";

type BrandBarProps = {
  label?: string;
};

export default function BrandBar({ label }: BrandBarProps) {
  return (
    <header className="brand-bar">
      <Link href="/" className="brand-link" aria-label={`${APP_NAME} home`}>
        <span className="brand-mark" aria-hidden="true">
          <span className="brand-mark-text">H</span>
        </span>
        <span className="brand-text">{APP_NAME}</span>
      </Link>
      {label ? <span className="brand-context">{label}</span> : null}
    </header>
  );
}
