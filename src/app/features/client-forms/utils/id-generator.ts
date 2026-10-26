export type DefinitionIdPrefix = 'pg' | 'sc' | 'fd';

export function createDefinitionId(prefix: DefinitionIdPrefix): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map(value => alphabet[value % alphabet.length]).join('')}`;
}
