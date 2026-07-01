# core/

Singletons de infraestructura. Cero UI. `core/*` nunca importa de `features/*` ni de `shared/ui/*`.

- `auth/` — token.service, auth.guard, role.guard, permission.guard.
- `http/` — interceptores funcionales (`HttpInterceptorFn`): auth, error, ensamblados en `http.providers.ts`.
- `errors/` — manejo global de errores.
- `realtime/` — infraestructura de sockets transversal.
- `i18n/` — traducción y loaders.
- `models/` — tipos/enums app-wide.
- `config/` — inicializadores de la app.
- `services/` — singletons app-wide que no encajan en las categorías anteriores.

Ver `ARCHITECTURE.md` en la raíz del repo.
