import { Umami } from "../umami";

/** O quiz público: a contagem de visitas do Umami (só com UMAMI_WEBSITE_ID no ambiente). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <Umami />
    </>
  );
}
