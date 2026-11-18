# SHIFT CALCULATOR

Aplicación web progresiva (PWA) para registrar jornadas, organizar turnos, fichar, controlar horas contratadas y bolsa de horas, estimar el salario y analizar ingresos.

- **100 % gratuita**, sin publicidad, suscripciones ni funciones premium.
- **Sin servidor, sin cuentas, sin APIs de pago, sin analítica ni telemetría.** Todos los datos se guardan en el dispositivo (IndexedDB mediante Dexie).
- **Funciona sin conexión** una vez abierta por primera vez, e instalable en iPhone, Android y Windows.
- Interfaz en español, fechas DD/MM/AAAA, horas en formato 24 h, moneda configurable (EUR por defecto).

## Cobro de un turno en el mes siguiente

Al crear o editar un turno, «¿Cuándo se cobra este turno?» permite elegir **En su mes** (predeterminado) o **En el mes siguiente**. Un turno aplazado:

- sigue registrado y contando horas en el día y el mes en que se trabaja (también para el cálculo mensual de horas complementarias y extraordinarias);
- conserva todos sus conceptos (horas ordinarias, horas de más, nocturnidad, festivos, fin de semana, complementos por hora, por día y % de la base) calculados con las **condiciones del mes en que se trabajó**;
- se paga en la nómina siguiente: en Salario aparece como «Pendiente de cobro» en su mes y como líneas «(turnos de octubre)» en el mes de cobro. Nunca se cuenta dos veces.

**Cerrar mes:** en Salario → Estimación, «Cerrar mes» guarda una copia del cálculo (incluida la parte aplazada). Mientras esté cerrado, cambiar el contrato o los pluses no altera ese mes ni lo que pasa al siguiente. «Reabrir» vuelve a calcularlo con la configuración actual. Además, al editar unas condiciones que se aplican a meses pasados, la app avisa y sugiere «Nuevas condiciones».

## Importar cuadrante (Orquest)

Mis turnos → **Importar cuadrante** (o el acceso rápido de Inicio): elige el trabajo, sube una captura (galería, cámara o arrastrar) y pulsa «Analizar cuadrante». El reconocimiento de texto se hace **en el dispositivo** con Tesseract.js: la imagen no se envía a ningún sitio. Después:

- revisas una vista previa editable (fecha, entrada, salida) con los datos dudosos marcados;
- los turnos que ya existen se detectan y no se duplican; los que cambian respecto a tu calendario se señalan y **solo se sustituyen si lo eliges**; los días que el cuadrante marca como libres y en los que tienes turno se listan, sin borrarse salvo que lo marques; los turnos realizados nunca se modifican;
- nada se guarda hasta pulsar «Importar». Los turnos se crean como previstos, con la etiqueta «cuadrante».

Admite formato lista (un día por fila, también modo oscuro), encabezados de día con turnos debajo y semana en columnas; turnos partidos y turnos que acaban después de medianoche. La primera vez se cargan unos 6 MB del motor de lectura; después funciona sin conexión.

## Asistente

Sección **Asistente**: preguntas en lenguaje natural sobre tu actividad («¿Cuánto voy a cobrar este mes?», «¿Cuántas horas nocturnas he trabajado este año?», «¿Qué turnos tengo la semana que viene?», «¿Cuánto tengo pendiente de cobrar?», «¿Cuántos días de vacaciones me quedan?»…). Interpreta la pregunta con reglas (sin IA externa ni servicios de pago) y responde usando los mismos cálculos que el resto de la app. Cada dato se marca como **registrado**, **estimación** o **previsión**; si faltan datos para responder, lo dice. El historial se guarda en el dispositivo y se puede borrar.

## Neto primero

Cuando configuras tus deducciones (los porcentajes de tu nómina: contingencias comunes, desempleo, MEI, IRPF…) en **Configuración → Salario y reglas → Complementos y deducciones**, el **neto estimado** pasa a ser la cifra principal en Inicio, Salario, Estadísticas (indicadores, gráficas y comparación de meses), nóminas, informes y calculadora rápida. El bruto se sigue mostrando, en segundo plano. Sin deducciones configuradas no se inventa ningún neto: se muestra el bruto y se indica que falta configurarlas.

## Almacenamiento persistente

En **Configuración → Privacidad y datos** (y con un aviso en Inicio mientras no esté activo) hay un botón **Activar** que pide al navegador almacenamiento persistente: así no borrará tus datos automáticamente cuando necesite espacio. El navegador decide si lo concede (Chrome/Edge suelen hacerlo con la app instalada; Firefox lo pregunta; en iPhone, instala la app en la pantalla de inicio). Aun así, haz copias de seguridad.

## Varios trabajos

Si tienes más de un empleo, añádelos en **Configuración → Trabajos**. Cada trabajo tiene sus propios:

- contratos (con fechas de vigencia), horas, salario, pluses, reglas de horas complementarias/extraordinarias, complementos y deducciones;
- turnos, fichajes, nóminas reales, días de vacaciones y bolsa de horas.

Las horas de cada trabajo se comparan solo con su contrato (lo trabajado en uno nunca se cuenta como exceso del otro) y cada uno se paga con su tarifa. En la parte superior de Inicio, Calendario, Turnos, Control horario, Salario, Estadísticas y Vacaciones aparece un selector **Todos / Trabajo A / Trabajo B**: con «Todos» se ven los totales combinados (horas e ingresos sumados, con el desglose de cada trabajo) y con un trabajo concreto solo sus datos. En el calendario, cada turno lleva el color de su trabajo. Un turno a la misma hora en otro trabajo no se trata como duplicado; solo se avisa.

Las ausencias pueden afectar a un trabajo concreto o a todos (por ejemplo, una baja). Un trabajo terminado puede **archivarse** (conserva su historial) o eliminarse con todos sus datos. Al actualizar desde la versión anterior, todos los datos existentes pasan automáticamente al «trabajo principal» (también al importar copias antiguas).

## Requisitos

- Node.js 20 o superior (probado con Node 22) y npm.

## Instalación y ejecución en Windows

1. Instala Node.js LTS desde https://nodejs.org (marca «Add to PATH»).
2. Descomprime el proyecto, abre **PowerShell** o **Símbolo del sistema** en la carpeta `shift-calculator`.
3. Instala las dependencias:
   ```
   npm install
   ```
4. Modo desarrollo (recarga en caliente, sin service worker):
   ```
   npm run dev
   ```
   Abre http://localhost:3000
5. Versión de producción (con PWA y modo sin conexión):
   ```
   npm run build
   npm start
   ```
   Abre http://localhost:3000

Los mismos comandos funcionan en macOS y Linux.

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Export estático en `out/` + generación del service worker |
| `npm start` | Sirve `out/` en local (puerto 3000 o `PORT`) |
| `npm run typecheck` | Comprobación de TypeScript |
| `npm run lint` | ESLint (reglas de Next.js y React) |
| `npm test` | Pruebas unitarias e integración (Vitest + fake-indexeddb) |
| `npm run test:e2e` | Pruebas E2E con Playwright (requiere `npm run build` antes y Chromium: `npx playwright install chromium`) |
| `npm run icons` | Regenera los iconos PNG desde `public/favicon.svg` |

La telemetría del CLI de Next.js se desactiva automáticamente en `dev` y `build` (`scripts/next.mjs`).

## Despliegue en Vercel

El proyecto está listo: es un export estático (`output: "export"`) y `vercel.json` ya indica el comando de build y la carpeta `out`.

1. Sube el proyecto a un repositorio de GitHub/GitLab/Bitbucket.
2. En Vercel → *Add New Project* → importa el repositorio → *Deploy*. No hace falta configurar variables de entorno.

El plan gratuito (Hobby) es suficiente: no hay funciones de servidor, bases de datos ni nada que pueda generar facturas. También puede alojarse en cualquier hosting estático (GitHub Pages con dominio propio en la raíz, Netlify, Cloudflare Pages…) subiendo la carpeta `out/`.

> La PWA requiere HTTPS (Vercel lo da automáticamente). En `localhost` también funciona.

## Instalar como app en iPhone / iPad

1. Abre la URL de la aplicación en **Safari** (desde iOS 16.4 también puedes hacerlo desde Chrome o Edge).
2. Pulsa el botón **Compartir** (cuadrado con flecha hacia arriba).
3. Elige **«Añadir a pantalla de inicio»** y confirma.
4. Abre SHIFT CALCULATOR desde el icono: se ejecuta a pantalla completa y funciona sin conexión.

Android (Chrome): menú ⋮ → «Instalar aplicación». Windows (Edge/Chrome): icono de instalación en la barra de direcciones.

## Arquitectura

```
src/
  app/            Rutas (Next.js App Router, export estático): una página por sección
  views/          Pantallas: Inicio, Calendario, Mis turnos, Control horario, Salario,
                  Estadísticas, Vacaciones y ausencias, Configuración
  components/     UI reutilizable (botones, campos, modales, confirmaciones, avisos,
                  gráficos SVG propios, editor de turnos, fichaje, asistente inicial)
  lib/            Lógica pura y testeable
    time.ts         fechas/horas locales, formatos es-ES, cambios de hora
    money.ts        importes en céntimos enteros y redondeo
    shifts.ts       duración bruta/neta, descansos, medianoche, solapamientos
    jobs.ts         varios trabajos: filtrado por trabajo, totales combinados, meses cerrados, migración v2→v3
    roster.ts       analizador de cuadrantes (geometría del OCR → días y horarios)
    rosterImport.ts comparación con el calendario (nuevos, existentes, cambios, días libres)
    ocr.ts          OCR local con Tesseract.js (varias pasadas: página, filas y etiquetas)
    imagePrep.ts    preprocesado: inversión de etiquetas oscuras, escala según el tamaño de letra
    assistant.ts    asistente: interpretación de preguntas y respuestas con los datos
    engine.ts       horas esperadas, excesos, pluses, salario, bolsa, vacaciones, festivos
    reports.ts      informes (mensual, anual, turnos, fichajes, desglose salarial)
    exporters.ts    CSV, XLSX (generador propio con fflate) y PDF (jsPDF)
    backup.ts       copia de seguridad: exportar, validar, fusionar o reemplazar
    holidays.ts     importación de festivos CSV/JSON
  db/
    schema.ts       esquema Dexie versionado con migraciones (v1 → v2)
    repo.ts         operaciones de datos, fichajes, auditoría, plantillas, recurrencias
scripts/            build sin telemetría, copia de los archivos de OCR, service worker, servidor local, iconos
tests/unit/         pruebas unitarias e integración (Vitest)
e2e/                pruebas E2E (Playwright)
```

### Base de datos (IndexedDB / Dexie)

Tablas: `profile` (datos personales), `jobs` (trabajos), `contracts` (condiciones con fecha de vigencia), `complements` (complementos y deducciones de cada contrato), `shifts` (turnos con horario previsto y real), `clockSessions` (fichajes), `clockBreaks` (descansos de fichaje), `payslips` (nóminas reales), `absences` (vacaciones, permisos, bajas…), `holidays` (festivos), `templates` (plantillas de turno y semanas tipo), `hourAdjustments` (ajustes de la bolsa), `settings` y `auditLog` (registro de modificaciones).

Versiones del esquema: v1 inicial; v2 separa complementos en su tabla; v3 añade varios trabajos (`jobId` en contratos, turnos, fichajes, nóminas, ausencias y ajustes); v4 añade `salarySnapshots` (meses cerrados) y `assistantMessages` (historial del asistente), sin transformar datos existentes (el cobro aplazado es un campo opcional `payNextMonth` del turno). Las migraciones son aditivas: cada versión nueva declara su esquema y una función `upgrade` que transforma los datos existentes (probado en `tests/unit/db.test.ts`). Nunca se modifica una versión publicada.

### Reglas de cálculo

- Las **horas previstas** (turnos no cancelados, horario previsto) y las **realizadas** (turnos marcados como realizados, con su horario real si se registró) se calculan siempre por separado.
- El cálculo se hace minuto a minuto con marcas de tiempo reales: los turnos que cruzan la medianoche o el cambio de hora se reparten correctamente entre días, franjas nocturnas, fines de semana y festivos.
- Los descansos se recortan al turno y se fusionan: nunca se cuentan dos veces. Si dos turnos se solapan (confirmado por el usuario), los minutos comunes cuentan una sola vez.
- El **exceso sobre el contrato** se calcula por periodo de referencia (semanal, mensual o personalizado) y solo se clasifica como **complementarias** o **extraordinarias** si el usuario activa esas reglas. Si no, aparece como «diferencia sin clasificar», y el usuario decide si se estima a precio ordinario o no.
- Los importes se manejan en **céntimos enteros** y se redondean una vez por línea.
- **No se inventan retenciones**: el neto solo se estima si el usuario introduce sus propias hipótesis de deducción. El resultado se presenta siempre como estimación, nunca como nómina oficial.
- Al fichar la salida, el fichaje se registra como horario real del turno previsto de ese día (o crea un turno realizado), para que las horas trabajadas se cuenten una sola vez.

## Pruebas

- **Unitarias e integración (Vitest):** turnos normales, nocturnos (20:30–01:00), partidos, descansos remunerados/no remunerados/solapados, turnos de más de 24 h, cambio de hora, horas contratadas y distribución, complementarias (con límite), extraordinarias, nocturnidad, fines de semana, festivos, acumulación de pluses, cálculo salarial completo, pagas extra, redondeos, bolsa de horas, vacaciones, Pascua y festivos nacionales, migraciones de base de datos v1→v2 y v2→v3, varios trabajos (cálculos independientes, totales combinados, sin falsos solapamientos entre trabajos, copia de condiciones, fichaje vinculado al trabajo correcto, borrado de un trabajo, importación de copias antiguas, informes por trabajo), fichajes (incluida la recuperación tras cerrar), auditoría, recurrencias, duplicados y solapamientos, plantillas, copia de seguridad (exportar, reemplazar, fusionar sin duplicar, validación), exportación CSV/XLSX/PDF e importación de festivos.
- **Nuevas funcionalidades:** cobro aplazado (turno de octubre cobrado en noviembre, nocturno que cruza de mes, horas complementarias aplazadas, varios complementos, condiciones conservadas, mes cerrado, varios empleos, periodo de nómina del 21 al 20, previsión), importador (OCR real sobre capturas de prueba en formato lista, modo oscuro, semana en columnas e imagen ilegible; reimportación sin duplicados; cuadrante actualizado; filas ilegibles), asistente (preguntas de ejemplo, periodos, empleos y datos insuficientes) y migración v3→v4.
- **E2E (Playwright, móvil iPhone 13 y escritorio):** importar cuadrante con OCR en el navegador sin ninguna petición externa, reimportación, imagen ilegible, importar sin conexión, turno cobrado el mes siguiente con cierre de mes, asistente con historial; asistente inicial, turno nocturno y persistencia tras recargar, fichaje completo con cierre y reapertura de la pestaña, corrección auditada de fichajes, salario y bolsa, exportar → borrar todo → importar sin duplicar, exportación PDF/Excel/CSV, ausencia de desbordamiento horizontal y errores en todas las secciones, navegación móvil/escritorio, vacaciones y festivos, dos trabajos con contratos y tarifas distintas (total combinado y filtro por trabajo), y PWA sin conexión con service worker.

## Limitaciones conocidas

- **Datos por dispositivo y navegador.** No hay sincronización entre dispositivos (sería necesario un servidor). Para pasar datos de uno a otro: exportar copia → importar. Borrar los datos del navegador o desinstalar la PWA elimina la información; la app solicita almacenamiento persistente, pero el navegador puede no concederlo. Haz copias periódicas.
- **Recordatorios:** sin servidor push, las notificaciones solo se muestran mientras la app está abierta o en segundo plano reciente. En iPhone requieren iOS 16.4+ y la app instalada en la pantalla de inicio. El aviso de fichaje abierto aparece siempre dentro de la app.
- **Festivos:** se calculan localmente solo los nacionales comunes de España; los autonómicos y locales se introducen a mano o se importan desde archivo (CSV/JSON). Comprueba siempre el calendario oficial.
- **Cálculo salarial orientativo:** depende de las reglas configuradas. No contempla cotizaciones, IRPF ni particularidades de convenios que no se hayan introducido.
- **Selectores de fecha y hora nativos:** su aspecto (y en algunos navegadores de escritorio el formato de visualización) depende del idioma del sistema operativo; los valores internos y todos los textos de la app usan DD/MM/AAAA y 24 h.
- **Importar cuadrante:** probado con una captura real de Orquest (lista con etiqueta negra de día, días libres y turnos partidos de madrugada) y con capturas que reproducen otros formatos. El OCR depende de la nitidez: si alguna lectura no es fiable o no cuadra (día de la semana, secuencia de fechas, horas), se marca como dudosa para corregirla en la vista previa. Si la captura solo muestra el número del día, el mes y el año se deducen de la «semana o mes del cuadrante». Los tramos de madrugada de un turno partido («19:00 - 23:30 / 0:30 - 3:00») se guardan en el día siguiente, que es cuando ocurren.
- **Asistente:** entiende preguntas sobre los temas previstos (salario, horas por tipo, turnos, pendiente de cobro, previsión, vacaciones, bolsa, nóminas, ausencias, festivos) y sus variantes habituales; no es un modelo de lenguaje, así que preguntas muy distintas se responden con «no lo he entendido» y sugerencias.
- **Meses cerrados:** congelan el cálculo de la nómina; las horas que muestran las estadísticas se siguen calculando con los turnos actuales.
- **Fichaje:** solo puede haber un fichaje abierto a la vez (en el trabajo que elijas al fichar).
- **Bolsa de horas:** es independiente en cada trabajo; en la vista «Todos» de Estadísticas no se suma (elige un trabajo para verla).
- **Comparador de nóminas por concepto:** la correspondencia entre los conceptos de la nómina real y los estimados se hace por nombre y es aproximada.
- **Mover turnos arrastrando** está disponible con ratón; en pantallas táctiles se mueven desde el resumen del día («Mover a otro día»).
- `npm audit` informa de vulnerabilidades moderadas en dependencias de **desarrollo** (herramientas de lint); no forman parte de la aplicación publicada.

## Licencia

MIT.
