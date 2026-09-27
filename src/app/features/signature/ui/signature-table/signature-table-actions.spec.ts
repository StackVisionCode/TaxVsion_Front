import { TestBed } from '@angular/core/testing';
import { AccessStore } from '@core/access/access.store';
import { SignatureRequest, SignatureTableComponent } from './signature-table.component';

/**
 * B6 — las acciones de fila de Signature combinaban SOLO el estado de la solicitud. El estado dice
 * si la acción tiene sentido; el permiso, si esta persona puede hacerla. Hacen falta las dos, y
 * este spec fija justamente esa conjunción: con el estado correcto pero sin permiso, la acción no
 * se ofrece — que era el 403 de la §34.
 */
describe('SignatureTableComponent · acciones de fila', () => {
  function request(overrides: Partial<SignatureRequest> = {}): SignatureRequest {
    return {
      id: 'req-1',
      status: 'in-progress',
      signers: [{ id: 's1', status: 'pending' }],
      hasSignatureField: true,
      ...overrides,
    } as unknown as SignatureRequest;
  }

  function component(permissions: readonly string[]) {
    TestBed.resetTestingModule();
    const granted = new Set(permissions);
    TestBed.configureTestingModule({
      imports: [SignatureTableComponent],
      providers: [
        {
          provide: AccessStore,
          useValue: {
            can: (code: string) => granted.has(code),
            canAny: (codes: readonly string[]) => codes.some(c => granted.has(c)),
          },
        },
      ],
    });
    return TestBed.createComponent(SignatureTableComponent).componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('enviada y con permiso: se puede cancelar', () => {
    expect(component(['signature.request.cancel']).canCancel(request())).toBe(true);
  });

  it('enviada pero sin permiso: NO se ofrece cancelar', () => {
    expect(component([]).canCancel(request())).toBe(false);
  });

  it('con permiso pero en borrador: tampoco (un borrador se borra, no se cancela)', () => {
    expect(component(['signature.request.cancel']).canCancel(request({ status: 'draft' }))).toBe(false);
  });

  it('cancelar no habilita extender', () => {
    const soloCancelar = component(['signature.request.cancel']);

    expect(soloCancelar.canCancel(request())).toBe(true);
    expect(soloCancelar.canExtend(request())).toBe(false);
  });

  it('reenviar tiene su propio permiso', () => {
    expect(component(['signature.request.cancel']).canResend(request())).toBe(false);
    expect(component(['signature.request.resend']).canResend(request())).toBe(true);
  });

  it('editar y borrar un borrador exigen request.create', () => {
    const draft = request({ status: 'draft' });

    expect(component([]).canEditDraft(draft)).toBe(false);
    expect(component(['signature.request.create']).canEditDraft(draft)).toBe(true);
  });

  it('enviar exige el permiso además del estado y del campo de firma', () => {
    const lista = request({ status: 'ready' });

    expect(component([]).canSendRow(lista)).toBe(false);
    expect(component(['signature.request.create']).canSendRow(lista)).toBe(true);
    expect(
      component(['signature.request.create']).canSendRow(request({ status: 'ready', hasSignatureField: false })),
    ).toBe(false);
  });
});
