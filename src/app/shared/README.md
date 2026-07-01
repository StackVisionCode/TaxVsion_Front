# shared/

100% agnóstico de negocio, reutilizable por cualquier feature. `shared/*` nunca importa de `features/*`.

- `ui/` — librería de componentes propia (Tailwind). Único barrel (`index.ts`) permitido en todo el repo.
- `directives/` — directivas transversales.
- `pipes/` — pipes transversales.
- `services/` — servicios de UI transversal (toast, modal, confirmation, date-formatter, timezone) — no de negocio.
- `models/` — tipos compartidos.
- `utils/` — funciones puras reutilizables.

Ver `ARCHITECTURE.md` en la raíz del repo.
