# Arquitectura — TaxVision Front

Proyecto Angular nuevo, independiente de `CRMTAXPROFRONTEND`. Arranca vacío (solo el esqueleto de carpetas y tooling) y se va poblando incrementalmente migrando cada feature del proyecto original según el mapeo documentado abajo.

## Stack

- **Angular**: 21.2.x (última versión estable compatible con el Node instalado; Angular 22 requiere Node ≥24.15/26 — actualizar Node y hacer `ng update` a Angular 22 es un paso aparte, pendiente de decisión).
- **Package manager**: npm.
- **Estado**: Angular Signals + servicios "store" por feature (sin NgRx, sin RxJS `BehaviorSubject` clásico para estado nuevo).
- **UI**: Tailwind CSS + biblioteca de componentes propia en `shared/ui/` (sin librerías de terceros como PrimeNG). Tailwind aún no está instalado — pendiente de autorización explícita para instalar paquetes.
- **Testing**: Vitest (viene por defecto en el scaffold de Angular 21, reemplaza a Karma/Jasmine).
- **Monorepo**: workspace Angular CLI simple, sin Nx.

## Árbol de carpetas

```
src/
├── environments/
└── app/
    ├── app.config.ts / app.routes.ts
    ├── layout/                 # shell visual: app-shell, navbar, sidebar, auth-shell
    ├── core/                   # singletons, cero UI, nunca importa de features/
    │   ├── auth/  http/  errors/  realtime/  i18n/  models/  config/  services/
    ├── shared/                 # 100% agnóstico de negocio, reutilizable por cualquier feature
    │   ├── ui/  directives/  pipes/  services/  models/  utils/
    ├── features/               # 1 carpeta por dominio de negocio
    │   └── <feature-name>/
    │       ├── <feature-name>.routes.ts
    │       ├── data-access/    # <feature>.store.ts, <feature>.service.ts, <feature>.model.ts
    │       ├── components/     # contenedores "smart" — únicos que inyectan el store
    │       ├── ui/              # presentacionales "dumb" — solo input()/output()
    │       └── utils/
    └── pages/                  # LEGACY — no existe en este proyecto todavía; se va poblando
                                 # copiando/migrando features desde CRMTAXPROFRONTEND
```

**Regla anti-barrel**: no usar `index.ts` en `core/` ni en `features/*`. Único barrel permitido: `shared/ui/index.ts`.

## Convenciones de nombres

Kebab-case en el 100% de archivos y carpetas, sin excepción.

| Tipo | Sufijo | Ejemplo |
|---|---|---|
| Componente | `.component.ts` | `accounts-list.component.ts` |
| Store de signals | `.store.ts` | `accounts.store.ts` |
| Servicio HTTP/dominio | `.service.ts` | `accounts.service.ts` |
| Guard funcional | `.guard.ts` | `auth.guard.ts` |
| Interceptor funcional | `.interceptor.ts` | `auth.interceptor.ts` |
| Modelos/DTOs | `.model.ts` / `.types.ts` | `account.model.ts` |
| Rutas de feature | `.routes.ts` | `accounts.routes.ts` |
| Test | `.spec.ts` co-ubicado | `accounts.store.spec.ts` |

## Path aliases (`tsconfig.json`)

```
@core/*      -> src/app/core/*
@shared/*    -> src/app/shared/*
@features/*  -> src/app/features/*
@layout/*    -> src/app/layout/*
@env/*       -> src/environments/*
```

Regla de import: `features/*` nunca importa de otra `features/*` directamente — lo compartido sube a `shared/` o `core/`. `core/*` y `shared/*` nunca importan de `features/*`.

## Reglas contra duplicación

Antes de crear un componente o servicio nuevo dentro de una feature:
1. ¿Ya existe algo equivalente en `shared/ui/`, `shared/services/` o `core/services/`? → usarlo, no reimplementarlo.
2. ¿Lo va a necesitar otra feature? → crearlo directamente en `shared/` o `core/`, no dentro de `features/<name>/`.
3. Si se detecta que 2+ features necesitan la misma pieza, se promueve a `shared/` o `core/` el mismo día que se detecta.

## Estado: signal store por feature

- Stores transversales (sesión, notificaciones globales, idioma) → `providedIn: 'root'`.
- Stores de una feature → provistos en `providers` del route config de esa feature (se destruyen automáticamente al salir de esa rama de rutas).
- Componentes `ui/` (presentacionales) nunca inyectan el store — reciben datos vía `input()`/`model()` y emiten vía `output()`. Solo el componente contenedor en `components/` inyecta el store.

## Origen de este proyecto

Este proyecto nace como reemplazo independiente de `CRMTAXPROFRONTEND` (Angular 18, npm, ~44 módulos bajo `pages/`, deuda de organización: nombres inconsistentes español/inglés, servicios duplicados, sin ESLint/Prettier/Husky, dos god components). En vez de migrar in-place, se decidió arrancar un proyecto nuevo y limpio, y portar cada feature manualmente siguiendo el mismo mapeo y orden de tiers que se había diseñado para la migración in-place:

- **Tier 1 — Bajo riesgo (primero)**: error-pages, placeholder, verify, notifications, profile, referrals, preview, support, storage-management, suite-store, template-store, e-pay-form, intellipay-page.
- **Tier 2 — Riesgo medio**: auth, company, inbox, support-chat, sms, task, inventory, template-creator, user-templates, form-builder, signature (firma/generador-firmas/customer-signature), documents, email, cart, payment, ai-assistant (consolidado), billing.
- **Tier 3 — Alto riesgo / god components**: invoices, accounts (cuentas), setting-modules, company, campaigns (god component), taxtalk (god component), dashboard.

`landing-page` y `taxcoins` quedan fuera del alcance (no se portan).

Tooling pendiente de instalar cuando se autorice: Tailwind CSS, ESLint + eslint-plugin-boundaries, Husky + lint-staged, commitlint, Playwright (e2e). No se instala ningún paquete nuevo sin autorización explícita.
