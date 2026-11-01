import { Device } from 'mediasoup-client';

/**
 * Único punto que instancia el Device de mediasoup-client, y siempre se carga con `import()`.
 * mediasoup-client es CommonJS: importarlo directo con `import()` deja un chunk sin `export` cuando el
 * build fusiona chunks (`NG_BUILD_OPTIMIZE_CHUNKS`, Dockerfile) y `Device` llega undefined
 * ("a is not a constructor" en producción). Este módulo ESM exporta una función propia, que el
 * optimizador sí conserva.
 */
export function createMediasoupDevice(): Device {
  return new Device();
}
