/**
 * Lector JSON estricto, espejo de `StrictJson` del engine .NET (System.Text.Json):
 * miembros no mapeados, propiedades duplicadas, profundidad > 32, nulls en miembros no anulables,
 * enteros con fracción o exponente y surrogates sueltos se rechazan. `any` equivale a `JsonElement`.
 */
export type StrictJsonSchema =
  | { readonly kind: 'any' }
  | { readonly kind: 'string' }
  | { readonly kind: 'int' }
  | { readonly kind: 'bool' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, StrictJsonField>> }
  | { readonly kind: 'list'; readonly item: StrictJsonSchema }
  | { readonly kind: 'dict'; readonly value: StrictJsonSchema };

export interface StrictJsonField {
  readonly schema: StrictJsonSchema;
  readonly required?: boolean;
  readonly nullable?: boolean;
}

export const STRICT_JSON_MAX_DEPTH = 32;

export class StrictJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StrictJsonError';
  }
}

/** Lanza `StrictJsonError` si el texto no cumple el esquema. */
export function readStrictJson(text: string, schema: StrictJsonSchema): unknown {
  if (LONE_SURROGATE.test(text)) throw new StrictJsonError('Invalid UTF-16 text.');
  return new StrictReader(text).root(schema);
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const INT32 = /^-?(?:0|[1-9][0-9]*)$/;
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/;
const ANY: StrictJsonSchema = { kind: 'any' };

class StrictReader {
  private position = 0;
  private depth = 0;

  constructor(private readonly text: string) {}

  root(schema: StrictJsonSchema): unknown {
    this.skipWhitespace();
    // Igual que .NET: un `null` raíz no es un documento válido para el modelo.
    const value = this.value(schema, false);
    this.skipWhitespace();
    if (this.position !== this.text.length) this.fail('Unexpected trailing content.');
    return value;
  }

  private value(schema: StrictJsonSchema, nullable: boolean): unknown {
    if (this.peek() === 'n') {
      this.literal('null');
      if (!nullable && schema.kind !== 'any') this.fail('Null is not allowed here.');
      return null;
    }
    switch (schema.kind) {
      case 'any':
        return this.anyValue();
      case 'string':
        return this.string(true);
      case 'int':
        return this.integer();
      case 'bool':
        return this.boolean();
      case 'enum':
        return this.enumValue(schema.values);
      case 'object':
        return this.object(schema.fields);
      case 'list':
        return this.array(schema.item);
      case 'dict':
        return this.dictionary(schema.value, true);
    }
  }

  private anyValue(): unknown {
    const next = this.peek();
    if (next === '{') return this.dictionary(ANY, false);
    if (next === '[') return this.array(ANY);
    if (next === '"') return this.string(false);
    if (next === 't' || next === 'f') return this.boolean();
    if (next === 'n') {
      this.literal('null');
      return null;
    }
    return Number(this.numberText());
  }

  private object(fields: Readonly<Record<string, StrictJsonField>>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    this.members(
      (key) => {
        if (seen.has(key)) this.fail(`Duplicate property '${key}'.`);
        seen.add(key);
        const field = Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined;
        if (field == null) this.fail(`Unmapped property '${key}'.`);
        result[key] = this.value(field.schema, field.nullable === true);
      },
      true,
    );
    for (const [name, field] of Object.entries(fields))
      if (field.required && !seen.has(name)) this.fail(`Missing required property '${name}'.`);
    return result;
  }

  private dictionary(value: StrictJsonSchema, strictKeys: boolean): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    this.members((key) => {
      if (seen.has(key)) this.fail(`Duplicate property '${key}'.`);
      seen.add(key);
      // Los elementos de colección no aplican anotaciones de nulabilidad en System.Text.Json.
      const item = this.value(value, true);
      Object.defineProperty(result, key, {
        value: item,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }, strictKeys);
    return result;
  }

  private members(onMember: (key: string) => void, strictKeys: boolean): void {
    this.enter();
    this.expect('{');
    this.skipWhitespace();
    if (this.peek() === '}') {
      this.position++;
      this.leave();
      return;
    }
    for (;;) {
      this.skipWhitespace();
      if (this.peek() !== '"') this.fail('Expected a property name.');
      const key = this.string(strictKeys);
      this.skipWhitespace();
      this.expect(':');
      this.skipWhitespace();
      onMember(key);
      this.skipWhitespace();
      const next = this.next();
      if (next === '}') break;
      if (next !== ',') this.fail('Expected , or }.');
    }
    this.leave();
  }

  private array(item: StrictJsonSchema): unknown[] {
    this.enter();
    this.expect('[');
    const result: unknown[] = [];
    this.skipWhitespace();
    if (this.peek() === ']') {
      this.position++;
      this.leave();
      return result;
    }
    for (;;) {
      this.skipWhitespace();
      result.push(this.value(item, true));
      this.skipWhitespace();
      const next = this.next();
      if (next === ']') break;
      if (next !== ',') this.fail('Expected , or ].');
    }
    this.leave();
    return result;
  }

  private string(strictUtf16: boolean): string {
    this.expect('"');
    let result = '';
    for (;;) {
      if (this.position >= this.text.length) this.fail('Unterminated string.');
      const character = this.text[this.position++];
      if (character === '"') break;
      if (character < ' ') this.fail('Control character in string.');
      if (character !== '\\') {
        result += character;
        continue;
      }
      const escape = this.next();
      if (escape === 'u') {
        const hex = this.text.slice(this.position, this.position + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('Invalid unicode escape.');
        result += String.fromCharCode(Number.parseInt(hex, 16));
        this.position += 4;
        continue;
      }
      const simple = SIMPLE_ESCAPES[escape];
      if (simple == null) this.fail('Invalid escape.');
      result += simple;
    }
    // .NET valida los pares UTF-16 al leer un string tipado; un JsonElement los conserva.
    if (strictUtf16 && LONE_SURROGATE.test(result)) this.fail('Invalid UTF-16 escape.');
    return result;
  }

  private integer(): number {
    const raw = this.numberText();
    const value = Number(raw);
    if (!INT32.test(raw) || value < -2_147_483_648 || value > 2_147_483_647)
      this.fail('Expected a 32-bit integer.');
    return value === 0 ? 0 : value;
  }

  private boolean(): boolean {
    if (this.peek() === 't') {
      this.literal('true');
      return true;
    }
    this.literal('false');
    return false;
  }

  private enumValue(values: readonly string[]): string {
    const raw = this.string(true);
    // JsonStringEnumConverter: sin distinguir mayúsculas, con espacios, valores separados por coma
    // (se combinan con OR) y como mucho una coma final.
    const parts = raw.split(',');
    if (parts.length > 1 && parts[parts.length - 1].trim() === '') parts.pop();
    let index = 0;
    for (const part of parts) {
      const name = part.trim().toLowerCase();
      const match = name === '' ? -1 : values.findIndex((value) => value.toLowerCase() === name);
      if (match < 0) this.fail(`Unknown enum value '${raw}'.`);
      index |= match;
    }
    // Una combinación sin miembro definido la acepta .NET; se conserva tal cual para que no coincida con nada.
    return values[index] ?? raw;
  }

  private numberText(): string {
    const match = /^-?[0-9][0-9.eE+-]*/.exec(this.text.slice(this.position, this.position + 512));
    const raw = match?.[0] ?? '';
    if (!NUMBER.test(raw)) this.fail('Invalid number.');
    this.position += raw.length;
    return raw;
  }

  private literal(word: string): void {
    if (!this.text.startsWith(word, this.position)) this.fail('Invalid literal.');
    this.position += word.length;
  }

  private enter(): void {
    this.depth++;
    if (this.depth > STRICT_JSON_MAX_DEPTH) this.fail('Maximum depth exceeded.');
  }

  private leave(): void {
    this.depth--;
  }

  private expect(character: string): void {
    if (this.text[this.position] !== character) this.fail(`Expected '${character}'.`);
    this.position++;
  }

  private next(): string {
    if (this.position >= this.text.length) this.fail('Unexpected end of JSON.');
    return this.text[this.position++];
  }

  private peek(): string {
    return this.text[this.position] ?? '';
  }

  private skipWhitespace(): void {
    while (/[ \t\n\r]/.test(this.text[this.position] ?? '')) this.position++;
  }

  private fail(message: string): never {
    throw new StrictJsonError(`${message} (position ${this.position})`);
  }
}

const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

const string: StrictJsonSchema = { kind: 'string' };
const int: StrictJsonSchema = { kind: 'int' };
const bool: StrictJsonSchema = { kind: 'bool' };
const any: StrictJsonSchema = ANY;
const list = (item: StrictJsonSchema): StrictJsonSchema => ({ kind: 'list', item });
const dict = (value: StrictJsonSchema): StrictJsonSchema => ({ kind: 'dict', value });
const enumOf = (...values: string[]): StrictJsonSchema => ({ kind: 'enum', values });
const object = (fields: Record<string, StrictJsonField>): StrictJsonSchema => ({
  kind: 'object',
  fields,
});
const required = (schema: StrictJsonSchema): StrictJsonField => ({ schema, required: true });
const optional = (schema: StrictJsonSchema): StrictJsonField => ({ schema });
const nullable = (schema: StrictJsonSchema): StrictJsonField => ({ schema, nullable: true });

// Orden de los enums = orden de declaración en .NET (los valores combinados por coma usan OR).
const purpose = enumOf(
  'general',
  'clientIntake',
  'questionnaire',
  'checklist',
  'informationRequest',
  'documentRequest',
  'assessment',
);
const presentation = enumOf('singlePage', 'wizard');
const collectionBasis = enumOf('serviceRequest', 'consent');
const dataClass = enumOf('general', 'financial', 'personal', 'restricted');
const actionType = enumOf(
  'notifyStaff',
  'routeToReview',
  'generateSummary',
  'createCustomer',
  'updateCustomerProfile',
  'requestSignature',
  'applyRetentionClass',
);
const actionTrigger = enumOf('onSubmit', 'onComplete', 'manual');
const mappingTransform = enumOf('none', 'trim', 'lowercase', 'uppercase', 'digitsOnly');

const conditionFields: Record<string, StrictJsonField> = {};
const condition = object(conditionFields);
Object.assign(conditionFields, {
  all: nullable(list(condition)),
  any: nullable(list(condition)),
  not: nullable(condition),
  field: nullable(string),
  rows: nullable(string),
  op: nullable(string),
  value: optional(any),
});

const inlineFields: Record<string, StrictJsonField> = {};
const inline = object(inlineFields);
Object.assign(inlineFields, {
  type: required(string),
  text: nullable(string),
  href: nullable(string),
  marks: optional(list(string)),
  color: nullable(string),
  children: optional(list(inline)),
});

const richText = object({
  type: required(string),
  blocks: required(
    list(
      object({
        type: required(string),
        level: nullable(int),
        align: nullable(string),
        font: nullable(string),
        children: optional(list(inline)),
        items: optional(list(list(inline))),
      }),
    ),
  ),
});

const style = object({
  width: nullable(string),
  align: nullable(string),
  textSize: nullable(string),
  textColor: nullable(string),
  background: nullable(string),
  spacingTop: nullable(int),
  spacingBottom: nullable(int),
});

const component = object({
  id: required(string),
  type: required(string),
  key: nullable(string),
  label: nullable(string),
  help: nullable(richText),
  required: optional(bool),
  requiredWhen: nullable(condition),
  visibleWhen: nullable(condition),
  dataClass: nullable(dataClass),
  reportable: optional(bool),
  prefill: nullable(object({ source: optional(string) })),
  style: nullable(style),
  props: optional(any),
});

const section = object({
  id: required(string),
  title: nullable(string),
  description: nullable(richText),
  visibleWhen: nullable(condition),
  repeat: nullable(
    object({
      minRows: optional(int),
      maxRows: optional(int),
      addLabel: optional(string),
      rowLabel: optional(string),
    }),
  ),
  style: nullable(style),
  components: required(list(component)),
});

const page = object({
  id: required(string),
  title: nullable(string),
  description: nullable(richText),
  visibleWhen: nullable(condition),
  style: nullable(style),
  sections: required(list(section)),
});

const mapping = object({
  componentId: required(string),
  targetKey: required(string),
  transform: optional(mappingTransform),
  optionMap: nullable(dict(string)),
  rowFields: nullable(dict(string)),
});

const action = object({
  key: required(string),
  type: required(actionType),
  trigger: required(actionTrigger),
  condition: nullable(condition),
  config: optional(any),
});

export const FORM_DEFINITION_SCHEMA: StrictJsonSchema = object({
  schemaVersion: required(int),
  title: required(string),
  description: nullable(richText),
  purpose: required(purpose),
  presentation: required(presentation),
  settings: optional(object({ showProgress: optional(bool), collectionBasis: optional(collectionBasis) })),
  pages: required(list(page)),
  mappings: optional(list(mapping)),
  actions: optional(list(action)),
});

export const FORM_ANSWERS_SCHEMA: StrictJsonSchema = object({
  schemaVersion: required(int),
  values: required(dict(any)),
});

export const FORM_MAPPINGS_SCHEMA: StrictJsonSchema = list(mapping);
export const FORM_ACTIONS_SCHEMA: StrictJsonSchema = list(action);
