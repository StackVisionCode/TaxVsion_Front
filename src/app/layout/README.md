# layout/

Shell visual de la aplicación. Componentes de layout puro (navbar, sidebar, contenedores de rutas) — nunca lógica de negocio.

- `app-shell/` — shell de la app autenticada, `<router-outlet>` + children de `features/`.
- `navbar/`, `sidebar/` — navegación global.
- `auth-shell/` — layout simple para las rutas `/auth/*`.
