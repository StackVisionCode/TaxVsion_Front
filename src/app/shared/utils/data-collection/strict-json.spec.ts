import { describe, expect, it } from 'vitest';
import { FormEngine } from './form-engine';

// Resultados medidos contra FormEngine.ParseDefinition/ParseAnswers de .NET (StrictJson).
const component = '{"id":"fd_abcdefgh","type":"text","label":"Name"}';
function definition({ root = '', field = '', section = '' } = {}): string {
  return `{"schemaVersion":1,"title":"T","purpose":"clientIntake","presentation":"wizard"${root},"pages":[{"id":"pg_abcdefgh","sections":[{"id":"sc_abcdefgh"${section},"components":[${component.slice(0, -1)}${field}}]}]}]}`;
}
const nested = (depth: number) => '['.repeat(depth) + ']'.repeat(depth);

describe('FormEngine strict parse (StrictJson parity)', () => {
  const engine = new FormEngine();

  it.each([
    ['a valid definition', definition()],
    ['enum names without case or with spaces', definition().replace('"clientIntake"', '" CLIENTINTAKE"')],
    ['comma combined enum values', definition().replace('"wizard"', '"wizard,singlePage"')],
    ['one trailing comma in an enum', definition().replace('"wizard"', '"wizard, "')],
    ['negative zero integers', definition().replace('"schemaVersion":1', '"schemaVersion":-0')],
    ['null on nullable members', definition({ root: ',"description":null', field: ',"dataClass":null' })],
    ['null inside JsonElement props', definition({ field: ',"props":null' })],
    ['lone surrogate kept inside JsonElement props', definition({ field: ',"props":{"a":"\\ud800"}' })],
    ['null elements in lists', definition({ root: ',"mappings":[null]' })],
    ['32 levels of nesting', definition({ field: `,"props":{"a":${nested(24)}}` })],
    ['escaped property names', definition().replace('"title"', '"\\u0074itle"')],
  ])('accepts %s', (_name, json) => {
    expect(engine.parseDefinition(json).isSuccess).toBe(true);
  });

  it.each([
    ['unmapped root members', definition({ root: ',"unknown":true' })],
    ['members with another casing', definition({ root: ',"Title":"x"' })],
    ['duplicate properties', definition({ root: ',"title":"Again"' })],
    ['duplicate properties inside props', definition({ field: ',"props":{"a":1,"a":2}' })],
    ['more than 32 levels of nesting', definition({ field: `,"props":{"a":${nested(25)}}` })],
    ['unmapped members in a condition', definition({ field: ',"visibleWhen":{"op":"equals","x":1}' })],
    ['unmapped members in a style', definition({ field: ',"style":{"bogus":1}' })],
    ['null on non-nullable members', definition({ root: ',"settings":null' })],
    ['null on required strings', definition().replace('"title":"T"', '"title":null')],
    ['null booleans', definition({ field: ',"required":null' })],
    ['integers with a fraction', definition({ field: ',"style":{"spacingTop":2.0}' })],
    ['integers out of Int32 range', definition().replace('"schemaVersion":1', '"schemaVersion":2147483648')],
    ['numbers as strings', definition().replace('"schemaVersion":1', '"schemaVersion":"1"')],
    ['numeric enum values', definition().replace('"clientIntake"', '1')],
    ['unknown enum names', definition().replace('"clientIntake"', '"client_intake"')],
    ['two trailing commas in an enum', definition().replace('"wizard"', '"wizard,,"')],
    ['missing required members', definition().replace('"title":"T",', '')],
    ['lone surrogates in typed strings', definition().replace('"T"', '"a\\udc00"')],
    ['a byte order mark', '﻿' + definition()],
    ['non JSON whitespace', definition() + ' '],
    ['trailing commas', definition().replace('}]}]}]}', '}],}]}]}')],
    ['a non-object root', '[]'],
  ])('rejects %s', (_name, json) => {
    const result = engine.parseDefinition(json);
    expect(result.isSuccess).toBe(false);
    if (!result.isSuccess) expect(result.error.code).toBe('definition.invalid_json');
  });

  it('normalizes enum names to the camelCase contract', () => {
    const result = engine.parseDefinition(definition().replace('"wizard"', '"WIZARD"'));
    expect(result.isSuccess && result.value.presentation).toBe('wizard');
  });

  it.each([
    ['{"schemaVersion":1,"values":{}}', true],
    ['{"schemaVersion":1,"values":{"a":null}}', true],
    [`{"schemaVersion":1,"values":{"a":${nested(30)}}}`, true],
    [`{"schemaVersion":1,"values":{"a":${nested(31)}}}`, false],
    ['{"schemaVersion":1,"values":{},"x":1}', false],
    ['{"schemaVersion":1,"values":null}', false],
    ['{"schemaVersion":1,"values":{"a":1,"a":2}}', false],
    ['{"schemaVersion":1,"values":{"a":{"b":1,"b":2}}}', false],
    ['{"schemaVersion":1,"values":{"\\ud800":1}}', false],
    ['{"schemaVersion":1}', false],
  ])('parses answers %s → %s', (json, valid) => {
    expect(engine.parseAnswers(json).isSuccess).toBe(valid);
  });
});
