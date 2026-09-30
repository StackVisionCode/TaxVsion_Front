/**
 * Catálogo de mensajes AMABLES por status HTTP + heurística para decidir si el texto que mandó el
 * backend es apto para el usuario o es jerga técnica.
 *
 * Criterio: el `message`/`detail` del backend casi siempre ya es copy de producto ("Customer already
 * exists."), así que se respeta. Solo se reemplaza por el catálogo cuando el texto "huele" técnico:
 * vacío, stack traces, nombres de excepción, SQL, URLs, GUIDs sueltos, frases de razón HTTP de
 * ASP.NET ("Bad Request", "One or more validation errors occurred.") o el `err.message` de Angular.
 *
 * Funciones puras (sin Angular) para poder testearlas y reutilizarlas desde `toApiError`.
 */

/** Fallback seguro cuando no hay nada mejor que decir. */
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

/** 503 sin mensaje propio (servicio caído, denylist de sesión): transitorio, no es culpa del usuario. */
export const SERVICE_UNAVAILABLE_MESSAGE = 'The service is temporarily unavailable. Please try again in a moment.';

/** status 0: no hubo respuesta (sin red, backend caído o CORS). */
export const NETWORK_ERROR_MESSAGE = "We couldn't reach the server. Check your connection and try again.";

const STATUS_MESSAGES: Readonly<Record<number, string>> = {
  0: NETWORK_ERROR_MESSAGE,
  400: "Some of the information isn't valid. Please review it and try again.",
  401: 'Your session has expired. Please sign in again.',
  403: "You don't have permission to do that.",
  404: "We couldn't find what you were looking for. It may have been moved or deleted.",
  409: 'This conflicts with a recent change. Refresh the page and try again.',
  413: 'This file is too large to upload.',
  422: "We couldn't process this request. Please review the information and try again.",
  429: "You're making requests too quickly. Please wait a moment and try again.",
  500: 'Something went wrong on our end. Please try again in a moment.',
  502: "We're having trouble reaching one of our services. Please try again in a moment.",
  503: SERVICE_UNAVAILABLE_MESSAGE,
  504: 'The server took too long to respond. Please try again.',
};

/** Mensaje amable para un status HTTP; los no catalogados caen a su familia (4xx/5xx). */
export function messageForStatus(status: number | null | undefined): string {
  if (status === null || status === undefined) {
    return GENERIC_ERROR_MESSAGE;
  }
  const exact = STATUS_MESSAGES[status];
  if (exact) {
    return exact;
  }
  return status >= 500 ? STATUS_MESSAGES[500] : GENERIC_ERROR_MESSAGE;
}

/** Frases por defecto de ASP.NET / HTTP: son técnicas aunque parezcan inglés normal. */
const REASON_PHRASES = new Set(
  [
    'bad request',
    'unauthorized',
    'forbidden',
    'not found',
    'method not allowed',
    'conflict',
    'payload too large',
    'request entity too large',
    'unsupported media type',
    'unprocessable entity',
    'too many requests',
    'internal server error',
    'bad gateway',
    'service unavailable',
    'gateway timeout',
    'error',
    'unknown error',
    'an error occurred.',
    'an error occurred while processing your request.',
    'one or more validation errors occurred.',
  ],
);

const TECHNICAL_PATTERNS: readonly RegExp[] = [
  /http failure (response|during parsing)/i,
  /https?:\/\//i,
  // Stack traces de .NET ("   at Foo.Bar()") y de JS ("at fn (file.js:1:2)").
  /\n\s*at\s/,
  /^\s*at\s+[\w$.<>]+\s*\(/m,
  /\.(cs|js|ts):line\s*\d+/i,
  /\.(js|ts|mjs):\d+:\d+/,
  // Nombres de excepción / tipos de error de runtime.
  /\b\w*Exception\b/,
  /\b(TypeError|ReferenceError|SyntaxError|RangeError)\b/,
  /\b(System|Microsoft|Npgsql|Newtonsoft|MongoDB|StackExchange)\.[A-Z]\w*/,
  /object reference not set/i,
  /cannot read propert(y|ies) of/i,
  /is not a function/i,
  /\bundefined\b|\bnull reference\b|\bNaN\b/,
  // SQL / base de datos.
  /\b(select\s.+\sfrom|insert\s+into|delete\s+from|update\s+\w+\s+set)\b/i,
  /\bSQLSTATE\b|\bsql\b/i,
  /violates (foreign key|unique|check|not-null) constraint/i,
  /duplicate key value/i,
  // Binding de JSON de ASP.NET ("could not be converted to System.Guid. Path: $.id").
  /could not be converted to/i,
  /\$\.\w/,
  /^\s*[{[]/,
  // Jerga de infraestructura que el backend deja en `detail`.
  /correlation id/i,
  /refresh (your|the) token/i,
];

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Un código tipo `Customer.NotFound` suelto no es un mensaje. */
const BARE_CODE = /^[A-Za-z]+(\.[A-Za-z0-9_]+)+$/;

/** Más largo que esto no es un mensaje de producto, es un volcado. */
const MAX_HUMAN_LENGTH = 400;

/**
 * true si el texto NO debe mostrarse al usuario tal cual. Conservador hacia el lado del backend:
 * ante la duda (texto corto, en prosa, sin marcas técnicas) se considera humano.
 */
export function looksTechnical(text: string | null | undefined): boolean {
  if (typeof text !== 'string') {
    return true;
  }
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.length > MAX_HUMAN_LENGTH) {
    return true;
  }
  if (REASON_PHRASES.has(trimmed.toLowerCase())) {
    return true;
  }
  if (BARE_CODE.test(trimmed)) {
    return true;
  }
  // GUID-only (con o sin puntuación/espacios alrededor).
  if (!trimmed.replace(GUID, '').replace(/[\s.,:;'"()[\]-]/g, '')) {
    return true;
  }
  return TECHNICAL_PATTERNS.some(pattern => pattern.test(trimmed));
}

/** El texto del backend si es humano; si no, el mensaje amable del status. */
export function friendlyMessage(status: number | null | undefined, backendText: string | null | undefined): string {
  return looksTechnical(backendText) ? messageForStatus(status) : (backendText as string).trim();
}

/**
 * Primer mensaje de campo HUMANO de un ValidationProblemDetails de ASP.NET
 * (`errors: { "Email": ["Email is required."] }`). null si no hay ninguno presentable.
 */
export function firstHumanFieldError(errors: unknown): string | null {
  if (!errors || typeof errors !== 'object' || Array.isArray(errors)) {
    return null;
  }
  for (const value of Object.values(errors as Record<string, unknown>)) {
    const messages = Array.isArray(value) ? value : [value];
    for (const message of messages) {
      if (typeof message === 'string' && !looksTechnical(message)) {
        return message.trim();
      }
    }
  }
  return null;
}
