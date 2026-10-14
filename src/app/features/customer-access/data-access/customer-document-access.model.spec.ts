import {
  AccessCapability,
  CustomerAccessRuleView,
  detectPreset,
} from './customer-document-access.model';

function tenantRule(capability: AccessCapability): CustomerAccessRuleView {
  return {
    id: `rule-${capability}`,
    customerId: 'customer-1',
    resourceType: 'TenantScope',
    resourceId: 'tenant-1',
    capability,
    setByUserId: 'user-admin',
    setAtUtc: '2026-10-14T00:00:00Z',
    reason: null,
  };
}

describe('detectPreset', () => {
  it('empty tenant-scope set → Full', () => {
    expect(detectPreset([])).toBe('Full');
  });

  it('only Download denied → ViewUpload', () => {
    expect(detectPreset([tenantRule('Download')])).toBe('ViewUpload');
  });

  it('only Upload denied → ReadOnly', () => {
    expect(detectPreset([tenantRule('Upload')])).toBe('ReadOnly');
  });

  it('Download + Upload denied → PreviewOnly', () => {
    expect(detectPreset([tenantRule('Download'), tenantRule('Upload')])).toBe('PreviewOnly');
  });

  it('Delete denied (outside the preset table) → Custom', () => {
    expect(detectPreset([tenantRule('Delete')])).toBe('Custom');
  });

  it('Download + Delete → Custom (combination not in table)', () => {
    expect(detectPreset([tenantRule('Download'), tenantRule('Delete')])).toBe('Custom');
  });

  it('ignores non-TenantScope rules — per-item never shifts the preset', () => {
    const perItem: CustomerAccessRuleView = {
      id: 'r-item',
      customerId: 'customer-1',
      resourceType: 'File',
      resourceId: 'file-1',
      capability: 'Download',
      setByUserId: 'u',
      setAtUtc: '2026-10-14T00:00:00Z',
      reason: null,
    };
    expect(detectPreset([perItem])).toBe('Full');
  });
});
