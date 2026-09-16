// Lectura de hojas de cálculo que exportan otros sistemas de facturación, en el aparato.
//
// Un «.xls» puede ser dos cosas muy distintas, y los reportes de Facturero Móvil traen
// las dos:
//   - Excel 97-2003 de verdad (BIFF8 dentro de un contenedor OLE2 / Compound File), y
//   - una tabla HTML con extensión .xls, que Excel abre igual.
// Se distingue por los primeros bytes, no por la extensión.
//
// No hay una librería en npm que lea BIFF8 y esté al día (SheetJS publica sus versiones
// corregidas fuera de npm), así que aquí va un lector mínimo: el contenedor OLE2 y las
// celdas de la PRIMERA hoja (texto, números, fórmulas con resultado). Nada de formatos,
// fechas ni estilos: los importadores solo necesitan los valores.
//
// El contenedor de Facturero Móvil tiene cadenas de sectores que se solapan (xlrd lo llama
// «corrupción»); Excel y LibreOffice lo abren igual. Aquí se sigue la cadena del libro
// hasta tener su tamaño declarado, que es lo que hacen ellos.

const OLE_MAGIC = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]
const ENDOFCHAIN = 0xFFFFFFFE
const FREESECT = 0xFFFFFFFF

/** @returns {string[][]} filas de la primera hoja, cada celda como texto */
export function readSheet (bytes) {
  if (!(bytes instanceof Uint8Array)) throw codeError('bad-file', 'expected a Uint8Array')
  if (OLE_MAGIC.every((b, i) => bytes[i] === b)) return readBiff8(readCompoundStream(bytes, ['Workbook', 'Book']))
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) throw codeError('unsupported-format', 'xlsx files are not supported yet')
  const text = decodeText(bytes)
  if (/<table[\s>]/i.test(text)) return readHtmlTable(text)
  throw codeError('unsupported-format', 'the file is neither an Excel 97-2003 workbook nor an HTML table')
}

// ---------- contenedor OLE2 (MS-CFB) ----------

export function readCompoundStream (bytes, names) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const sectorSize = 1 << dv.getUint16(0x1E, true)
  const miniSectorSize = 1 << dv.getUint16(0x20, true)
  const firstDirSector = dv.getUint32(0x30, true)
  const miniCutoff = dv.getUint32(0x38, true)
  const firstMiniFat = dv.getUint32(0x3C, true)
  const firstDifat = dv.getUint32(0x44, true)
  const numDifat = dv.getUint32(0x48, true)
  const sectorCount = Math.floor((bytes.length - sectorSize) / sectorSize) + 1
  if (sectorSize !== 512 && sectorSize !== 4096) throw codeError('bad-xls', `unexpected sector size ${sectorSize}`)

  const sectorOffset = (n) => (n + 1) * sectorSize

  // Tabla de sectores FAT: 109 en la cabecera y el resto encadenados en sectores DIFAT.
  const fatSectors = []
  for (let i = 0; i < 109; i++) {
    const s = dv.getUint32(0x4C + i * 4, true)
    if (s !== FREESECT) fatSectors.push(s)
  }
  let difat = firstDifat
  for (let n = 0; n < numDifat && difat !== ENDOFCHAIN && difat !== FREESECT; n++) {
    const off = sectorOffset(difat)
    const per = sectorSize / 4 - 1
    for (let i = 0; i < per; i++) {
      const s = dv.getUint32(off + i * 4, true)
      if (s !== FREESECT) fatSectors.push(s)
    }
    difat = dv.getUint32(off + per * 4, true)
  }
  const fat = new Uint32Array(fatSectors.length * (sectorSize / 4))
  fatSectors.forEach((s, i) => {
    const off = sectorOffset(s)
    for (let j = 0; j < sectorSize / 4; j++) {
      if (off + j * 4 + 4 > bytes.length) break
      fat[i * (sectorSize / 4) + j] = dv.getUint32(off + j * 4, true)
    }
  })

  // Sigue una cadena hasta ENDOFCHAIN o hasta tener `size` bytes. El tope de vueltas evita
  // un bucle infinito si la cadena se muerde la cola.
  const chain = (start, size, table, unit, read) => {
    const out = new Uint8Array(size ?? table.length * unit)
    let got = 0
    let s = start
    for (let steps = 0; s !== ENDOFCHAIN && s !== FREESECT && got < out.length; steps++) {
      if (steps > table.length || s >= table.length) throw codeError('bad-xls', 'broken sector chain')
      const chunk = read(s)
      const take = Math.min(chunk.length, out.length - got)
      out.set(chunk.subarray(0, take), got)
      got += take
      s = table[s]
    }
    return size == null ? out.subarray(0, got) : out.subarray(0, got)
  }
  const readSector = (n) => {
    if (n >= sectorCount) throw codeError('bad-xls', `sector ${n} is out of the file`)
    return bytes.subarray(sectorOffset(n), sectorOffset(n) + sectorSize)
  }

  const dir = chain(firstDirSector, null, fat, sectorSize, readSector)
  const entries = []
  for (let off = 0; off + 128 <= dir.length; off += 128) {
    const e = new DataView(dir.buffer, dir.byteOffset + off, 128)
    const nameLen = e.getUint16(64, true)
    const type = e.getUint8(66)
    if (type === 0 || nameLen < 2) continue
    let name = ''
    for (let i = 0; i < nameLen / 2 - 1; i++) name += String.fromCharCode(e.getUint16(i * 2, true))
    entries.push({ name, type, start: e.getUint32(116, true), size: e.getUint32(120, true) })
  }
  const root = entries.find((e) => e.type === 5)
  const entry = entries.find((e) => e.type === 2 && names.includes(e.name))
  if (!entry) throw codeError('bad-xls', `the file has no ${names.join('/')} stream`)

  if (entry.size >= miniCutoff) return chain(entry.start, entry.size, fat, sectorSize, readSector)

  // Flujo pequeño: vive en el «mini stream», que a su vez es la cadena del directorio raíz.
  if (!root) throw codeError('bad-xls', 'the file has no root entry for its mini stream')
  const miniStream = chain(root.start, root.size, fat, sectorSize, readSector)
  const miniFatBytes = chain(firstMiniFat, null, fat, sectorSize, readSector)
  const miniFat = new Uint32Array(Math.floor(miniFatBytes.length / 4))
  const mdv = new DataView(miniFatBytes.buffer, miniFatBytes.byteOffset, miniFatBytes.byteLength)
  for (let i = 0; i < miniFat.length; i++) miniFat[i] = mdv.getUint32(i * 4, true)
  return chain(entry.start, entry.size, miniFat, miniSectorSize,
    (n) => miniStream.subarray(n * miniSectorSize, (n + 1) * miniSectorSize))
}

// ---------- BIFF8 ----------

const R = {
  BOF: 0x0809, EOF: 0x000A, SST: 0x00FC, CONTINUE: 0x003C, LABELSST: 0x00FD, LABEL: 0x0204,
  RSTRING: 0x00D6, NUMBER: 0x0203, RK: 0x027E, MULRK: 0x00BD, FORMULA: 0x0006, STRING: 0x0207,
  BOOLERR: 0x0205, BOUNDSHEET: 0x0085,
}

export function readBiff8 (wb) {
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength)
  const records = []
  for (let off = 0; off + 4 <= wb.length;) {
    const type = dv.getUint16(off, true)
    const len = dv.getUint16(off + 2, true)
    if (off + 4 + len > wb.length) break
    records.push({ type, off, data: wb.subarray(off + 4, off + 4 + len) })
    off += 4 + len
  }

  let sst = []
  let firstSheetPos = null
  let i = 0
  for (; i < records.length; i++) {
    const r = records[i]
    if (r.type === R.BOUNDSHEET && firstSheetPos === null) {
      const d = view(r.data)
      // Tipo 0 = hoja de cálculo (las de gráficos o macros no traen celdas).
      if (r.data[5] === 0) firstSheetPos = d.getUint32(0, true)
    } else if (r.type === R.SST) {
      const parts = [r.data]
      while (records[i + 1]?.type === R.CONTINUE) parts.push(records[++i].data)
      sst = readSst(parts)
    } else if (r.type === R.EOF) {
      break
    }
  }
  if (firstSheetPos === null) throw codeError('bad-xls', 'the workbook has no worksheet')

  const rows = []
  const put = (row, col, value) => {
    while (rows.length <= row) rows.push([])
    const line = rows[row]
    while (line.length <= col) line.push('')
    line[col] = value
  }
  const start = records.findIndex((r) => r.off === firstSheetPos)
  if (start < 0 || records[start].type !== R.BOF) throw codeError('bad-xls', 'the worksheet does not start where the workbook says')
  let pendingFormula = null
  for (let j = start + 1; j < records.length; j++) {
    const r = records[j]
    if (r.type === R.EOF) break
    const d = view(r.data)
    switch (r.type) {
      case R.LABELSST: {
        const idx = d.getUint32(6, true)
        if (idx >= sst.length) throw codeError('bad-xls', `shared string ${idx} does not exist`)
        put(d.getUint16(0, true), d.getUint16(2, true), sst[idx])
        break
      }
      case R.LABEL:
      case R.RSTRING:
        put(d.getUint16(0, true), d.getUint16(2, true), readXlUnicodeString(r.data, 6).text)
        break
      case R.NUMBER:
        put(d.getUint16(0, true), d.getUint16(2, true), numberText(d.getFloat64(6, true)))
        break
      case R.RK:
        put(d.getUint16(0, true), d.getUint16(2, true), numberText(rkValue(d.getUint32(6, true))))
        break
      case R.MULRK: {
        const row = d.getUint16(0, true)
        const first = d.getUint16(2, true)
        const count = (r.data.length - 6) / 6
        for (let k = 0; k < count; k++) put(row, first + k, numberText(rkValue(d.getUint32(4 + k * 6 + 2, true))))
        break
      }
      case R.FORMULA: {
        const row = d.getUint16(0, true)
        const col = d.getUint16(2, true)
        // El resultado en caché: si los dos últimos bytes son 0xFFFF no es un número.
        if (d.getUint16(12, true) === 0xFFFF) {
          if (r.data[6] === 0) pendingFormula = { row, col } // su texto viene en STRING
          else if (r.data[6] === 1) put(row, col, r.data[8] ? 'TRUE' : 'FALSE')
        } else {
          put(row, col, numberText(d.getFloat64(6, true)))
        }
        break
      }
      case R.STRING:
        if (pendingFormula) {
          put(pendingFormula.row, pendingFormula.col, readXlUnicodeString(r.data, 0).text)
          pendingFormula = null
        }
        break
      case R.BOOLERR:
        if (r.data[7] === 0) put(d.getUint16(0, true), d.getUint16(2, true), r.data[6] ? 'TRUE' : 'FALSE')
        break
    }
  }
  return rows
}

/** Tabla de cadenas compartidas, que puede partirse en registros CONTINUE a mitad de cadena. */
function readSst (parts) {
  let p = 0
  let pos = 0
  const next = () => { p++; pos = 0 }
  const avail = () => (parts[p] ? parts[p].length - pos : 0)
  const u8 = () => { if (avail() === 0) next(); return parts[p][pos++] }
  const u16 = () => u8() | (u8() << 8)
  const u32 = () => (u16() | (u16() << 16)) >>> 0
  const skip = (n) => { while (n > 0) { if (avail() === 0) next(); const k = Math.min(n, avail()); pos += k; n -= k } }

  const count = (() => { u32(); return u32() })()
  const out = []
  for (let s = 0; s < count && parts[p]; s++) {
    if (avail() === 0) next()
    const cch = u16()
    let flags = u8()
    const runs = flags & 0x08 ? u16() : 0
    const ext = flags & 0x04 ? u32() : 0
    let text = ''
    let left = cch
    while (left > 0) {
      if (avail() === 0) {
        // La cadena sigue en el CONTINUE siguiente, que empieza con sus propios flags.
        next()
        if (!parts[p]) throw codeError('bad-xls', 'a shared string is cut short')
        flags = parts[p][pos++]
      }
      const wide = flags & 0x01
      const n = Math.min(left, wide ? Math.floor(avail() / 2) : avail())
      const chunk = parts[p].subarray(pos, pos + n * (wide ? 2 : 1))
      text += wide ? decodeUtf16le(chunk) : latin1(chunk)
      pos += chunk.length
      left -= n
    }
    skip(runs * 4 + ext)
    out.push(text)
  }
  return out
}

function readXlUnicodeString (data, offset) {
  const d = view(data)
  const cch = d.getUint16(offset, true)
  const wide = data[offset + 2] & 0x01
  const start = offset + 3
  const chunk = data.subarray(start, start + cch * (wide ? 2 : 1))
  return { text: wide ? decodeUtf16le(chunk) : latin1(chunk) }
}

function rkValue (rk) {
  const div100 = rk & 1
  let v
  if (rk & 2) {
    v = rk >> 2 // entero de 30 bits con signo
  } else {
    const buf = new DataView(new ArrayBuffer(8))
    buf.setUint32(4, (rk & 0xFFFFFFFC) >>> 0, true)
    v = buf.getFloat64(0, true)
  }
  return div100 ? v / 100 : v
}

function numberText (n) {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n)) return String(n)
  return String(Math.round(n * 1e6) / 1e6)
}

// ---------- tabla HTML ----------

/** Todas las tablas del HTML, seguidas: los reportes ponen la cabecera en una y los datos en otra. */
export function readHtmlTable (html) {
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)]
  if (tables.length === 0) throw codeError('unsupported-format', 'no table in the HTML')
  const rows = []
  for (const tr of tables.map((t) => t[0]).join('\n').matchAll(/<tr[\s>][\s\S]*?<\/tr>/gi)) {
    const cells = []
    for (const td of tr[0].matchAll(/<t([dh])(\s[^>]*)?>([\s\S]*?)<\/t\1>/gi)) {
      const span = Number((td[2] || '').match(/colspan\s*=\s*["']?(\d+)/i)?.[1] || 1)
      cells.push(htmlText(td[3]))
      for (let k = 1; k < span; k++) cells.push('')
    }
    rows.push(cells)
  }
  return rows
}

// Las entidades con nombre que usan los exportadores en español. `&amp;` va en la misma
// pasada que las demás, así «&amp;lt;» queda como «&lt;» y no como «<».
const NAMED = {
  nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  ordm: 'º', ordf: 'ª', deg: '°', iquest: '¿', iexcl: '¡',
}

function htmlText (s) {
  return s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in NAMED ? NAMED[name] : m))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * UTF-8 si el archivo lo es; si no, Windows-1252, que es lo que usan los exportadores de
 * Excel en español cuando no dicen nada. Una meta charset explícita manda.
 */
function decodeText (bytes) {
  const head = latin1(bytes.subarray(0, 2048))
  const declared = head.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]
  if (declared) return new TextDecoder(declared).decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

const view = (u8) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
const latin1 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return s }
const decodeUtf16le = (u8) => new TextDecoder('utf-16le').decode(u8)

function codeError (code, message) {
  const e = new Error(message)
  e.code = code
  return e
}
