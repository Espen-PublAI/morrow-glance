/** Locale-stable time and date formatting shared by Player and Render API. */

export function formatTime(date: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return '--:--';
  }
}

export function formatDate(date: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone || undefined,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(date);
  } catch {
    return '';
  }
}

/** `Europe/Oslo` → `Europe/Oslo`, `America/New_York` → `America/New York`. */
export function humanizeTimeZone(timeZone: string): string {
  return timeZone.replaceAll('_', ' ');
}
