# Content Engine

Planea, produce, revisa y publica contenido de Instagram con agentes de Claude Code.

## Flujo

1. El planner crea las ideas de la semana.
2. El productor escribe el copy y genera las láminas.
3. Una persona revisa, anota ajustes y aprueba.
4. El sistema publica en la fecha programada.

## Requisitos

- Node 22.18 o superior
- Claude Code con sesión iniciada
- Chromium
- Cuenta profesional de Instagram y una app de Meta

## Uso

```bash
cp .env.example .env
npm install
npm run build
npm start
```

## Conectar Instagram

1. Crea una app en developers.facebook.com y agrega el producto API de Instagram con inicio de sesión de Instagram.
2. En la configuración del producto, pega la URL de redirección que muestra la sección Conexiones.
3. Agrega la cuenta como probador de la app y acepta la invitación desde Instagram.
4. Define `IG_APP_ID` e `IG_APP_SECRET` y reinicia.
5. En Conexiones, pulsa Conectar. El token se guarda y se renueva solo.

## Variables

| Variable | Uso |
| --- | --- |
| `PUBLIC_URL` | URL pública del servidor. Instagram descarga las piezas desde aquí. |
| `ADMIN_PASSWORD` | Contraseña de la interfaz. |
| `SESSION_SECRET` | Secreto de la sesión. |
| `TIMEZONE` | Zona horaria de los hooks semanales. |
| `CLAUDE_BIN` | Ruta de Claude Code. |
| `CHROMIUM_PATH` | Ruta de Chromium. |
| `IG_APP_ID` | Id de la app de Meta. |
| `IG_APP_SECRET` | Secreto de la app de Meta. |

## Estructura

| Ubicación | Contenido |
| --- | --- |
| `src/server` | API, cola, agentes, render y publicador |
| `src/web` | Interfaz |
| `seed` | Agentes, skills, bases y templates iniciales |
| `data` | Base de datos, piezas y copia editable de `seed` |

## Pruebas

```bash
npm test
npm run typecheck
```
