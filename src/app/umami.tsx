import Script from "next/script";
import { umamiConfig } from "@/lib/visitas/umami";

/** O script do Umami Cloud nas páginas públicas (/q, /e, /p), só com UMAMI_WEBSITE_ID no ambiente. Sem ele, nada. */
export function Umami() {
  const config = umamiConfig();
  if (!config) return null;
  return <Script data-website-id={config.websiteId} src={config.src} strategy="afterInteractive" />;
}
