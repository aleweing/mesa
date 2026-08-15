# Mesa

Cuaderno personal de restaurantes: guarda dónde comiste, qué platos te gustaron
(y cuáles no), notas para la próxima visita, fotos, dirección con enlace a
Google/Apple Maps y teléfono de contacto para reservar. Todo opcional salvo el
nombre.

## Arquitectura

- **Frontend**: PWA en vanilla JS, pensada para GitHub Pages (mismo patrón que
  Next Trip / Next Show / Next Match).
- **Backend**: un único Cloudflare Worker (`worker/worker.js`) que expone la API.
- **Datos**: Cloudflare D1 (SQL) para restaurantes/platos, Cloudflare R2 para fotos.
- **Auth**: una clave privada simple (`X-API-Key`) — suficiente para empezar;
  el modelo de datos ya está pensado por-usuario para poder añadir cuentas
  reales el día que quieras abrirlo a más gente.

## 1. Desplegar el backend (Cloudflare)

Necesitas una cuenta gratuita de Cloudflare.

1. Entra en el [dashboard de Cloudflare](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Worker**.
2. Ponle nombre `mesa-api` y despliega el worker por defecto.
3. Ve a **Storage & Databases** → **D1** → **Create database**, llámala `mesa-db`.
4. Dentro de la base de datos, pestaña **Console**, pega el contenido de
   `worker/schema.sql` y ejecútalo (crea las tablas).
5. Ve a **R2** → **Create bucket**, llámalo `mesa-photos`.
6. Vuelve a tu Worker `mesa-api` → **Settings** → **Bindings**:
   - Añade un binding D1: variable `DB` → base de datos `mesa-db`.
   - Añade un binding R2: variable `PHOTOS` → bucket `mesa-photos`.
   - Añade un **secret** (Variables and Secrets → Add): `API_KEY` con una clave
     inventada por ti (guárdala, la necesitarás en la app).
7. Ve a **Settings** → **Editor** (o sube el código): reemplaza el contenido
   del Worker por el de `worker/worker.js` de este proyecto y guarda/despliega.
8. Copia la URL pública de tu Worker (algo como
   `https://mesa-api.tuusuario.workers.dev`) — la necesitas en el paso 3.

*(Alternativa más rápida si usas la CLI `wrangler` desde tu ordenador:
`wrangler d1 execute mesa-db --file=worker/schema.sql`,
`wrangler deploy` usando el `wrangler.toml` incluido, tras rellenar el
`database_id` real de tu base D1.)*

## 2. Publicar el frontend (GitHub Pages)

1. Crea un repositorio nuevo en GitHub, por ejemplo `mesa`.
2. Sube todos los archivos de la carpeta raíz (`index.html`, `style.css`,
   `app.js`, `manifest.json`, `service-worker.js`, `icon-192.png`,
   `icon-512.png`) — **no** subas la carpeta `worker/`, esa vive solo en
   Cloudflare.
3. En el repo, ve a **Settings** → **Pages** → Source: rama `main`, carpeta `/root`.
4. En un minuto tendrás tu app en `https://tuusuario.github.io/mesa/`.

## 3. Primer uso

1. Abre la URL de GitHub Pages en tu iPhone.
2. La app te pedirá la **URL del Worker** (paso 1.8) y la **clave** (`API_KEY`
   del paso 1.6). Se guardan solo en tu móvil (localStorage), no viajan a
   ningún otro sitio salvo tu propio Worker.
3. Toca **Compartir → Añadir a pantalla de inicio** para instalarla como app.

## Cómo funciona

- **Dirección**: se guarda como texto libre y se enlaza directamente a
  `https://www.google.com/maps/search/?api=1?query=...`, que en iOS abre la
  app de Maps si está instalada.
- **Teléfono**: enlace `tel:` para llamar y reservar con un toque.
- **Platos**: cada uno lleva un "sello" — SÍ (te gustó), NO (no te gustó) o
  sin valorar — más una nota libre (ideal para cosas tipo "para mi hija: solo
  arroz con pollo").
- **Fotos**: se suben directamente a Cloudflare R2 desde el móvil. Hay dos
  tipos: **generales** del restaurante (fachada, menú, la cuenta de cada
  visita...) y **por plato** — cada plato tiene su propio botón 📷 para
  adjuntarle fotos, independientes de las generales.

## Añadir fotos por plato a una instalación ya existente

Si ya desplegaste Mesa antes de esta función, ejecuta una vez en la consola
de D1 el contenido de `worker/migration-fotos-plato.sql`, y sube el
`worker.js` actualizado. No hace falta tocar nada más — las fotos que ya
tenías se siguen mostrando como generales.

## Añadir un segundo usuario (cuadernos separados, con opción de compartir)

Cada persona tiene su propio cuaderno privado por defecto. Al crear o editar
un restaurante, puede marcarlo como "Compartir con el otro usuario" para que
también le aparezca a la otra persona (en modo solo lectura).

1. **Migra la base de datos**: en el dashboard, ve a D1 → `mesa-db` → Console,
   y ejecuta el contenido de `worker/migration-2-usuarios.sql`. Antes de
   ejecutarlo, cambia `'alejandro'` por el identificador que quieras usar
   para tus restaurantes ya guardados (todos se asignarán a ese nombre).
2. **Sustituye el secret `API_KEY` por `USERS`**: en Settings → Variables and
   Secrets de tu Worker, borra el secret `API_KEY` y añade uno nuevo llamado
   `USERS` de tipo Secret, con este contenido (en una sola línea, JSON válido):
   ```
   {"clave-privada-de-alejandro":"alejandro","clave-privada-del-otro":"otronombre"}
   ```
   Cada persona usa su propia clave (inventa una distinta para cada una,
   igual que hiciste con la primera) como valor de `X-API-Key` — es decir,
   como la "clave de acceso" que introduce en la app.
3. **Sube el `worker.js` actualizado** (ya incluido en este proyecto) — ahora
   filtra los restaurantes por dueño y solo deja editar/borrar/añadir platos
   y fotos al dueño de cada entrada.
4. **En el móvil de la otra persona**, que instale la PWA con la misma URL
   del Worker pero con su propia clave.

## Siguientes pasos si quieres escalarla más allá de 2 personas

- Sustituir el JSON de `USERS` por login real por email (magic link) si
  necesitas más de un par de usuarios o quieres que se registren solos.
- Explorar cobrar una versión "Pro" (fotos ilimitadas, exportar a PDF, etc.)
  si decides convertirlo en un producto de verdad.
