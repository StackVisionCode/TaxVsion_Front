export const US_STATE_CODES = new Set([
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
  'DC',
  'PR',
  'GU',
  'VI',
  'AS',
  'MP',
]);

export type TaxIdentifierKind = 'ssn' | 'itin' | 'ein';

export function isValidEmail(value: string): boolean {
  if (value.trim().length === 0 || value.length > 254 || /\s/.test(value)) return false;
  const separator = value.indexOf('@');
  return (
    separator > 0 &&
    separator === value.lastIndexOf('@') &&
    separator < value.length - 3 &&
    value.slice(separator + 1).includes('.') &&
    !value.endsWith('.')
  );
}

export function normalizePhone(value: string, defaultCountry = 'US'): string | null {
  if (PHONE_PATTERN.test(value)) return value;
  const digits = value.replace(/\D/g, '');
  const normalized = defaultCountry === 'US' && digits.length === 10 ? `+1${digits}` : value;
  return PHONE_PATTERN.test(normalized) ? normalized : null;
}

export function isValidPhone(value: string): boolean {
  return PHONE_PATTERN.test(value);
}

export function isValidPostalCode(value: string): boolean {
  return /^[0-9]{5}(-[0-9]{4})?$/.test(value);
}

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function normalizeTaxId(value: string, kind: TaxIdentifierKind): string | null {
  const normalized = value.replace(/[ -]/g, '');
  return /^[0-9]{9}$/.test(normalized) && isValidTaxId(normalized, kind) ? normalized : null;
}

export function maskTaxId(last4: string, kind: TaxIdentifierKind): string {
  return kind === 'ein' ? `••-•••${last4}` : `•••-••-${last4}`;
}

export function looksLikeTaxIdentifier(value: string): boolean {
  if (/(?<![0-9])([0-9]{3}-[0-9]{2}-[0-9]{4}|[0-9]{2}-[0-9]{7})(?![0-9])/.test(value)) return true;
  return [...value.matchAll(/(?<![0-9])[0-9]{9}(?![0-9])/g)].some((match) =>
    (['ssn', 'itin', 'ein'] as const).some((kind) => isValidTaxId(match[0], kind)),
  );
}

export function looksLikeCardNumber(value: string): boolean {
  for (const match of value.matchAll(/[0-9]+(?:[ -][0-9]+)*/g)) {
    const blocks = match[0].split(/[ -]/);
    for (let start = 0; start < blocks.length; start++) {
      let digits = '';
      for (
        let end = start;
        end < blocks.length && digits.length + blocks[end].length <= 19;
        end++
      ) {
        digits += blocks[end];
        if (digits.length >= 13 && luhn(digits)) return true;
      }
    }
  }
  return false;
}

/**
 * Espejo de `Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == "https"` de .NET.
 * `new URL` (WHATWG) acepta casos que .NET rechaza (`https:example.com`, `\` en el host…) y al revés.
 */
export function isHttpsUri(value: string): boolean {
  const text = value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '');
  const scheme = /^https:[/\\]{2}/i.exec(text);
  if (scheme == null) return false;
  const rest = text.slice(scheme[0].length);
  const end = rest.search(/[/?#]/);
  const authority = end < 0 ? rest : rest.slice(0, end);
  if (authority.includes('\\')) return false;
  const at = authority.lastIndexOf('@');
  if (at >= 0 && authority.indexOf('@') !== at) return false;
  const hostAndPort = authority.slice(at + 1);
  return hostAndPort.startsWith('[') ? isBracketHost(hostAndPort) : isNamedHost(hostAndPort);
}

function isBracketHost(value: string): boolean {
  const close = value.indexOf(']');
  if (close < 0) return false;
  const address = value.slice(1, close).replace(/%.*$/, '');
  const after = value.slice(close + 1);
  if (after.startsWith(':') && !isPort(after.slice(1))) return false;
  if (!address.includes(':')) return false;
  try {
    return new URL(`https://[${address}]/`).hostname.length > 0;
  } catch {
    return false;
  }
}

function isNamedHost(value: string): boolean {
  const colon = value.indexOf(':');
  const host = colon < 0 ? value : value.slice(0, colon);
  if (colon >= 0 && !isPort(value.slice(colon + 1))) return false;
  if (host.length === 0) return false;
  for (const character of host) {
    const code = character.codePointAt(0)!;
    if (code < 0x80 ? !/[A-Za-z0-9._-]/.test(character) : code <= 0x9f) return false;
  }
  const labels = host.split(/[.。．｡]/);
  if (labels.length > 1 && labels[labels.length - 1] === '') labels.pop();
  if (labels.some((label) => label.length === 0)) return false;
  // .NET acepta un nombre DNS (etiquetas <= 63) de cualquier largo, u otro host de hasta 256 caracteres.
  return labels.every((label) => label.length <= 63) || host.length <= 256;
}

function isPort(value: string): boolean {
  return /^[0-9]*$/.test(value) && (value === '' || Number(value) <= 65_535);
}

export function parsePlainNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !/^-?[0-9]+(\.[0-9]+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isValidTaxId(value: string, kind: TaxIdentifierKind): boolean {
  if (kind === 'ein') return value.slice(0, 2) !== '00';
  if (kind === 'ssn')
    return (
      value.slice(0, 3) !== '000' &&
      value.slice(0, 3) !== '666' &&
      value[0] !== '9' &&
      value.slice(3, 5) !== '00' &&
      value.slice(5) !== '0000'
    );
  const middle = Number(value.slice(3, 5));
  return (
    value[0] === '9' &&
    ((middle >= 50 && middle <= 65) ||
      (middle >= 70 && middle <= 88) ||
      (middle >= 90 && middle <= 92) ||
      (middle >= 94 && middle <= 99))
  );
}

function luhn(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let number = Number(digits[index]);
    if (alternate) {
      number *= 2;
      if (number > 9) number -= 9;
    }
    sum += number;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;
