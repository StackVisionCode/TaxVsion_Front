import { actorTypeLabel, roleLabel } from './actor-labels';

describe('actor-labels', () => {
  it('traduce los tipos de actor sin la palabra "Tenant"', () => {
    expect(actorTypeLabel('TenantAdmin')).toBe('Admin');
    expect(actorTypeLabel('TenantEmployee')).toBe('Employee');
    expect(actorTypeLabel('CustomerPortal')).toBe('Client');
    expect(actorTypeLabel('PlatformAdmin')).toBe('Platform admin');
  });

  it('un actor nuevo se humaniza sin "Tenant" y sin valor cae al respaldo', () => {
    expect(actorTypeLabel('TenantAccountant')).toBe('Accountant');
    expect(actorTypeLabel('ServiceAgent')).toBe('Service agent');
    expect(actorTypeLabel(null)).toBe('Member');
    expect(actorTypeLabel('', '—')).toBe('—');
  });

  it('traduce los roles de sistema y deja igual los de la oficina', () => {
    expect(roleLabel('Tenant Admin')).toBe('Admin');
    expect(roleLabel('tenant admin')).toBe('Admin');
    expect(roleLabel('Customer Portal')).toBe('Client');
    expect(roleLabel('Employee')).toBe('Employee');
    expect(roleLabel('Bookkeeper')).toBe('Bookkeeper');
    // Así viene en la sesión.
    expect(roleLabel('TenantAdmin')).toBe('Admin');
    expect(roleLabel('CustomerPortal')).toBe('Client');
    expect(roleLabel(null)).toBe('');
  });
});
