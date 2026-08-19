# Stage 1 — build del Angular. `npm run build` = ng build = configuración production
# (defaultConfiguration en angular.json), que via fileReplacements usa environment.prod.ts.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — servir el estático con nginx (imagen chica, sólo archivos).
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/TaxVsion_Front/browser /usr/share/nginx/html
EXPOSE 80
