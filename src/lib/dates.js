// La fecha de emisión es la de Ecuador continental, esté donde esté el aparato: es la
// que va en la clave de acceso y la que el SRI compara con su calendario.

const TZ = 'America/Guayaquil'

/** @returns {{ issueDate: string, day: string }}  'dd/mm/aaaa' y 'aaaa-mm-dd' */
export function ecuadorToday (now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(now).map((p) => [p.type, p.value]))
  return { issueDate: `${parts.day}/${parts.month}/${parts.year}`, day: `${parts.year}-${parts.month}-${parts.day}` }
}

/** 'aaaa-mm' del mes de Ecuador. */
export function ecuadorMonth (now = new Date()) {
  return ecuadorToday(now).day.slice(0, 7)
}

export function shiftMonth (month, delta) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
