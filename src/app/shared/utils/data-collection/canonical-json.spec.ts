import { describe, expect, it } from 'vitest';
import { canonicalJson, sha256 } from './canonical-json';

describe('canonical JSON', () => {
  it('sorts object keys while preserving array order', () => {
    expect(canonicalJson({ z: 1, a: [{ y: 2, x: 1 }] })).toBe('{"a":[{"x":1,"y":2}],"z":1}');
  });

  it('matches the SHA-256 reference vector', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
