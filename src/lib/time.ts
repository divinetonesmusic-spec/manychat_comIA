/** Hora e minuto no horário de São Paulo (ex.: "14:05"), para as notas que a pessoa lê. */
export function formatSaoPauloTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}
