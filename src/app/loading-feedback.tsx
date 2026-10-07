"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";

const FEEDBACK_DELAY_MS = 180;
const SLOW_FEEDBACK_MS = 2500;
const SAFETY_TIMEOUT_MS = 9000;

export function LoadingFeedback() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  const delayTimer = useRef<number | null>(null);
  const slowTimer = useRef<number | null>(null);
  const safetyTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const clearTimers = () => {
      if (delayTimer.current) window.clearTimeout(delayTimer.current);
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
      if (safetyTimer.current) window.clearTimeout(safetyTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      delayTimer.current = null;
      slowTimer.current = null;
      safetyTimer.current = null;
      hideTimer.current = null;
    };

    const show = () => {
      clearTimers();
      setSlow(false);
      delayTimer.current = window.setTimeout(() => setVisible(true), FEEDBACK_DELAY_MS);
      slowTimer.current = window.setTimeout(() => setSlow(true), SLOW_FEEDBACK_MS);
      safetyTimer.current = window.setTimeout(() => setVisible(false), SAFETY_TIMEOUT_MS);
    };

    const shouldHandleLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return false;
      }

      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return false;
      if (anchor.target && anchor.target !== "_self") return false;
      if (anchor.hasAttribute("download")) return false;

      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return false;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return false;

      return true;
    };

    const onClick = (event: MouseEvent) => {
      if (shouldHandleLink(event)) show();
    };

    const onBeforeUnload = () => show();

    document.addEventListener("click", onClick, true);
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      clearTimers();
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    hideTimer.current = window.setTimeout(() => {
      setVisible(false);
      setSlow(false);
    }, 0);

    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
  }, [pathname]);

  if (!visible) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[100] grid place-items-center bg-background/45 backdrop-blur-[2px]" aria-live="polite" aria-busy="true">
      <div className="absolute inset-x-0 top-0 h-1 overflow-hidden bg-primary/10">
        <div className="h-full w-1/3 animate-[loading-bar_1.1s_ease-in-out_infinite] rounded-full bg-primary" />
      </div>
      <div className="grid min-w-56 place-items-center gap-3 rounded-lg border border-border bg-card px-6 py-5 text-card-foreground shadow-lg">
        <Loader2 className="size-6 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-sm font-semibold">{slow ? "Ainda carregando" : "Carregando"}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {slow ? "Isso pode demorar um pouco." : "Preparando a próxima tela..."}
          </p>
        </div>
      </div>
    </div>
  );
}
