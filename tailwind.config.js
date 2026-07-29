/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{html,ts}"],
  theme: {
    extend: {
      colors: {
        // Reemplaza los shades de indigo (color primario) y orange (color
        // secundario) que ya se usan en toda la app por variables CSS con el
        // patrón rgb(var(...) / <alpha-value>) — el único que deja a Tailwind
        // seguir generando los modificadores de opacidad (ring-indigo-500/30,
        // bg-orange-600/10, etc.) contra un color dinámico; una variable con
        // el hex completo (`var(--x, #fff)`) rompe esos modificadores porque
        // Tailwind no puede extraerle los canales RGB. El fallback (RGB del
        // hex original de Tailwind, espacio sin comas) hace que sin JS o con
        // los colores por defecto se vea exactamente igual que hoy.
        // ThemeService (core/theme/) sobreescribe estas variables en :root
        // cuando el usuario elige un color en Settings > Overview — ningún
        // componente necesita tocarse, siguen usando `bg-indigo-600`,
        // `text-orange-500`, etc. tal cual.
        indigo: {
          50: 'rgb(var(--color-indigo-50-rgb, 238 242 255) / <alpha-value>)',
          100: 'rgb(var(--color-indigo-100-rgb, 224 231 255) / <alpha-value>)',
          200: 'rgb(var(--color-indigo-200-rgb, 199 210 254) / <alpha-value>)',
          300: 'rgb(var(--color-indigo-300-rgb, 165 180 252) / <alpha-value>)',
          400: 'rgb(var(--color-indigo-400-rgb, 129 140 248) / <alpha-value>)',
          500: 'rgb(var(--color-indigo-500-rgb, 99 102 241) / <alpha-value>)',
          600: 'rgb(var(--color-indigo-600-rgb, 79 70 229) / <alpha-value>)',
          700: 'rgb(var(--color-indigo-700-rgb, 67 56 202) / <alpha-value>)',
        },
        orange: {
          50: 'rgb(var(--color-orange-50-rgb, 255 247 237) / <alpha-value>)',
          100: 'rgb(var(--color-orange-100-rgb, 255 237 213) / <alpha-value>)',
          200: 'rgb(var(--color-orange-200-rgb, 254 215 170) / <alpha-value>)',
          300: 'rgb(var(--color-orange-300-rgb, 253 186 116) / <alpha-value>)',
          400: 'rgb(var(--color-orange-400-rgb, 251 146 60) / <alpha-value>)',
          500: 'rgb(var(--color-orange-500-rgb, 249 115 22) / <alpha-value>)',
          600: 'rgb(var(--color-orange-600-rgb, 234 88 12) / <alpha-value>)',
          700: 'rgb(var(--color-orange-700-rgb, 194 65 12) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}
