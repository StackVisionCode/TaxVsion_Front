import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { HttpErrorResponse } from '@angular/common/http';
import { CustomerAccessRuleView, SetDenyRuleRequest } from './customer-document-access.model';
import { CustomerDocumentAccessService } from './customer-document-access.service';
import { CustomerDocumentAccessStore } from './customer-document-access.store';

const CUSTOMER = 'customer-1';

function rule(partial: Partial<CustomerAccessRuleView> = {}): CustomerAccessRuleView {
  return {
    id: partial.id ?? 'rule-1',
    customerId: partial.customerId ?? CUSTOMER,
    resourceType: partial.resourceType ?? 'File',
    resourceId: partial.resourceId ?? 'file-1',
    capability: partial.capability ?? 'Download',
    setByUserId: 'user-admin',
    setAtUtc: '2026-10-14T00:00:00Z',
    reason: partial.reason ?? null,
  };
}

describe('CustomerDocumentAccessStore', () => {
  let service: {
    list: ReturnType<typeof vi.fn>;
    setDeny: ReturnType<typeof vi.fn>;
    clearDeny: ReturnType<typeof vi.fn>;
  };
  let store: CustomerDocumentAccessStore;

  beforeEach(() => {
    service = {
      list: vi.fn(() => of([rule({ id: 'r1' })])),
      setDeny: vi.fn((_: string, req: SetDenyRuleRequest) =>
        of(
          rule({
            id: 'r-new',
            resourceId: req.resourceId,
            capability: req.capability,
            reason: req.reason ?? null,
          }),
        ),
      ),
      clearDeny: vi.fn(() => of(undefined)),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: CustomerDocumentAccessService, useValue: service }],
    });
    store = TestBed.inject(CustomerDocumentAccessStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('load llena el map; segundo load del mismo cliente no re-llama HTTP', async () => {
    await store.load(CUSTOMER);
    expect(store.rulesFor(CUSTOMER)).toHaveLength(1);
    expect(service.list).toHaveBeenCalledTimes(1);

    await store.load(CUSTOMER);
    expect(service.list).toHaveBeenCalledTimes(1);
  });

  it('load(force=true) sí re-llama HTTP', async () => {
    await store.load(CUSTOMER);
    await store.load(CUSTOMER, true);
    expect(service.list).toHaveBeenCalledTimes(2);
  });

  it('setDeny añade (upsert) la regla en el map', async () => {
    await store.load(CUSTOMER);
    await store.setDeny(CUSTOMER, {
      resourceType: 'File',
      resourceId: 'file-9',
      capability: 'ShareExternal',
    });
    const rules = store.rulesFor(CUSTOMER);
    expect(rules).toHaveLength(2);
    expect(rules.some((r) => r.resourceId === 'file-9' && r.capability === 'ShareExternal')).toBe(
      true,
    );
  });

  it('setDeny reemplaza una regla existente con la misma clave (upsert)', async () => {
    await store.load(CUSTOMER);
    await store.setDeny(CUSTOMER, {
      resourceType: 'File',
      resourceId: 'file-1',
      capability: 'Download',
      reason: 'Updated',
    });
    const rules = store.rulesFor(CUSTOMER);
    expect(rules).toHaveLength(1);
    expect(rules[0].reason).toBe('Updated');
  });

  it('clearDeny quita la regla del map', async () => {
    await store.load(CUSTOMER);
    await store.clearDeny(CUSTOMER, 'File', 'file-1', 'Download');
    expect(store.rulesFor(CUSTOMER)).toHaveLength(0);
  });

  it('error del backend → signal error poblado, map no mutado', async () => {
    service.list.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Boom' })),
    );
    await expect(store.load('customer-2')).rejects.toBeTruthy();
    expect(store.error()).toBeTruthy();
    expect(store.rulesFor('customer-2')).toEqual([]);
  });

  describe('applyPreset', () => {
    const TENANT = 'tenant-1';

    function tenantRule(
      capability: 'Download' | 'Upload' | 'Delete' | 'Visible' | 'Preview' | 'ShareExternal',
    ): CustomerAccessRuleView {
      return {
        id: `rule-ts-${capability}`,
        customerId: CUSTOMER,
        resourceType: 'TenantScope',
        resourceId: TENANT,
        capability,
        setByUserId: 'user-admin',
        setAtUtc: '2026-10-14T00:00:00Z',
        reason: null,
      };
    }

    it('from ReadOnly to ViewUpload → 1 clear(Upload) + 1 set(Download)', async () => {
      service.list.mockReturnValueOnce(of([tenantRule('Upload')]));
      await store.load(CUSTOMER);

      await store.applyPreset(CUSTOMER, 'ViewUpload', TENANT);

      expect(service.clearDeny).toHaveBeenCalledTimes(1);
      expect(service.clearDeny).toHaveBeenCalledWith(CUSTOMER, 'TenantScope', TENANT, 'Upload');
      expect(service.setDeny).toHaveBeenCalledTimes(1);
      expect(service.setDeny).toHaveBeenCalledWith(CUSTOMER, {
        resourceType: 'TenantScope',
        resourceId: TENANT,
        capability: 'Download',
        reason: null,
      });
    });

    it('from Full to PreviewOnly → 2 sets (Download, Upload), no clears', async () => {
      service.list.mockReturnValueOnce(of([]));
      await store.load(CUSTOMER);

      await store.applyPreset(CUSTOMER, 'PreviewOnly', TENANT);

      expect(service.clearDeny).not.toHaveBeenCalled();
      expect(service.setDeny).toHaveBeenCalledTimes(2);
    });

    it('from ReadOnly to Full → 1 clear(Upload), no sets', async () => {
      service.list.mockReturnValueOnce(of([tenantRule('Upload')]));
      await store.load(CUSTOMER);

      await store.applyPreset(CUSTOMER, 'Full', TENANT);

      expect(service.clearDeny).toHaveBeenCalledTimes(1);
      expect(service.setDeny).not.toHaveBeenCalled();
    });

    it('same preset twice → no-op (diff vacío)', async () => {
      service.list.mockReturnValueOnce(of([tenantRule('Download')]));
      await store.load(CUSTOMER);

      await store.applyPreset(CUSTOMER, 'ViewUpload', TENANT);

      expect(service.clearDeny).not.toHaveBeenCalled();
      expect(service.setDeny).not.toHaveBeenCalled();
    });
  });
});
