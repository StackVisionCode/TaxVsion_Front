import { afterEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { CompanyProfile } from '../../data-access/company-settings.model';
import { EMPTY_OFFICE_PROFILE, toCompanyProfile } from '../../data-access/office-profile.mapper';
import { AddressSectionComponent } from './address-section.component';

/** Toggle "Mailing address is the same": la postal solo aparece cuando está apagado. */
describe('AddressSectionComponent', () => {
  function setup(profile: CompanyProfile) {
    TestBed.configureTestingModule({ imports: [AddressSectionComponent] });
    const fixture = TestBed.createComponent(AddressSectionComponent);
    fixture.componentRef.setInput('profile', profile);
    const patches: Partial<CompanyProfile>[] = [];
    fixture.componentInstance.patch.subscribe(p => patches.push(p));
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, patches };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('con la postal igual a la física solo pinta una dirección', () => {
    const { el } = setup(toCompanyProfile(EMPTY_OFFICE_PROFILE));

    expect(el.querySelectorAll('app-address-fields').length).toBe(1);
    expect(el.textContent).not.toContain('Where clients and the IRS write to you');
  });

  it('el switch emite el cambio y, apagado, aparece la dirección postal', () => {
    const { fixture, el, patches } = setup(toCompanyProfile(EMPTY_OFFICE_PROFILE));

    (el.querySelector('app-switch button') as HTMLButtonElement).click();
    expect(patches.at(-1)).toEqual({ mailingSameAsPhysical: false });

    fixture.componentRef.setInput('profile', { ...toCompanyProfile(EMPTY_OFFICE_PROFILE), mailingSameAsPhysical: false });
    fixture.detectChanges();
    expect(el.querySelectorAll('app-address-fields').length).toBe(2);
    expect(el.textContent).toContain('Where clients and the IRS write to you');
  });

  it('escribir en la postal emite solo la postal', () => {
    const { el, patches } = setup({ ...toCompanyProfile(EMPTY_OFFICE_PROFILE), mailingSameAsPhysical: false });
    const mailingStreet = el.querySelectorAll('app-address-fields')[1].querySelector('input') as HTMLInputElement;

    mailingStreet.value = 'PO Box 12';
    mailingStreet.dispatchEvent(new Event('input'));

    expect(patches.at(-1)).toEqual({ mailing: expect.objectContaining({ line1: 'PO Box 12' }) });
  });
});
