import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { AccessStore } from '@core/access/access.store';
import { ToastService } from '@shared/ui/toast/toast.service';
import { FormLibraryService } from '../../data-access/form-library.service';
import { FormLibraryStore } from '../../data-access/form-library.store';
import { FormTemplatesService } from '../../data-access/form-templates.service';
import { ClientFormsLibraryComponent } from './client-forms-library.component';

describe('ClientFormsLibraryComponent', () => {
  const actorType = signal<string | null>('TenantEmployee');
  const navigate = vi.fn(async () => true);
  const clone = vi.fn();
  const toast = { error: vi.fn() };
  const libraryItem = {
    key: 'business-intake',
    name: 'Business Intake',
    description: null,
    purpose: 'clientIntake',
    latestVersionNumber: 1,
  } as const;

  function make(): ClientFormsLibraryComponent {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FormLibraryStore,
          useValue: { load: vi.fn(), clone, items: signal([]), loading: signal(false), error: signal('') },
        },
        {
          provide: FormLibraryService,
          useValue: { list: vi.fn(() => of([])), preview: vi.fn(), clone: vi.fn(), exportTemplate: vi.fn() },
        },
        { provide: FormTemplatesService, useValue: { list: vi.fn(() => of({ items: [] })), get: vi.fn() } },
        { provide: Router, useValue: { navigate } },
        { provide: AccessStore, useValue: { can: () => true, actorType: () => actorType() } },
        { provide: ToastService, useValue: toast },
      ],
    });
    return TestBed.runInInjectionContext(() => new ClientFormsLibraryComponent());
  }

  beforeEach(() => {
    actorType.set('TenantEmployee');
    navigate.mockClear();
    clone.mockReset();
    toast.error.mockReset();
  });

  it('formats purpose labels for the cards', () => {
    expect(make().purposeLabel('clientIntake')).toBe('Client Intake');
  });

  it('clones a library template and opens the clone builder with the screen still covered', async () => {
    vi.useFakeTimers();
    clone.mockResolvedValue('clone-1');
    const component = make();

    const run = component.use(libraryItem);
    await vi.runAllTimersAsync();
    await run;

    expect(clone).toHaveBeenCalledWith('business-intake');
    expect(navigate).toHaveBeenCalledWith(['/client-forms/templates', 'clone-1']);
    // exit="hold": el overlay queda en "done" hasta que la ruta nueva lo reemplaza.
    expect(component.launch()).toBe('done');
    vi.useRealTimers();
  });

  it('tells the user when the copy fails and stays on the library', async () => {
    clone.mockResolvedValue(null);
    const component = make();

    await component.use(libraryItem);

    expect(navigate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(component.launch()).toBe('idle');
  });

  it('hides the platform management surface from a non-platform actor', () => {
    actorType.set('TenantAdmin');
    expect(make().isPlatformAdmin()).toBe(false);
  });

  it('exposes the platform management surface to a platform admin', () => {
    actorType.set('PlatformAdmin');
    expect(make().isPlatformAdmin()).toBe(true);
  });
});
