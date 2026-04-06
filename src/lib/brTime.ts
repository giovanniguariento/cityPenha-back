/** IANA: horário de Brasília (usado na maior parte do Brasil). */
export const BR_TIMEZONE = 'America/Sao_Paulo';

/** Data civil YYYY-MM-DD no fuso do Brasil para o instante dado. */
export function toBrazilYyyyMmDd(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: BR_TIMEZONE });
}

/** Data de hoje (YYYY-MM-DD) no calendário brasileiro. */
export function brazilTodayYyyyMmDd(): string {
  return toBrazilYyyyMmDd(new Date());
}
