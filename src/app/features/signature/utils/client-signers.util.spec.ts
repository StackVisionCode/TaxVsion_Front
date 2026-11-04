import { describe, expect, it } from 'vitest';
import {
  EditorSigner,
  PlacedField,
  WizardClient,
} from '../ui/signature-request-panel/signature-wizard.model';
import { clientSignerId, isClientSignerId, syncClientSigners } from './client-signers.util';

function client(id: string): WizardClient {
  return { id, displayName: `Client ${id}`, email: `${id}@x.com`, phone: '', type: 'individual', isActive: true, createdAt: '' };
}

function signer(id: string, color = 'bg-a'): EditorSigner {
  return { id, name: id, email: `${id}@x.com`, color, channel: 'email', phone: '', language: 'En' };
}

function field(id: string, signerId: string): PlacedField {
  return { id, documentLocalId: 'doc', type: 'signature', page: 1, x: 0, y: 0, width: 10, height: 10, signerId } as PlacedField;
}

const toSigner = (c: WizardClient, color: string | null): EditorSigner => ({
  ...signer(clientSignerId(c.id), color ?? 'bg-new'),
  name: c.displayName,
});

describe('client-signers.util', () => {
  it('reconoce los ids de firmante cliente', () => {
    expect(clientSignerId('42')).toBe('client:42');
    expect(isClientSignerId('client:42')).toBe(true);
    expect(isClientSignerId('signer-3')).toBe(false);
  });

  it('sin cambios devuelve las mismas listas', () => {
    const signers = [signer('client:a')];
    const fields = [field('f1', 'client:a')];
    const result = syncClientSigners(signers, fields, [client('a')], toSigner, () => 'x');

    expect(result.changed).toBe(false);
    expect(result.signers).toBe(signers);
    expect(result.fields).toBe(fields);
  });

  it('un cliente nuevo se agrega detrás del último firmante cliente, antes de los externos', () => {
    const signers = [signer('client:a'), signer('signer-1')];
    const result = syncClientSigners(signers, [], [client('a'), client('b')], toSigner, () => 'x');

    expect(result.signers.map((s) => s.id)).toEqual(['client:a', 'client:b', 'signer-1']);
  });

  it('cambiar un cliente lo reemplaza en su sitio y le pasa color y campos', () => {
    const signers = [signer('signer-1'), signer('client:a', 'bg-a')];
    const fields = [field('f1', 'client:a'), field('f2', 'signer-1')];
    let n = 0;
    const result = syncClientSigners(signers, fields, [client('b')], toSigner, () => `new-${n++}`);

    expect(result.signers.map((s) => [s.id, s.color])).toEqual([
      ['signer-1', 'bg-a'],
      ['client:b', 'bg-a'],
    ]);
    expect(result.fields.map((f) => [f.id, f.signerId])).toEqual([
      ['new-0', 'client:b'],
      ['f2', 'signer-1'],
    ]);
    expect(result.replaced).toEqual({ 'client:a': 'client:b' });
  });

  it('quitar un cliente quita su firmante y sus campos', () => {
    const signers = [signer('client:a'), signer('client:b'), signer('signer-1')];
    const fields = [field('f1', 'client:a'), field('f2', 'client:b')];
    const result = syncClientSigners(signers, fields, [client('b')], toSigner, () => 'x');

    expect(result.signers.map((s) => s.id)).toEqual(['client:b', 'signer-1']);
    expect(result.fields.map((f) => f.id)).toEqual(['f2']);
  });
});
