import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { SignatureRequestPanelComponent } from './signature-request-panel.component';
import { SignatureStore } from '../../data-access/signature.store';
import { CustomerDirectoryStore } from '@core/customers/customer-directory.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { PREPARER_PARTY_ID, WizardDocument } from './signature-wizard.model';
import { defaultRules } from './signature-wizard.presenter';
import { TOKEN_EXPIRATION_DEFAULT_HOURS } from '../../data-access/signature.model';

/**
 * El panel se prueba SIN su plantilla (el editor tiene su propio spec): aquí interesan el payload
 * de envío/borrador (paridad), Escape/cerrar con confirmación y el reemplazo de documento.
 */
describe('SignatureRequestPanelComponent', () => {
  const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

  function setup() {
    TestBed.configureTestingModule({
      imports: [SignatureRequestPanelComponent],
      providers: [
        { provide: SignatureStore, useValue: { customers: signal([]), queryCustomers: vi.fn() } },
        { provide: CustomerDirectoryStore, useValue: { recent: signal([]), addRecent: vi.fn() } },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.overrideComponent(SignatureRequestPanelComponent, { set: { template: '' } });
    const fixture = TestBed.createComponent(SignatureRequestPanelComponent);
    return { c: fixture.componentInstance, fixture };
  }

  const doc: WizardDocument = {
    id: 'file-1',
    name: 'Engagement.pdf',
    kind: 'pdf',
    size: '',
    date: '',
    blob: null,
    fileId: 'file-1',
  };

  it('paridad del payload de envío/borrador: misma forma y valores para campos normalizados fijos', () => {
    const { c } = setup();
    c.selectedClient.set({
      id: '1',
      displayName: 'Ana',
      email: 'a@x.com',
      phone: '',
      type: 'individual',
      isActive: true,
      createdAt: '',
    });
    c.onDocumentSelected(doc);
    c.title.set('  Engagement 2026 ');
    c.notes.set('');
    c.signersSnapshot.set([
      {
        id: 'client:1',
        name: 'Ana',
        email: 'a@x.com',
        color: 'bg-indigo-500',
        channel: 'sms',
        phone: ' +1 555 0100 ',
        language: 'Es',
      },
    ]);
    c.normalizedFieldsSnapshot.set([
      {
        localId: 'field-0',
        documentLocalId: 'file-1',
        signerLocalId: 'client:1',
        type: 'signature',
        page: 1,
        x: 0.1635,
        y: 0.6316,
        width: 0.327,
        height: 0.0758,
      },
      {
        localId: 'field-1',
        documentLocalId: 'file-1',
        signerLocalId: 'client:1',
        type: 'text',
        page: 2,
        x: 0.9537,
        y: 0.9474,
        width: 0.0463,
        height: 0.0526,
        label: 'SSN',
      },
    ]);
    c.preparerFieldsSnapshot.set([
      {
        localId: 'prep-3',
        documentLocalId: 'file-1',
        signerLocalId: PREPARER_PARTY_ID,
        type: 'signature',
        page: 1,
        x: 0.4087,
        y: 0.3158,
        width: 0.327,
        height: 0.0758,
      },
    ]);
    c.preparerSignatureFileIdSnapshot.set('sig-file');
    c.preparerInfoSnapshot.set({
      ptinOrEfin: 'P1234567',
      displayName: 'Jane Doe',
      titleLabel: null,
    });
    c.rulesSnapshot.set({ ...defaultRules(), signingPin: '1234', sendCertificate: true });

    const draft = (c as unknown as { buildDraft(): unknown }).buildDraft();
    expect(draft).toEqual({
      title: 'Engagement 2026',
      description: null,
      category: 'Fiscal',
      documents: [
        {
          localId: 'file-1',
          backendId: null,
          originalFileId: 'file-1',
          title: 'Engagement.pdf',
          note: null,
        },
      ],
      tokenExpirationHours: TOKEN_EXPIRATION_DEFAULT_HOURS,
      requiresSequentialSigning: true,
      requiresConsent: true,
      generateCertificate: true,
      certificateGenerationMode: 'SingleForRequest',
      sendSealedDocumentToSigners: false,
      sendCertificateToSigners: true,
      sendPartialCopyOnEachSignature: false,
      partialCopyAudienceKind: 'All',
      partialCopyAudienceSignerIds: [],
      expirationEnabled: true,
      autoRemindersEnabled: true,
      reminderIntervalHours: 48,
      signingPin: '1234',
      signers: [
        {
          localId: 'client:1',
          fullName: 'Ana',
          email: 'a@x.com',
          language: 'Es',
          phone: '+1 555 0100',
          verificationMethod: expect.anything(),
        },
      ],
      fields: [
        {
          localId: 'field-0',
          documentLocalId: 'file-1',
          signerLocalId: 'client:1',
          kind: 'Signature',
          page: 1,
          x: 0.1635,
          y: 0.6316,
          width: 0.327,
          height: 0.0758,
          isRequired: true,
          label: null,
        },
        {
          localId: 'field-1',
          documentLocalId: 'file-1',
          signerLocalId: 'client:1',
          kind: 'Text',
          page: 2,
          x: 0.9537,
          y: 0.9474,
          width: 0.0463,
          height: 0.0526,
          isRequired: true,
          label: 'SSN',
        },
      ],
      preparerFields: [
        {
          localId: 'prep-3',
          documentLocalId: 'file-1',
          signerLocalId: PREPARER_PARTY_ID,
          kind: 'Signature',
          page: 1,
          x: 0.4087,
          y: 0.3158,
          width: 0.327,
          height: 0.0758,
          isRequired: true,
          label: null,
        },
      ],
      preparerSignatureFileId: 'sig-file',
      preparerInfo: { ptinOrEfin: 'P1234567', displayName: 'Jane Doe', titleLabel: null },
    });
  });

  it('generateCertificate va siempre en true (el switch de certificado ya no existe)', () => {
    const { c } = setup();
    c.selectedClient.set({
      id: '1',
      displayName: 'Ana',
      email: 'a@x.com',
      phone: '',
      type: 'individual',
      isActive: true,
      createdAt: '',
    });
    c.onDocumentSelected(doc);
    c.rulesSnapshot.set({ ...defaultRules(), certificate: false });
    const draft = (c as unknown as { buildDraft(): Record<string, unknown> }).buildDraft();
    expect(draft['generateCertificate']).toBe(true);
    c.rulesSnapshot.set(null);
    const fallback = (c as unknown as { buildDraft(): Record<string, unknown> }).buildDraft();
    expect(fallback['generateCertificate']).toBe(true);
  });

  it('las reglas editadas en Review van al mismo snapshot que usa el payload', () => {
    const { c } = setup();
    c.selectedClient.set({
      id: '1',
      displayName: 'Ana',
      email: 'a@x.com',
      phone: '',
      type: 'individual',
      isActive: true,
      createdAt: '',
    });
    c.onDocumentSelected(doc);
    c.onRulesChange({
      ...defaultRules(),
      sequential: false,
      reminderIntervalHours: 72,
      signingPin: '987654',
    });
    const draft = (c as unknown as { buildDraft(): Record<string, unknown> }).buildDraft();
    expect(draft['requiresSequentialSigning']).toBe(false);
    expect(draft['reminderIntervalHours']).toBe(72);
    expect(draft['signingPin']).toBe('987654');
  });

  it('Send: el PIN incompleto bloquea con un motivo visible', () => {
    const { c } = setup();
    c.rulesSnapshot.set({ ...defaultRules(), signingPin: '12' });
    expect(c.sendBlockers()).toContain('The Signing PIN must be 4–10 digits, or leave it empty.');
    c.send();
    expect(toast.error).toHaveBeenCalledWith(
      'Enter a 4–10 digit Signing PIN, or clear it to send.',
    );
  });

  it('Send exige firma por firmante (los campos del preparador no cuentan) y lo dice', () => {
    const { c } = setup();
    c.title.set('Engagement');
    c.signersSnapshot.set([
      {
        id: 'client:1',
        name: 'Ana',
        email: 'a@x.com',
        color: '',
        channel: 'email',
        phone: '',
        language: 'En',
      },
      {
        id: 'signer-2',
        name: 'Luis',
        email: 'l@x.com',
        color: '',
        channel: 'email',
        phone: '',
        language: 'En',
      },
    ]);
    c.fieldsSnapshot.set([
      {
        id: 'field-0',
        documentLocalId: 'file-1',
        type: 'signature',
        page: 1,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        signerId: 'client:1',
      },
      {
        id: 'prep-1',
        documentLocalId: 'file-1',
        type: 'signature',
        page: 1,
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        signerId: PREPARER_PARTY_ID,
      },
    ]);
    c.normalizedFieldsSnapshot.set([
      {
        localId: 'field-0',
        documentLocalId: 'file-1',
        signerLocalId: 'client:1',
        type: 'signature',
        page: 1,
        x: 0,
        y: 0,
        width: 0.1,
        height: 0.1,
      },
    ]);
    expect(c.canSend()).toBe(false);
    expect(c.sendBlockers()).toEqual(['Luis still needs a Signature or Initials field.']);
  });

  describe('Escape / cerrar', () => {
    function escape(target: EventTarget = document.body): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      Object.defineProperty(event, 'target', { value: target });
      return event;
    }

    it('sin trabajo: cierra directo', () => {
      const { c } = setup();
      const closed = vi.fn();
      c.closed.subscribe(closed);
      c.onEscape(escape());
      expect(closed).toHaveBeenCalled();
    });

    it('con trabajo sin guardar: pide confirmación (también Back to list / Cancel)', () => {
      const { c } = setup();
      const closed = vi.fn();
      c.closed.subscribe(closed);
      c.selectedDocument.set(doc);
      c.onEscape(escape());
      expect(closed).not.toHaveBeenCalled();
      expect(c.confirmCloseOpen()).toBe(true);
      c.confirmDiscard();
      expect(closed).toHaveBeenCalledTimes(1);
    });

    it('no cierra con el foco en un input ni con un modal abierto (p. ej. "Add signer")', () => {
      const { c } = setup();
      const closed = vi.fn();
      c.closed.subscribe(closed);
      c.onEscape(escape(document.createElement('input')));
      const modal = document.createElement('div');
      modal.setAttribute('aria-modal', 'true');
      document.body.appendChild(modal);
      c.onEscape(escape());
      modal.remove();
      expect(closed).not.toHaveBeenCalled();
      expect(c.confirmCloseOpen()).toBe(false);
    });
  });

  describe('re-elegir el documento', () => {
    it('sin campos colocados se acepta directo', () => {
      const { c } = setup();
      c.onDocumentSelected(doc);
      expect(c.editorDocument()).toBe(doc);
      expect(c.pendingDocument()).toBeNull();
      expect(c.title()).toBe('Engagement');
    });

    it('re-elegir el MISMO archivo no recarga el editor (los campos no se pierden)', () => {
      const { c } = setup();
      c.onDocumentSelected(doc);
      c.selectedDocument.set(null);
      c.onDocumentSelected({ ...doc });
      expect(c.editorDocument()).toBe(doc);
      expect(c.selectedDocument()).toBe(doc);
    });

    it('"conservar campos" solo si coinciden las páginas (o aún no se sabe)', () => {
      const { c } = setup();
      expect(c.canKeepFieldsFor({ ...doc, pageCount: null })).toBe(true);
      expect(c.canKeepFieldsFor({ ...doc, pageCount: 0 })).toBe(true); // sin editor: 0 páginas actuales
      expect(c.canKeepFieldsFor({ ...doc, pageCount: 3 })).toBe(false);
    });

    it('cancelar el reemplazo vuelve a seleccionar el documento que tiene los campos', () => {
      const { c } = setup();
      c.onDocumentSelected(doc);
      c.onDocumentCleared();
      c.pendingDocument.set({ ...doc, id: 'file-2', fileId: 'file-2' });
      c.cancelDocumentSwap();
      expect(c.selectedDocument()).toBeNull(); // sin editor no hay campos: el clear sí se propagó
      c.selectedDocument.set(null);
      c.editorDocument.set(doc);
      c.pendingDocument.set({ ...doc, id: 'file-2', fileId: 'file-2' });
      c.cancelDocumentSwap();
      expect(c.selectedDocument()).toBe(doc);
    });
  });
});

describe('multi-document field coverage', () => {
  it('blocks Review until every document has a signature or initials field', () => {
    TestBed.configureTestingModule({
      imports: [SignatureRequestPanelComponent],
      providers: [
        { provide: SignatureStore, useValue: { customers: signal([]), queryCustomers: vi.fn() } },
        { provide: CustomerDirectoryStore, useValue: { recent: signal([]), addRecent: vi.fn() } },
        { provide: ToastService, useValue: { success: vi.fn(), error: vi.fn(), info: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(SignatureRequestPanelComponent, { set: { template: '' } });
    const c = TestBed.createComponent(SignatureRequestPanelComponent).componentInstance;
    const first: WizardDocument = {
      id: 'file-1',
      name: 'Federal.pdf',
      kind: 'pdf',
      size: '',
      date: '',
      blob: null,
      fileId: 'file-1',
    };
    const second = { ...first, id: 'file-2', fileId: 'file-2', name: 'State.pdf' };
    c.selectedDocuments.set([first, second]);
    c.currentStep.set(3);
    c.signersSnapshot.set([
      {
        id: 'client:1',
        name: 'Ana',
        email: 'a@x.com',
        color: '',
        channel: 'email',
        phone: '',
        language: 'En',
      },
    ]);
    c.fieldsSnapshot.set([
      {
        id: 'field-1',
        documentLocalId: 'file-1',
        type: 'signature',
        page: 1,
        x: 10,
        y: 10,
        width: 100,
        height: 40,
        signerId: 'client:1',
      },
    ]);

    expect(c.documentsMissingSigningField().map((document) => document.name)).toEqual([
      'State.pdf',
    ]);
    expect(c.stepHint()).toContain('State.pdf');

    c.fieldsSnapshot.update((fields) => [
      ...fields,
      { ...fields[0], id: 'field-2', documentLocalId: 'file-2', type: 'initials' },
    ]);
    expect(c.documentsMissingSigningField()).toEqual([]);
  });
});
