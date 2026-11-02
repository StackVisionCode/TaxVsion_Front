import {
  WizardDraftSnapshot,
  clearDraftSnapshot,
  readDraftSnapshot,
  writeDraftSnapshot,
} from './wizard-draft-recovery.util';
import { defaultRules } from '../ui/signature-request-panel/signature-wizard.presenter';

function snapshot(over: Partial<WizardDraftSnapshot> = {}): WizardDraftSnapshot {
  return {
    savedAt: Date.now(),
    clients: [{ id: 'c1', displayName: 'Ana', email: 'ana@x.com', phone: '', type: 'individual', isActive: true, createdAt: '' }],
    documents: [
      { id: 'doc-a', fileId: 'file-1', name: 'Form.pdf' },
      { id: 'doc-b', fileId: 'file-2', name: 'Letter.pdf' },
    ],
    title: 'Form 1040',
    category: 'Fiscal',
    dueDate: '',
    notes: '',
    seed: { signers: [], fields: [], rules: defaultRules() },
    ...over,
  };
}

describe('wizard-draft-recovery.util', () => {
  afterEach(() => clearDraftSnapshot());

  it('roundtrip: escribe y lee el mismo snapshot', () => {
    writeDraftSnapshot(snapshot({ title: 'Restored' }));
    const read = readDraftSnapshot();
    expect(read?.title).toBe('Restored');
    expect(read?.documents.map(d => d.fileId)).toEqual(['file-1', 'file-2']);
  });

  it('lee el formato anterior (un cliente y un documento)', () => {
    const current = snapshot();
    const legacy: Record<string, unknown> = {
      ...current,
      client: current.clients[0],
      documentFileId: 'file-1',
      documentName: 'Form.pdf',
    };
    delete legacy['clients'];
    delete legacy['documents'];
    localStorage.setItem('signature.wizard.draft', JSON.stringify(legacy));

    const read = readDraftSnapshot();

    expect(read?.clients.map(c => c.id)).toEqual(['c1']);
    expect(read?.documents).toEqual([{ id: 'file-1', fileId: 'file-1', name: 'Form.pdf' }]);
  });

  it('clear elimina el snapshot', () => {
    writeDraftSnapshot(snapshot());
    clearDraftSnapshot();
    expect(readDraftSnapshot()).toBeNull();
  });

  it('descarta un snapshot caducado (>24h)', () => {
    writeDraftSnapshot(snapshot({ savedAt: Date.now() - 25 * 60 * 60 * 1000 }));
    expect(readDraftSnapshot()).toBeNull();
  });

  it('devuelve null si no hay nada guardado', () => {
    expect(readDraftSnapshot()).toBeNull();
  });
});
