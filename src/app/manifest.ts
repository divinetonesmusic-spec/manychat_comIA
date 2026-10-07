import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "UaiFlow",
    short_name: "UaiFlow",
    description: "Automações de Instagram em português para comentários, mensagens e links.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#101522",
    theme_color: "#101522",
    icons: [
      {
        src: "/icons/favicon-96x96.png",
        sizes: "96x96",
        type: "image/png",
      },
      {
        src: "/icons/web-app-manifest-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/web-app-manifest-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
