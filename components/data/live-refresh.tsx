"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

export function LiveRefresh({ initialVersion }: { initialVersion: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const version = useRef(initialVersion);

  useEffect(() => { version.current = initialVersion; }, [initialVersion]);

  useEffect(() => {
    if (!["/overview", "/analysis", "/calendar"].includes(pathname) &&
        pathname !== "/companies" && !pathname.startsWith("/companies/")) return;

    let stopped = false;
    let checking = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let delay = 15_000;

    async function check() {
      if (stopped || checking) return;
      checking = true;
      if (document.visibilityState === "visible") {
        try {
          const response = await fetch("/api/data-version", {
            credentials: "omit",
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8_000)]),
          });
          if (!response.ok) throw new Error("Version check failed");
          const data: { version: string } = await response.json();
          if (!stopped && data.version !== version.current) {
            version.current = data.version;
            router.refresh();
            delay = 15_000;
          } else {
            delay = 30_000;
          }
        } catch {
          delay = Math.min(delay * 2, 60_000);
        }
      }
      checking = false;
      if (!stopped) timer = setTimeout(check, delay);
    }

    function onVisibility() {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void check();
      }
    }
    timer = setTimeout(check, delay);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pathname, router]);

  return null;
}
