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
        // bg-orange-600/10, etc.) contra un color referenciado por variable;
        // una variable con el hex completo (`var(--x, #fff)`) rompe esos
        // modificadores porque Tailwind no puede extraerle los canales RGB.
        //
        // Ya NO hay personalización por tenant ni por usuario: el azul del
        // brandbook es FIJO para toda la app. ThemeService (core/theme/)
        // solo reescribe estas variables en :root con ese mismo azul al
        // arrancar — ningún componente necesita tocarse, siguen usando
        // `bg-indigo-600`, `text-orange-500`, etc. tal cual.
        //
        // Los fallbacks son la PALETA DE MARCA (ver `brand` más abajo): la rampa
        // se generó con el mismo algoritmo que usa ThemeService (ancla 600 para
        // primary = Bold Blue #1e466b, ancla 500 para secondary = Light Blue
        // #67baf4), así que sin JS se ve idéntico.
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
         * Paleta de marca. Fuente única de los colores del brandbook, para no
         * volver a esparcir hex sueltos por las plantillas:
         *   bold    #1e466b  azul de marca (acciones, encabezados, tile focal)
         *   light   #67baf4  acento claro (fondos suaves, estados)
         *   canvas  #f4efe6  fondo crema de la aplicación (las tarjetas blancas van encima)
         *   white   #fafafa  superficie neutra interna de tarjetas
         *   black   #0d0d0d  texto principal
         * Los tonos intermedios (surface/border) salen de la misma familia para
         * que las tarjetas y separadores no necesiten grises ajenos a la marca.
         */
        /**
         * Neutros (palanca, igual que indigo/orange): ThemeService.applyNeutrals() tiñe estos
         * grises con un hue CÁLIDO (piedra) que armoniza con el canvas crema, conservando la
         * LUMINOSIDAD de cada shade → el contraste texto/fondo se preserva por construcción.
         * Fallbacks = el gris de hoy (default de Tailwind 50-800 + Jet Black #0d0d0d en 900);
         * sin ThemeService se ve neutro. Triplete "R G B" para preservar los modificadores de
         * opacidad (text-gray-500/70, etc.). Sobre el canvas usar gray-600 o más oscuro:
         * gray-500 sobre #f4efe6 queda en ~4.2:1, por debajo de AA.
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
          /**
           * bold/light/ink leen las mismas variables que indigo-600/orange-500/indigo-700, que
           * ThemeService fija al azul del brandbook (sin personalización por tenant/usuario).
           *
           * Los fallbacks son EXACTAMENTE esos hex (indigo-600 = #1e466b, indigo-700 = #132c43,
           * orange-500 = #67baf4), así que sin JS no cambia ni un pixel.
           */
          bold: 'rgb(var(--color-indigo-600-rgb, 30 70 107) / <alpha-value>)',
          light: 'rgb(var(--color-orange-500-rgb, 103 186 244) / <alpha-value>)',
          /** Azul muy oscuro para textos sobre fondos claros con más peso que `bold`. */
          ink: 'rgb(var(--color-indigo-700-rgb, 19 44 67) / <alpha-value>)',
          /**
           * Superficies: del más claro (fondo de tarjeta) al más saturado.
           * Siguen FIJAS a propósito: no coinciden con ningún shade de la rampa
           * (surface #f1f6fb vs indigo-50 #f5f7fa), así que engancharlas a una
           * variable existente cambiaría el look por defecto de todos los
           * tenants. Necesitan su propio canal en ThemeService para tematizarse.
           */
          surface: '#f1f6fb',
          'surface-strong': '#e2edf7',
          border: '#d7e3ef',
          /**
           * Canvas crema: fondo de la shell. `canvas-deep` es el extremo del gradiente que da
           * profundidad (arriba-izquierda claro → abajo-derecha más hondo). `line` es el borde
           * fino cálido de las tarjetas blancas sobre el canvas.
           */
          canvas: '#f4efe6',
          'canvas-deep': '#ede5d6',
          line: '#e9e2d4',
        },

        /**
         * Acentos cálidos que armonizan con el navy de marca sobre el canvas crema (tiles de
         * KPI, series de charts, puntos de notas, iconos de actividad). 100 = tinte de fondo,
         * 500 = relleno/serie, 600 = círculo con icono blanco (≥3:1), 700 = texto sobre su 100
         * (≥4.5:1). No usar como colores de estado: verde/rojo semántico siguen siendo
         * emerald/red.
         */
        sand: {
          100: '#f3e8d4',
          500: '#c9a46a',
          600: '#a8823f',
          700: '#7a5a26',
        },
        sage: {
          100: '#e3ede6',
          500: '#6f9a82',
          600: '#55806a',
          700: '#3f6553',
        },
      },
      boxShadow: {
        /** Sombra cálida mínima de las tarjetas sobre el canvas crema. */
        card: '0 1px 2px rgb(60 45 20 / 0.04), 0 8px 24px -12px rgb(60 45 20 / 0.10)',
      },
    },
  },
  plugins: [],
}
