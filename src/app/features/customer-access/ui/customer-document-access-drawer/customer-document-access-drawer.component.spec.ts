import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { vi } from 'vitest';
import {
  CustomerAccessDrawerItem,
  CustomerDocumentAccessDrawerComponent,
} from './customer-document-access-drawer.component';
import { CustomerDocumentAccessStore } from '../../data-access/customer-document-access.store';
import { CustomerDocumentAccessService } from '../../data-access/customer-document-access.service';
import { CustomerDocumentAccessPermissions } from '../../data-access/customer-document-access.permissions';
import { CustomerAccessRuleView } from '../../data-access/customer-document-access.model';

const CUSTOMER = 'customer-1';

function rule(overrides: Partial<CustomerAccessRuleView> = {}): CustomerAccessRuleView {
  return {
    id: overrides.id ?? 'r1',
    customerId: CUSTOMER,
    resourceType: overrides.resourceType ?? 'File',
    resourceId: overrides.resourceId ?? 'file-1',
    capability: overrides.capability ?? 'Download',
    setByUserId: 'u1',
    setAtUtc: '2026-10-14T00:00:00Z',
    reason: overrides.reason ?? null,
  };
}

describe('CustomerDocumentAccessDrawerComponent', () => {
  let service: {
    list: ReturnType<typeof vi.fn>;
    setDeny: ReturnType<typeof vi.fn>;
    clearDeny: ReturnType<typeof vi.fn>;
  };
  let canManageSignal: ReturnType<typeof signal<boolean>>;

  function setup(initial: CustomerAccessRuleView[] = [], canManage = true) {
    service = {
      list: vi.fn(() => of(initial)),
      setDeny: vi.fn((_: string, req) =>
        of(rule({ id: 'r-new', resourceId: req.resourceId, capability: req.capability, reason: req.reason ?? null })),
      ),
      clearDeny: vi.fn(() => of(undefined)),
    };
    canManageSignal = signal(canManage);
    TestBed.configureTestingModule({
      imports: [CustomerDocumentAccessDrawerComponent],
      providers: [
        { provide: CustomerDocumentAccessService, useValue: service },
        {
          provide: CustomerDocumentAccessPermissions,
          useValue: { canManage: canManageSignal.asReadonly() },
        },
      ],
    });
    const fixture = TestBed.createComponent(CustomerDocumentAccessDrawerComponent);
    const component = fixture.componentInstance;
    const store = TestBed.inject(CustomerDocumentAccessStore);
    return { fixture, component, store };
  }

  afterEach(() => TestBed.resetTestingModule());

  function openItemMode(
    fixture: ReturnType<typeof TestBed.createComponent<CustomerDocumentAccessDrawerComponent>>,
    item: CustomerAccessDrawerItem = { resourceType: 'File', resourceId: 'file-7', name: 'return.pdf' },
  ): void {
    fixture.componentRef.setInput('customerId', CUSTOMER);
    fixture.componentRef.setInput('mode', 'item');
    fixture.componentRef.setInput('item', item);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  }

  function openCustomerMode(
    fixture: ReturnType<typeof TestBed.createComponent<CustomerDocumentAccessDrawerComponent>>,
  ): void {
    fixture.componentRef.setInput('customerId', CUSTOMER);
    fixture.componentRef.setInput('mode', 'customer');
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
  }

  it('sin permiso para gestionar, no carga reglas al abrir', () => {
    const { fixture } = setup([], false);
    openCustomerMode(fixture);
    expect(service.list).not.toHaveBeenCalled();
  });

  it('modo customer: al abrir carga las reglas y las agrupa por recurso', async () => {
    const { fixture, component } = setup([
      rule({ id: 'r1', resourceId: 'file-A', capability: 'Download' }),
      rule({ id: 'r2', resourceId: 'file-A', capability: 'Preview' }),
      rule({ id: 'r3', resourceId: 'file-B', capability: 'Delete' }),
    ]);
    openCustomerMode(fixture);
    await Promise.resolve();

    expect(service.list).toHaveBeenCalledWith(CUSTOMER);
    const groups = component.groupedRules();
    expect(groups).toHaveLength(2);
    const fileA = groups.find(g => g.resourceId === 'file-A');
    expect(fileA?.rules).toHaveLength(2);
  });

  it('modo item: hidrata los toggles desde el store (deny → OFF)', async () => {
    const { fixture, component } = setup([
      rule({ resourceType: 'File', resourceId: 'file-7', capability: 'Download', reason: 'Pending' }),
    ]);
    openItemMode(fixture);
    await Promise.resolve();
    await Promise.resolve();

    expect(component.toggles().Download).toBe(false);
    expect(component.toggles().Preview).toBe(true);
    expect(component.reason()).toBe('Pending');
  });

  it('save sin cambios no llama al servidor', async () => {
    const { fixture, component } = setup([
      rule({ resourceType: 'File', resourceId: 'file-7', capability: 'Download' }),
    ]);
    openItemMode(fixture);
    await Promise.resolve();
    await Promise.resolve();

    await component.save();
    expect(service.setDeny).not.toHaveBeenCalled();
    expect(service.clearDeny).not.toHaveBeenCalled();
  });

  it('save genera POST para los allow→deny y DELETE para los deny→allow', async () => {
    const { fixture, component } = setup([
      rule({ resourceType: 'File', resourceId: 'file-7', capability: 'Download' }),
    ]);
    openItemMode(fixture);
    await Promise.resolve();
    await Promise.resolve();

    component.setToggle('Download', true);
    component.setToggle('Preview', false);

    await component.save();

    expect(service.clearDeny).toHaveBeenCalledTimes(1);
    expect(service.clearDeny).toHaveBeenCalledWith(CUSTOMER, 'File', 'file-7', 'Download');
    expect(service.setDeny).toHaveBeenCalledTimes(1);
    expect(service.setDeny.mock.calls[0][1]).toMatchObject({
      resourceType: 'File',
      resourceId: 'file-7',
      capability: 'Preview',
    });
  });

  it('confirmHide marca Visible como denegado; cancelHide no', () => {
    const { fixture, component } = setup([]);
    openItemMode(fixture);

    component.requestHideToggle(false);
    expect(component.pendingHide()).toBe(true);
    expect(component.toggles().Visible).toBe(true);

    component.cancelHide();
    expect(component.pendingHide()).toBe(false);
    expect(component.toggles().Visible).toBe(true);

    component.requestHideToggle(false);
    component.confirmHide();
    expect(component.toggles().Visible).toBe(false);
    expect(component.pendingHide()).toBe(false);
  });

  it('reasonTooLong es true cuando pasa 500 chars', () => {
    const { fixture, component } = setup([]);
    openItemMode(fixture);

    component.reason.set('x'.repeat(500));
    expect(component.reasonTooLong()).toBe(false);
    component.reason.set('x'.repeat(501));
    expect(component.reasonTooLong()).toBe(true);
  });

  it('isSystemFolder true cuando el folder arranca con "sys." y pinta el aviso', async () => {
    const { fixture, component } = setup([]);
    openItemMode(fixture, {
      resourceType: 'Folder',
      resourceId: 'folder-sys',
      name: 'sys.signed-documents',
    });
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.isSystemFolder()).toBe(true);
    // El drawer se portala a document.body, así que buscamos en el body.
    const badge = document.body.querySelector('[data-testid="system-folder-badge"]');
    expect(badge).not.toBeNull();
  });

  it('isSystemFolder false para folders de usuario (no pinta el aviso)', async () => {
    const { fixture, component } = setup([]);
    openItemMode(fixture, {
      resourceType: 'Folder',
      resourceId: 'folder-user',
      name: 'Tax Year 2025',
    });
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.isSystemFolder()).toBe(false);
    const badge = document.body.querySelector('[data-testid="system-folder-badge"]');
    expect(badge).toBeNull();
  });

  it('isSystemFolder false para files aunque el nombre arranque con "sys."', async () => {
    const { fixture, component } = setup([]);
    openItemMode(fixture, {
      resourceType: 'File',
      resourceId: 'file-sys',
      name: 'sys.whatever.pdf',
    });
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(component.isSystemFolder()).toBe(false);
    const badge = document.body.querySelector('[data-testid="system-folder-badge"]');
    expect(badge).toBeNull();
  });
});
