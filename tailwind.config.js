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
        //
        // Los fallbacks son la PALETA DE MARCA (ver `brand` más abajo): la rampa
        // se generó con el mismo algoritmo que usa ThemeService (ancla 600 para
        // primary = Bold Blue #1e466b, ancla 500 para secondary = Light Blue
        // #67baf4), así que sin JS o con "restablecer" se ve idéntico.
        indigo: {
          50: 'rgb(var(--color-indigo-50-rgb, 245 247 250) / <alpha-value>)',
          100: 'rgb(var(--color-indigo-100-rgb, 214 226 237) / <alpha-value>)',
          200: 'rgb(var(--color-indigo-200-rgb, 176 201 223) / <alpha-value>)',
          300: 'rgb(var(--color-indigo-300-rgb, 136 174 210) / <alpha-value>)',
          400: 'rgb(var(--color-indigo-400-rgb, 90 146 197) / <alpha-value>)',
          500: 'rgb(var(--color-indigo-500-rgb, 54 114 169) / <alpha-value>)',
          600: 'rgb(var(--color-indigo-600-rgb, 30 70 107) / <alpha-value>)',
          700: 'rgb(var(--color-indigo-700-rgb, 19 44 67) / <alpha-value>)',
        },
        orange: {
          50: 'rgb(var(--color-orange-50-rgb, 243 248 252) / <alpha-value>)',
          100: 'rgb(var(--color-orange-100-rgb, 227 239 248) / <alpha-value>)',
          200: 'rgb(var(--color-orange-200-rgb, 204 228 245) / <alpha-value>)',
          300: 'rgb(var(--color-orange-300-rgb, 178 216 242) / <alpha-value>)',
          400: 'rgb(var(--color-orange-400-rgb, 147 203 242) / <alpha-value>)',
          500: 'rgb(var(--color-orange-500-rgb, 103 186 244) / <alpha-value>)',
          600: 'rgb(var(--color-orange-600-rgb, 55 164 241) / <alpha-value>)',
          700: 'rgb(var(--color-orange-700-rgb, 17 147 238) / <alpha-value>)',
        },

        /**
         * Paleta de marca. Fuente única de los 4 colores del brandbook, para no
         * volver a esparcir hex sueltos por las plantillas:
         *   bold   #1e466b  azul de marca (acciones, encabezados)
         *   light  #67baf4  acento claro (fondos suaves, estados)
         *   white  #fafafa  fondo de la aplicación
         *   black  #0d0d0d  texto principal
         * Los tonos intermedios (surface/border) salen de la misma familia para
         * que las tarjetas y separadores no necesiten grises ajenos a la marca.
         */
        /**
         * Neutros tematizables (palanca, igual que indigo/orange): ThemeService.applyNeutrals()
         * tiñe estos grises con el HUE del primary del tenant conservando la LUMINOSIDAD de cada
         * shade → el contraste texto/fondo se preserva por construcción. Fallbacks = el gris de
         * hoy (default de Tailwind 50-800 + Jet Black #0d0d0d en 900, ~560 usos de texto); sin
         * ThemeService o sin marca se ve idéntico. Triplete "R G B" para preservar los
         * modificadores de opacidad (text-gray-500/70, etc.).
         */
        gray: {
          50: 'rgb(var(--color-gray-50-rgb, 249 250 251) / <alpha-value>)',
          100: 'rgb(var(--color-gray-100-rgb, 243 244 246) / <alpha-value>)',
          200: 'rgb(var(--color-gray-200-rgb, 229 231 235) / <alpha-value>)',
          300: 'rgb(var(--color-gray-300-rgb, 209 213 219) / <alpha-value>)',
          400: 'rgb(var(--color-gray-400-rgb, 156 163 175) / <alpha-value>)',
          500: 'rgb(var(--color-gray-500-rgb, 107 114 128) / <alpha-value>)',
          600: 'rgb(var(--color-gray-600-rgb, 75 85 99) / <alpha-value>)',
          700: 'rgb(var(--color-gray-700-rgb, 55 65 81) / <alpha-value>)',
          800: 'rgb(var(--color-gray-800-rgb, 31 41 55) / <alpha-value>)',
          900: 'rgb(var(--color-gray-900-rgb, 13 13 13) / <alpha-value>)',
        },

        brand: {
          black: '#0d0d0d',
          white: '#fafafa',
          bold: '#1e466b',
          light: '#67baf4',
          // Superficies: del más claro (fondo de tarjeta) al más saturado.
          surface: '#f1f6fb',
          'surface-strong': '#e2edf7',
          border: '#d7e3ef',
          // Azul muy oscuro para textos sobre fondos claros que necesitan más peso que `bold`.
          ink: '#132c43',
        },
      },
    },
  },
  plugins: [],
}
