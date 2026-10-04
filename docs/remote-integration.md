# Integración remota: MCP_Loggro dentro de tu propio servidor

MCP_Loggro se usa normalmente en local (stdio): cada persona lo instala en su equipo con su credencial.
Este documento es para quien ya **guarda la credencial de Restobar de sus usuarios en un servidor** y
quiere que esos usuarios conecten Claude **sin configurar nada ni generar tokens nuevos**: el servidor
usa la credencial que ya tiene.

**Principio: una credencial, una cuenta.** Cada conexión de Claude usa una sola credencial de
Restobar (un usuario y su contraseña, o su token). Lo que esa credencial puede ver en Restobar es lo que
se puede consultar. Otra credencial es otra cuenta y otra conexión.

```text
Claude ──(MCP por HTTP + OAuth)──▶ tu endpoint MCP ──▶ MCP_Loggro (librería) ──▶ api.pirpos.com
                                        │                      ▲
                                        └── identifica al usuario y entrega el
                                            token de su cuenta (TokenProvider)
```

MCP_Loggro pone las herramientas, los esquemas y el mapeo de datos; tu servidor pone la autenticación
del usuario, la búsqueda de la credencial y el transporte HTTP.

## 1. Qué importa tu servidor

Punto de entrada: [`src/remote.ts`](../src/remote.ts).

| Export | Uso |
| --- | --- |
| `createServer(ctx)` | Crea el `McpServer` con todas las herramientas. |
| `RestobarClient`, `HttpClient`, `RESTOBAR_ALLOWLIST` | Cliente de solo lectura de la cuenta de Restobar. |
| `TokenProvider` | Contrato que implementas para entregar el token (ver §3). |
| `LoggroError` | Errores con mensaje seguro para el modelo (ver §3). |
| `silentLogger`, `createLogger`, `VERSION` | Utilidades. |

**Node.js:** `npm install github:salazar692/MCP_Loggro_Restobar#<commit>` e
`import { createServer, … } from 'mcp-loggro/remote'`.

**Deno:** importa el código fuente fijado a un commit (inmutable) y declara las dos dependencias en tu
`deno.json`:

```json
{
  "imports": {
    "mcp-loggro/": "https://raw.githubusercontent.com/salazar692/MCP_Loggro_Restobar/<COMMIT>/src/",
    "zod": "npm:zod@^4.6.5",
    "@modelcontextprotocol/sdk/": "npm:/@modelcontextprotocol/sdk@^1.31.0/"
  }
}
```

```ts
import { createServer, RestobarClient, … } from "mcp-loggro/remote.ts";
```

Verificado con Deno 2: `initialize`, `tools/list` y `tools/call` por HTTP. Actualiza `<COMMIT>` a
propósito cuando quieras una versión nueva; nunca apuntes a una rama.

## 2. Endpoint MCP (Streamable HTTP, sin sesión)

Crea un servidor **por petición** (es barato) con el usuario ya autenticado, y responde con el
transporte web estándar del SDK:

```ts
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer, HttpClient, RESTOBAR_ALLOWLIST, RestobarClient, silentLogger } from "mcp-loggro/remote.ts";

async function mcp(req: Request, tokens: TokenProvider): Promise<Response> {
  const server = createServer({
    restobar: new RestobarClient(
      new HttpClient({ baseUrl: "https://api.pirpos.com", allowlist: RESTOBAR_ALLOWLIST }),
      tokens,
    ),
    redactPersonalData: false,
    timeZone: "America/Bogota",
    exportDir: null, // remoto: sin exportación a archivo (quedaría en tu servidor, no en el equipo del usuario)
    logger: silentLogger,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // sin estado: cada POST es independiente
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}
```

Con `exportDir: null` no se registra `restobar_export_clients` y las instrucciones del servidor le
dicen al modelo que use `restobar_clients_summary`.

`WebStandardStreamableHTTPServerTransport` trabaja con `Request`/`Response` estándar, así que sirve en
cualquier entorno que los tenga (Node.js 22+, Deno, Bun) y con cualquier framework o hosting. Con
Express, el SDK ofrece `StreamableHTTPServerTransport`.

### Límites de página

No amplíes los límites de las herramientas (por ejemplo, aceptando `limit` hasta 500): con productos, 500
registros pesan unos 10 MB y la consulta falla por tamaño o por tiempo. Detalle y tabla por endpoint en
[`tool-design.md` §2.1](./tool-design.md#21-límites-de-paginación-obligatorios-no-opcionales).

## 3. `TokenProvider`: de dónde sale el token

```ts
interface TokenProvider {
  getToken(): Promise<string>;           // token vigente (sin "Bearer ")
  invalidate(token: string): boolean;    // Restobar lo rechazó (401): ¿puedes conseguir otro?
}
```

- `getToken()` debe leer la credencial que tu servidor **ya guarda** para la cuenta del usuario
  autenticado (caché en memoria, base de datos o login con la contraseña cifrada, en ese orden). No
  generes tokens nuevos si ya hay uno vigente.
- Si Restobar responde 401, el cliente llama `invalidate(token)`. Devuelve `true` si puedes renovarlo:
  el siguiente `getToken()` debe forzar la renovación. El cliente reintenta **una sola vez**.
- El token nunca sale de tu servidor: no lo devuelvas en respuestas, no lo registres en logs.
- Si tu búsqueda falla (sin credencial guardada, contraseña ilegible…), lanza
  `new LoggroError('auth' | 'config' | 'unavailable', mensajeSeguro)`: el modelo recibe ese mensaje.
  Cualquier otro error llega como «Ocurrió un error inesperado».
- La cuenta sale del usuario autenticado (su token OAuth), **nunca** de los argumentos de una
  herramienta: las herramientas no tienen ningún parámetro para elegir cuenta.

## 4. Autenticación de Claude (OAuth 2.1)

Claude se conecta a servidores MCP remotos como **conector personalizado** y se autentica con OAuth
según la especificación de autorización de MCP:

1. Sin `Authorization: Bearer …` válido, el endpoint responde `401` con
   `WWW-Authenticate: Bearer resource_metadata="<url de metadatos>"`.
2. Esa URL devuelve los metadatos del recurso protegido (RFC 9728):

   ```json
   {
     "resource": "https://tu-servidor/mcp",
     "authorization_servers": ["https://tu-servidor-de-autorizacion"],
     "bearer_methods_supported": ["header"]
   }
   ```

3. El servidor de autorización publica sus metadatos (RFC 8414), admite **registro dinámico de
   clientes** y PKCE, y muestra al usuario una pantalla de consentimiento. Sirve cualquier proveedor
   OAuth 2.1 que cumpla la especificación de autorización de MCP, propio o de terceros.
4. Claude recibe un access token (JWT) y lo envía en cada petición. Tu endpoint lo valida, identifica al
   usuario y arma el `TokenProvider` con la credencial de su cuenta.

En Claude: **Configuración → Conectores → Agregar conector personalizado**, con la URL del endpoint.
La URL de retorno de Claude que debe aceptar el servidor de autorización es
`https://claude.ai/api/mcp/auth_callback`.

## 5. Lista de verificación

- [ ] El endpoint valida el JWT en **cada** petición y deduce el usuario del token, nunca del cuerpo.
- [ ] Cada usuario consulta solo con la credencial de su propia cuenta.
- [ ] El token de Restobar no aparece en respuestas, logs ni errores.
- [ ] `exportDir: null`.
- [ ] La versión de MCP_Loggro está fijada a un commit.
- [ ] Probado: `initialize`, `tools/list` y una consulta real con la credencial del usuario.
- [ ] El usuario sabe que lo que devuelven las herramientas llega al proveedor del modelo, incluidos
      datos personales de clientes (ver [`security.md`](./security.md)).
