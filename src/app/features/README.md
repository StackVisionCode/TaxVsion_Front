# features/

Una carpeta por dominio de negocio. Cada `features/<name>/` sigue siempre la misma forma:

```
<name>/
├── <name>.routes.ts     # export const NAME_ROUTES: Routes
├── data-access/         # <name>.store.ts, <name>.service.ts, <name>.model.ts
├── components/          # contenedores "smart" — únicos que inyectan el store
├── ui/                  # presentacionales "dumb" — solo input()/output()
└── utils/                # opcional
```

Regla de import: una feature nunca importa directamente de otra `features/*` — lo compartido sube a `shared/` o `core/`.

Vacío por ahora. Se puebla portando cada feature de `CRMTAXPROFRONTEND/src/app/pages/` siguiendo el orden de tiers documentado en `ARCHITECTURE.md`.
