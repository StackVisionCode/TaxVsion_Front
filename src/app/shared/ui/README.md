# shared/ui/

Librería de componentes propia (Tailwind CSS, aún no instalado). Único barrel (`index.ts`) permitido en todo el repo — se agrega cuando el primer componente se extraiga aquí.

## tooltip (`appTooltip`)

Tooltip ligero para botones de icono (y cualquier elemento con información extra):

```html
<button type="button" aria-label="Pin note" appTooltip="Pin note" (click)="pin()">
  <ion-icon name="bookmark-outline"></ion-icon>
</button>
```

- Importar `TooltipDirective` desde `@shared/ui/tooltip/tooltip.directive`.
- Aparece al pasar el ratón y con foco de teclado (`:focus-visible`) tras 300 ms; se oculta al salir,
  perder el foco, pulsar, Escape o hacer scroll. En táctil no se abre con el toque.
- Se porta al `<body>` con `position: fixed` (`portalToBody`, igual que `app-dropdown-menu`): ningún
  `overflow` lo recorta y funciona dentro del panel del menú (z-index por encima).
- Arriba por defecto y flip abajo si no cabe; `appTooltipPlacement="bottom"` invierte la preferencia.
- `appTooltipDelay` (ms) y `appTooltipDisabled`. Texto vacío = no hace nada.
- Accesibilidad: `role="tooltip"` + `aria-describedby` en el anfitrión mientras se ve. **No sustituye al
  `aria-label`** de un botón de solo icono: ponlos ambos. Sin animación con reduced-motion.

## Extensiones recientes

- `app-segmented`: `icon` opcional por opción y `mode="radio"` (semántica `radiogroup`/`radio` con
  `aria-checked`) para elegir un valor que no es una pestaña (p. ej. visibilidad de una nota).
- `app-skeleton`: variante `feed` (tarjetas con avatar + líneas) para feeds de notas/actividad.
- `app-stat-cards`: `delta` opcional (flecha + texto, color por sentimiento) e `info` (botón (i) con
  tooltip y el mismo texto en `sr-only`).
- `app-trend-bars` (nuevo): barras agrupadas de una serie temporal, HTML + CSS sin librería; serie
  `striped` para no depender del color, `ariaLabel` con el resumen y tabla "View as table" debajo.
