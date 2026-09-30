import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { AccessStore } from '@core/access/access.store';
import { CampaignsPermissions } from './campaigns-permissions';

function setup(permissions: string[]): CampaignsPermissions {
  TestBed.resetTestingModule();
  const granted = new Set(permissions);
  TestBed.configureTestingModule({
    providers: [{ provide: AccessStore, useValue: { can: (permission: string) => granted.has(permission) } }],
  });
  return TestBed.inject(CampaignsPermissions);
}

describe('CampaignsPermissions', () => {
  it('only campaigns.manage unlocks the write actions (it is the only permission of the service)', () => {
    expect(setup(['campaigns.manage']).canManage()).toBe(true);
    expect(setup(['campaigns.view']).canManage()).toBe(false);
  });

  it('the template picker needs notification.template.view', () => {
    expect(setup(['campaigns.manage']).canPickTemplates()).toBe(false);
    expect(setup(['campaigns.manage', 'notification.template.view']).canPickTemplates()).toBe(true);
  });
});
