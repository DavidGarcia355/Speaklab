"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { motionLink, studentDestination } from "./motion/contracts";
import type { createDirector } from "./motion/director";
import "./motion/student-motion.css";

export default function StudentMotion() {
  const pathname = usePathname();
  const director = useRef<Awaited<ReturnType<typeof createDirector>> | null>(
    null,
  );
  const path = useRef(pathname);
  const eligible = Boolean(studentDestination(pathname));
  useEffect(() => {
    const changed = path.current !== pathname;
    path.current = pathname;
    director.current?.commit(pathname);
    if (!changed || !eligible) return;

    // Native navigation still needs an arrival focus when motion is reduced,
    // artwork is unavailable, or a history/resize event cancelled the flight.
    const focus = () => {
      if (document.documentElement.dataset.studentFlight) return false;
      const scene = document.querySelector<HTMLElement>(
        ".site-shell [data-student-scene]",
      );
      if (
        scene?.dataset.studentScene !== studentDestination(pathname) ||
        scene.dataset.studentReady === "false"
      )
        return false;
      const heading = scene.querySelector("h1");
      if (!heading) return false;
      if (document.activeElement === document.body) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
      return true;
    };
    if (focus()) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-student-ready", "data-student-flight"],
    });
    const timeout = window.setTimeout(() => observer.disconnect(), 5500);
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
    };
  }, [pathname, eligible]);

  useEffect(() => {
    if (!eligible) return;
    let alive = true;
    let connecting = false;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const connect = async () => {
      if (media.matches || director.current || connecting) return;
      connecting = true;
      try {
        const { createDirector } = await import("./motion/director");
        if (!alive) return;
        const instance = await createDirector();
        if (!alive || media.matches) {
          instance.dispose();
          return;
        }
        director.current = instance;
      } catch {
        /* Art/network failures leave native Next navigation intact. */
      } finally {
        connecting = false;
      }
    };
    void connect();
    const click = (event: MouseEvent) => {
      if (
        media.matches ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        event.defaultPrevented
      )
        return;
      const element = event.target instanceof Element ? event.target : null;
      const link = element?.closest<HTMLAnchorElement>(
        ".student-motion-scope a[href]",
      );
      if (
        !link ||
        link.hasAttribute("download") ||
        (link.target && link.target !== "_self")
      )
        return;
      const target = motionLink(link.href, path.current, location.origin);
      if (target) director.current?.start(target);
    };
    const cancel = () => director.current?.cancel();
    const hide = () => {
      if (document.hidden) cancel();
    };
    const motion = () => {
      if (media.matches) cancel();
      else void connect();
    };
    document.addEventListener("click", click, true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("resize", cancel);
    window.addEventListener("popstate", cancel);
    media.addEventListener("change", motion);
    return () => {
      alive = false;
      director.current?.dispose();
      director.current = null;
      document.removeEventListener("click", click, true);
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("resize", cancel);
      window.removeEventListener("popstate", cancel);
      media.removeEventListener("change", motion);
    };
  }, [eligible]);
  return null;
}
