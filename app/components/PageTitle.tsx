"use client";

import { useEffect } from "react";
import { APP_NAME } from "@/app/constants";

type PageTitleProps = {
  title: string;
};

export default function PageTitle({ title }: PageTitleProps) {
  useEffect(() => {
    document.title = `${title} — ${APP_NAME}`;
  }, [title]);

  return null;
}
