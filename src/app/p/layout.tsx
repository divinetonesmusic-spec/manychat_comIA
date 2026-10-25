import { Umami } from "../umami";

/** As páginas de venda: a contagem de visitas do Umami (só com UMAMI_WEBSITE_ID no ambiente). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Umami />
    </>
  );
}
