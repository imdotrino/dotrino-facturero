// Lo que src/sri/p12.js usa de node-forge y @types/node-forge 1.3.14 no declara.
import 'node-forge'

declare module 'node-forge' {
  namespace pki {
    namespace pbe {
      /**
       * El descifrador de PBES2 (AES). Es una propiedad del objeto `forge.pki.pbe`, y p12.js
       * la sustituye un momento para pasarle la contraseña en UTF-8.
       */
      let getCipherForPBES2: (oid: string, params: unknown, password: string) => unknown
    }
  }
}
