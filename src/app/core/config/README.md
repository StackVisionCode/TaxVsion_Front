# core/config/

Configuración de arranque y de destinos:

- `api-config.service.ts` — base de la API por superficie (sistema o tenant por Host).
- `auth-initializer.ts` — inicializador de la sesión (`provideAppInitializer`).
- `landing.ts` — URL del sitio público (`landingUrl`) y el guard que reenvía los `/register*` viejos al Landing.
