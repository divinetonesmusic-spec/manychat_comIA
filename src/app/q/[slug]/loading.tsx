/**
 * Enquanto a página pública carrega: uma tela calma, sem a tela de «Carregando sua área» do painel (quem abre o quiz ou a
 * entrega não é o dono do UaiFlow). O mesmo arquivo serve a /e/<slug> e a /lista/… (reexportado lá).
 */
export default function CarregandoFunil() {
  return <main aria-busy="true" style={{ minHeight: "100dvh", background: "#FBF8F3" }} />;
}
