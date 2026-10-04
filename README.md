# MCP_Loggro

🇨🇴 Servidor [MCP](https://modelcontextprotocol.io) de código abierto para **consultar** datos de
[Loggro](https://loggro.com) desde asistentes de IA, de forma segura y solo lectura.
🇺🇸 Open-source, read-only MCP server that lets AI assistants query business data from Loggro
(Colombian business software) through the Model Context Protocol.

> [!IMPORTANT]
> **Estado: versión 0.1.0, verificada contra la API real de Restobar** (negocio en producción,
> septiembre de 2026). Todas las herramientas respondieron correctamente; el detalle de cada campo está
> en [`docs/restobar-data-map.md`](docs/restobar-data-map.md).
>
> Proyecto **independiente**, creado por un cliente de Loggro. No es un producto oficial de Loggro S.A.S.
> ni está afiliado a ella. La documentación oficial de Loggro está en <https://developer.loggro.com>.

## ¿Qué es?

- **Loggro** es una familia de productos de software empresarial colombiano: Restobar (restaurantes y
  bares), PYMES, Enterprise, Nómina, Documentos Electrónicos DIAN y Alojamientos, entre otros.
  Cada producto tiene **su propia API y su propia autenticación**.
- **MCP_Loggro** expondrá esas APIs como herramientas MCP para que Claude y otros clientes compatibles
  respondan preguntas como «¿qué facturas quedaron pendientes ayer?», «¿cuánto stock queda de este
  producto?» o «exporta mis clientes a Excel», **sin poder modificar nada en Loggro**.
- Está pensado para cualquier negocio que use Restobar, para sus equipos y para desarrolladores que
  construyan agentes sobre Loggro.

## Alcance

| Incluido (fase 1) | Excluido |
| --- | --- |
| Consultas de solo lectura sobre **Restobar** | Crear, modificar, eliminar o anular registros |
| Ejecución local por stdio (Claude Desktop, Claude Code, …) | Operaciones financieras o irreversibles |
| Credenciales del propio usuario, solo en variables de entorno | Guardar o administrar credenciales de terceros |
| Librería para montar un servidor MCP **remoto** propio (ver [`docs/remote-integration.md`](docs/remote-integration.md)) | |

Solo se publica lo que se ha probado contra la API real. Hoy eso es Restobar; los demás productos
(PYMES, Nómina, …) están documentados en el [informe de la API](docs/loggro-api/README.md), pero no se
implementarán hasta que alguien con acceso pueda verificarlos.

## Herramientas disponibles

Todas son de **solo lectura en Loggro**. Las fechas se escriben como `YYYY-MM-DD` en la zona horaria
del negocio (por defecto `America/Bogota`).

| Herramienta | Para qué sirve |
| --- | --- |
| `restobar_list_invoices` | Buscar facturas por fechas, estado, tipo, cliente, número o método de pago |
| `restobar_get_invoice` | Ver una factura: productos, cantidades, precios, cajero y estado DIAN |
| `restobar_list_products` | Buscar productos por nombre, código de barras o categoría, con stock y precios |
| `restobar_list_categories` | Listar categorías de productos |
| `restobar_list_payment_methods` | Listar métodos de pago |
| `restobar_list_orders` | Buscar pedidos por fechas, estado, mesa o producto |
| `restobar_list_clients` | Buscar clientes por nombre, documento o teléfono |
| `restobar_clients_summary` | Cifras de todos los clientes: total, datos de contacto, nuevos por mes, ciudades |
| `restobar_export_clients` | Guardar todos los clientes en un Excel (`.xlsx`) en tu computador |
| `restobar_sales_by_day` | Total facturado y número de facturas por día en un rango de fechas |
| `restobar_sales_by_month`, `_by_product`, `_by_category`, `_by_payment_method`, `_by_seller`, `_by_biller`, `_by_table`, `_by_delivery_provider` | Ventas de un período agrupadas por mes, producto, categoría, método de pago, vendedor, cajero, mesa o canal de domicilio |
| `restobar_orders_by_hour`, `restobar_orders_by_weekday` | Horas y días de más movimiento |
| `restobar_product_profitability` | Ventas, costo promedio y utilidad estimada por producto |
| `restobar_profitability_summary` | Ventas frente a gastos y compras de un período |
| `restobar_list_expenses`, `restobar_expenses_summary`, `restobar_list_expense_types` | Gastos y egresos: detalle, totales por tipo y tipos de gasto |
| `restobar_purchases_report`, `restobar_list_purchase_payments`, `restobar_list_providers` | Compras a proveedores, pagos de compras y proveedores |
| `restobar_list_ingredients`, `restobar_get_product` | Ingredientes con stock y alertas de stock bajo; detalle de un producto |
| `restobar_production_report`, `restobar_transfers_report`, `restobar_shrinkage_report` | Producción, traslados entre bodegas y mermas de inventario |
| `restobar_list_tables`, `restobar_list_taxes`, `restobar_list_units`, `restobar_list_promos` | Mesas, impuestos, unidades de medida y promociones |

Varios reportes requieren plan **premium** en Restobar; si el plan no lo permite, la herramienta lo
explica. Estado de cada endpoint de la API en [`docs/restobar-tool-map.md`](docs/restobar-tool-map.md).

**Listados grandes.** Un chat no puede mostrar miles de registros: sería lento, costoso y se cortaría.
Cuando un listado supera 200 resultados, el servidor se lo advierte al asistente y le indica qué
hacer en su lugar: exportar a Excel, pedir un resumen o filtrar. La exportación descarga los clientes
en lotes de 500 (máximo 50 000) y guarda el archivo **en tu computador, sin pasar los datos por el
chat**; al asistente solo le llegan la ruta del archivo y el número de filas. Nunca sobrescribe un
archivo existente, y tu cliente MCP puede pedirte confirmación antes de crearlo, porque es la única
herramienta que escribe algo (en tu equipo, nunca en Loggro).

Diseño y catálogo planeado en [`docs/tool-design.md`](docs/tool-design.md).

## Requisitos

- **Node.js 22.18 o superior** (probado en 22, 24 y 26). Descárgalo de <https://nodejs.org> (versión LTS).
- Un cliente MCP: **Claude Desktop**, **Claude Code** u otro compatible.
- Acceso a **Restobar**: un token, o el correo y la contraseña de un usuario. Si puedes, usa un usuario
  con permisos mínimos (necesita leer facturas, productos, pedidos, clientes y estadísticas de ventas).

## Instalación

No hace falta clonar ni compilar: `npx` descarga el servidor desde GitHub, lo compila la primera vez y
lo ejecuta. Solo tienes que agregarlo a tu cliente MCP.

### Claude Desktop

1. Abre **Configuración → Desarrollador → Editar configuración**. Se abre `claude_desktop_config.json`
   (macOS: `~/Library/Application Support/Claude/`; Windows: `%APPDATA%\Claude\`).
2. Agrega el servidor dentro de `mcpServers` y guarda:

   ```json
   {
     "mcpServers": {
       "loggro-restobar": {
         "command": "npx",
         "args": ["-y", "github:salazar692/MCP_Loggro_Restobar"],
         "env": {
           "LOGGRO_RESTOBAR_EMAIL": "tu-correo-de-restobar",
           "LOGGRO_RESTOBAR_PASSWORD": "tu-contraseña"
         }
       }
     }
   }
   ```

3. Cierra Claude Desktop por completo y vuelve a abrirlo. La primera vez tarda un poco (descarga y
   compila). Pregunta, por ejemplo: «¿Cuánto vendimos ayer?».

### Claude Code

```bash
claude mcp add loggro-restobar \
  -e LOGGRO_RESTOBAR_EMAIL=tu-correo -e LOGGRO_RESTOBAR_PASSWORD=tu-contraseña \
  -- npx -y github:salazar692/MCP_Loggro_Restobar
```

### Token o usuario y contraseña

| Opción | Variables | Cuándo usarla |
| --- | --- | --- |
| **Usuario y contraseña** | `LOGGRO_RESTOBAR_EMAIL`, `LOGGRO_RESTOBAR_PASSWORD` | El servidor hace `POST /login` al primer uso y **renueva el token solo** si Restobar lo rechaza. |
| **Token** | `LOGGRO_RESTOBAR_TOKEN` | La contraseña no queda en la configuración, pero cuando el token deja de servir hay que reemplazarlo a mano y reiniciar el cliente. Restobar no informa cuánto dura (su JWT no trae `exp`). |

Usa una sola de las dos opciones. Si otras integraciones usan el mismo usuario de Restobar, ten en
cuenta que no está confirmado si un login nuevo invalida los tokens anteriores (pregunta B2 de
[`docs/open-questions.md`](docs/open-questions.md)); en ese caso el modo token es el más prudente.

**Una credencial, una cuenta.** Puedes consultar todo lo que tu usuario de Restobar puede ver. Si
tienes otra cuenta de Restobar con otro usuario y contraseña, agrega otra instalación con otro nombre
(p. ej. `loggro-cuenta-2`) y sus propias credenciales.

### Otras formas de instalar

- **Una versión concreta:** `github:salazar692/MCP_Loggro_Restobar#<rama-o-etiqueta>`.
- **Desde el código fuente:**

  ```bash
  git clone https://github.com/salazar692/MCP_Loggro_Restobar.git
  cd MCP_Loggro_Restobar
  npm ci            # instala y compila (dist/)
  ```

  y en el cliente usa `"command": "node"` con `"args": ["/ruta/absoluta/MCP_Loggro_Restobar/dist/index.js"]`.
- **Como servidor remoto** (credenciales de tus usuarios guardadas en tu servidor): ver
  [`docs/remote-integration.md`](docs/remote-integration.md).

### Variables de entorno

Ver también [`.env.example`](.env.example).

| Variable | Descripción |
| --- | --- |
| `LOGGRO_RESTOBAR_EMAIL` / `LOGGRO_RESTOBAR_PASSWORD` | Usuario de Restobar; el servidor obtiene y renueva el token con `POST /login`. |
| `LOGGRO_RESTOBAR_TOKEN` | Token de Restobar ya obtenido (con o sin `Bearer `). |
| `LOGGRO_RESTOBAR_BASE_URL` | URL base oficial, `https://api.pirpos.com` (valor por defecto). |
| `LOGGRO_REDACT_PERSONAL_DATA` | `true` para ocultar documento, correo, teléfono y dirección de los clientes. |
| `LOGGRO_TIMEZONE` | Zona horaria para interpretar las fechas. Por defecto `America/Bogota`. |
| `LOGGRO_EXPORT_DIR` | Carpeta donde se guardan las exportaciones (ruta absoluta; admite `~`). Por defecto `~/Downloads/MCP-Loggro`. |
| `LOG_LEVEL` | `debug`, `info`, `warn` o `error` (los logs van siempre a stderr). |

Nunca subas credenciales reales a un repositorio. Detalles en [`docs/security.md`](docs/security.md).

### Solución de problemas

| Síntoma | Causa y solución |
| --- | --- |
| El cliente no muestra las herramientas | Revisa que el JSON sea válido y reinicia el cliente por completo. En Claude Desktop, los logs están en **Configuración → Desarrollador**. |
| `npx: command not found` o `spawn npx ENOENT` | Node.js no está instalado o no está en el PATH. Instálalo y reinicia el equipo. |
| «Faltan credenciales de Restobar» | Falta `LOGGRO_RESTOBAR_TOKEN` o el par `LOGGRO_RESTOBAR_EMAIL`/`LOGGRO_RESTOBAR_PASSWORD` en `env`. |
| «Restobar rechazó la credencial» | El token venció o la contraseña cambió. Actualiza la configuración y reinicia el cliente. |
| «no tiene permiso para esta consulta» (403) | El usuario de Restobar no tiene ese permiso (p. ej. estadísticas de ventas `ST_GET_SALES`). Pídeselo al administrador del negocio. |
| «requiere un plan premium» (402) o historial limitado | Limitación del plan de Restobar, no del servidor. |
| Detrás de un proxy corporativo, todo falla con 403 o sin conexión | El `fetch` de Node ignora `HTTPS_PROXY` salvo con `NODE_USE_ENV_PROXY=1`: agrégala a `env`. |

## Seguridad y privacidad

- **Solo lectura por diseño:** allowlist explícita de endpoints verificada contra la documentación
  oficial, sin método genérico de solicitud y con anotaciones MCP `readOnlyHint`.
- **Credenciales:** solo por variables de entorno; el token vive únicamente en memoria; nunca se
  registra en logs ni se devuelve al modelo.
- **Datos:** todo lo que devuelvan las herramientas llega al proveedor del modelo de IA que uses,
  **incluidos los datos personales de tus clientes y proveedores** (documento, correo, teléfono). Tú
  decides si eso es aceptable para tu negocio; puedes ocultarlos con `LOGGRO_REDACT_PERSONAL_DATA=true`.
  La exportación a Excel es la excepción: guarda los datos en tu equipo sin pasarlos por el modelo
  (con `LOGGRO_REDACT_PERSONAL_DATA=true` el archivo tampoco incluye los datos personales).
- **Prompt injection:** el contenido de Loggro (nombres, notas, descripciones) se trata como dato, nunca
  como instrucción.

Para reportar vulnerabilidades, ver [`SECURITY.md`](SECURITY.md).

## Limitaciones conocidas

- La API de Restobar **no documenta** duración del token ni límites de peticiones
  ([`docs/open-questions.md`](docs/open-questions.md)). La zona horaria de los filtros sí se verificó.
- Algunos campos no los envía la API real (fecha de nacimiento de clientes, estado de cocina de los
  pedidos) y salen vacíos; ver [`docs/restobar-data-map.md`](docs/restobar-data-map.md).
- Las cuentas trial o gratuitas de Restobar limitan el historial visible (24 h o 30 días) y los
  reportes requieren plan premium.

## Desarrollo

```bash
npm ci                 # instala dependencias exactas
npm run check          # formato, lint, tipos, pruebas y build (lo mismo que la CI)
npm test               # solo pruebas
npm run docs:sync      # regenera docs/loggro-api/inventory desde la documentación oficial
```

**Prueba contra la API real** (opcional, con tu token): `node --env-file=.env scripts/smoke-restobar.ts`.
Solo usa el modo token (nunca hace login) y bloquea antes de la red cualquier método que no sea GET.
Hace como máximo 5 solicitudes por herramienta, acumuladas entre ejecuciones, e imprime solo tipos y
conteos, nunca datos. Opciones (`SMOKE_RAW_SHAPE`, `SMOKE_INVOICE_ID`, `SMOKE_LEDGER`,
`SMOKE_MAX_REQUESTS`) en [`docs/restobar-data-map.md`](docs/restobar-data-map.md) §10.

| Documento | Contenido |
| --- | --- |
| [`docs/loggro-api/README.md`](docs/loggro-api/README.md) | Investigación de la API oficial: productos, autenticación, paginación, errores y límites |
| [`docs/loggro-api/inventory/`](docs/loggro-api/inventory/README.md) | Inventario de los 629 endpoints documentados, con clasificación de lectura o escritura |
| [`docs/restobar-data-map.md`](docs/restobar-data-map.md) | Cómo llega cada dato de la API real de Restobar y cómo queda mapeado en las herramientas y el Excel |
| [`docs/remote-integration.md`](docs/remote-integration.md) | Cómo montar un servidor MCP remoto con esta librería: OAuth y credencial de cada usuario |
| [`docs/architecture.md`](docs/architecture.md) | Arquitectura, flujo de datos, manejo de errores y estrategia de pruebas |
| [`docs/security.md`](docs/security.md) | Modelo de amenazas, credenciales y privacidad |
| [`docs/tool-design.md`](docs/tool-design.md) | Principios y catálogo propuesto de herramientas |
| [`docs/decisions.md`](docs/decisions.md) | Decisiones técnicas y justificación de dependencias |
| [`docs/open-questions.md`](docs/open-questions.md) | Preguntas abiertas y lo que Loggro no documenta |

## Contribuir

Lee [`CONTRIBUTING.md`](CONTRIBUTING.md). La regla principal: **nada se implementa sin respaldo en
la documentación oficial de Loggro**.

## Licencia

[MIT](LICENSE). «Loggro» es una marca de su respectivo titular.
