/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      spacing: {
        // Alias de la variable CSS --navbar-h (definida en src/styles.css).
        // Única fuente de verdad: cualquier componente que se posicione
        // relativo a la altura del navbar fijo (pt-navbar, top-[var(--navbar-h)],
        // h-[calc(100vh-var(--navbar-h))]...) debe usar esta variable, nunca un
        // valor `Npx` suelto. Ver ARCHITECTURE.md → "Layout".
        navbar: 'var(--navbar-h)',
      },
    },
  },
  plugins: [],
}
