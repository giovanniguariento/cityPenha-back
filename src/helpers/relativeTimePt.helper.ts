/**
 * Relative time labels for discovery trending (Brazilian Portuguese), e.g. "2 horas atrás".
 */

/**
 * WordPress post `date` → human-readable relative string (PT-BR).
 * Examples: "2 horas atrás", "2 dias atrás", "2 anos atrás".
 */
export function formatPublishedRelativePtBr(dateInput: string | Date): string {
  const then = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (Number.isNaN(then.getTime())) {
    return '';
  }
  const now = Date.now();
  const diffMs = now - then.getTime();
  if (diffMs < 0) {
    return 'agora';
  }

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return 'agora';
  }

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return diffMin === 1 ? '1 minuto atrás' : `${diffMin} minutos atrás`;
  }

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return diffHour === 1 ? '1 hora atrás' : `${diffHour} horas atrás`;
  }

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 30) {
    return diffDay === 1 ? '1 dia atrás' : `${diffDay} dias atrás`;
  }

  if (diffDay < 365) {
    const months = Math.floor(diffDay / 30);
    return months === 1 ? '1 mês atrás' : `${months} meses atrás`;
  }

  const years = Math.floor(diffDay / 365);
  return years === 1 ? '1 ano atrás' : `${years} anos atrás`;
}
