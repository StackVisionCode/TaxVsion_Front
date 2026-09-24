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
    client: { id: 'c1', displayName: 'Ana', email: 'ana@x.com', phone: '', type: 'individual', isActive: true, createdAt: '' },
    documentFileId: 'file-1',
    documentName: 'Form.pdf',
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
    expect(read?.documentFileId).toBe('file-1');
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
