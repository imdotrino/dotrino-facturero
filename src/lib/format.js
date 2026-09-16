// Formato de importes para la pantalla. Los importes viajan como texto con punto
// decimal ('30.35'); aquí solo se presentan.
export function money (value) {
  return `$ ${value}`
}

/** Fecha y hora del SRI ('2026-09-16T08:10:11-05:00') en hora de Ecuador: 16/09/2026 08:10:11 */
export function sriDateTime (iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error(`not a date from the SRI: ${iso}`)
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Guayaquil', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]))
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}:${p.second}`
}
