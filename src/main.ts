import { bootstrapApplication } from '@angular/platform-browser';
import { defineCustomElements as defineIonicons } from 'ionicons/loader';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// ionicons autohospedado: el loader se bundlea con la app (sin <script> en
// index.html, que vite intentaba pre-transformar y fallaba) y los SVG se
// sirven desde /ionicons/ (copiados vía angular.json assets).
defineIonicons(window, { resourcesUrl: '/ionicons/' });

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
