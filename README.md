# Facturero · Dotrino

**Facturación electrónica contra el SRI de Ecuador, desde el navegador.** Cargas tu firma
electrónica (`.p12`/`.pfx`), emites la factura, la app la firma en tu aparato, la envía al
SRI y guarda la autorizada en tu almacén. [`facturero.dotrino.com`](https://facturero.dotrino.com/)

> **Parte del ecosistema [Dotrino](https://dotrino.com).** Dotrino es un ecosistema de
> aplicaciones centradas en la privacidad de los datos: tu información es tuya, y las
> decisiones sobre ella también — qué compartes, con quién, cuándo y por qué. Sin
> anuncios, sin cookies, sin rastreo de datos, sin vender tu identidad a nadie.

**Cómo se usa:** [wiki.dotrino.com/apps/facturacion](https://wiki.dotrino.com/apps/facturacion/).
Este README es para quien desarrolla.

## Cómo funciona

| Paso | Dónde | Detalle |
|---|---|---|
| XML de la factura | `src/sri/xml.js` | esquema **1.1.0**, escrito ya en forma canónica C14N |
| Clave de acceso | `src/sri/accessKey.js` | 49 dígitos, módulo 11 |
| Abrir la firma | `src/sri/p12.js` | node-forge; la llave se importa a WebCrypto **no extraíble** |
| Firmar | `src/sri/xades.js` | XAdES-BES, RSA-SHA1, plantilla de [ec-sri-invoice-signer](https://github.com/bryancalisto/ec-sri-invoice-signer) |
| Enviar y consultar | `src/sri/soap.js` | directo al SRI, **sin servidor intermedio** |
| Guardar | `src/lib/repo.js` | `@dotrino/store`, un hilo por día |
| RIDE | `src/components/RidePrint.vue` | HTML + diálogo de impresión; código de barras en `src/lib/code128.js` |

### Llamar al SRI desde el navegador

El SRI contesta el POST con `Access-Control-Allow-Origin: *`, pero su cortafuegos rechaza
la petición `OPTIONS` previa. Por eso el sobre SOAP va con `Content-Type: text/plain` y
**sin** `SOAPAction` ni ninguna otra cabecera: así el navegador no hace esa petición previa.
**No está documentado por el SRI** (comprobado el 2026-09-16). Si lo cambian, el envío
falla con `sri-unreachable` y se ve en pantalla. No hay relevo de respaldo.

### La firma electrónica

- El `.p12` se guarda **sellado** con la llave de cifrado del perfil
  (`id.encrypt` para uno mismo, con verificación de apertura antes de guardar).
- **La contraseña no se guarda nunca.** Desbloquear deja en memoria una `CryptoKey` no
  extraíble. Recargar vuelve a cerrarla.
- El par llave/certificado se elige por `keyUsage`, nunca por posición: el `.p12` del
  Banco Central trae primero el de cifrado.
- forge no abría un `.p12` AES (el formato por defecto de OpenSSL 3) con contraseñas con
  ñ o tildes. PBES2 usa UTF-8 y el MAC usa BMPString (RFC 7292 B.1). `readP12` lo corrige.

### Almacén

- Un hilo **por día** (`facturero.invoices.aaaa-mm-dd`). El store recorta cada hilo a un
  tope y descarta lo más viejo sin avisar. Las facturas se conservan 7 años.
- El XML firmado y el autorizado van comprimidos con gzip.
- Separado **por perfil**, con `@dotrino/store` ≥ 0.10.0. Hasta 0.9.0 la moneda de support
  abría el store sin identidad y, si ganaba la carrera, todo caía fuera del perfil.
  `services/store.js` igual comprueba `store.profileId` antes de devolver el store.

## Estados de una factura

`signed` (firmada, sin respuesta) → `received` (RECIBIDA, esperando) → `authorized` o
`rejected` (NO AUTORIZADO). Una `returned` (DEVUELTA) o `rejected` se corrige y se
reenvía **con la misma clave, número y fecha** (ficha técnica §5.10). El secuencial se
reserva antes de firmar: un fallo deja un hueco, nunca un número repetido.

## Desarrollo

```bash
npm install
npm run dev        # https://localhost:3140 (certificado autofirmado)
npm test           # unidad: necesita openssl y xmllint
npm run test:e2e   # navegador + SRI de PRUEBAS (necesita red)
```

- **`npm test`**
  - Valida el XML contra el XSD oficial (`test/fixtures/xsd/`).
  - Verifica la firma con **xml-crypto + node:crypto**, que no comparten código con el
    firmador.
  - Genera los certificados de prueba con openssl en cada corrida. **Ningún `.p12` entra
    al repo.**
- **`npm run test:e2e`** recorre emisor → firma → emisión → respuesta real del SRI →
  recarga. La firma de prueba no está acreditada, así que lo esperado es **NO AUTORIZADO
  (39)**.

## Pendiente

- **Probar con una firma acreditada.** El SRI de pruebas comprueba la cadena de confianza
  antes que la firma. Con un certificado autofirmado no se puede saber si acepta el XAdES.
  Hace falta una firma real y un RUC habilitado en pruebas.
- **Anexo 26 (ficha 2.34):** quien usa un sistema de facturación de un tercero debe
  incluir el campo adicional «RUC Proveedor». Falta decidir si aplica y con qué RUC.
- Notas de crédito, retenciones y guías de remisión.
- Enviar el XML y el RIDE al correo del comprador. Hoy se descargan, se imprimen o se
  comparten desde el aparato.
- El store guarda todo en un único valor de IndexedDB. Con años de facturas eso pesa. Los
  bytes deberían ir a `dotrino-content` cuando esté listo para esto. Mientras tanto está
  la descarga del mes en `.zip`.

MIT
