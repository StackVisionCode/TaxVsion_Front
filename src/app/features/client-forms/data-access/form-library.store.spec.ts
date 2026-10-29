import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { FormLibraryService } from './form-library.service';
import { FormLibraryStore } from './form-library.store';

describe('FormLibraryStore', () => {
  const service = {
    list: vi.fn(),
    clone: vi.fn(),
    recordReview: vi.fn(),
    setListing: vi.fn(),
  };

  function store(): FormLibraryStore {
    TestBed.configureTestingModule({
      providers: [FormLibraryStore, { provide: FormLibraryService, useValue: service }],
    });
    return TestBed.inject(FormLibraryStore);
  }

  beforeEach(() => {
    service.list.mockReset();
    service.clone.mockReset();
    service.recordReview.mockReset();
    service.setListing.mockReset();
  });

  it('loads the library into items', async () => {
    service.list.mockReturnValue(
      of([{ key: 'individual-tax-intake', name: 'Individual Tax Intake', description: null, purpose: 'clientIntake', latestVersionNumber: 1 }]),
    );
    const sut = store();
    await sut.load();
    expect(sut.items()).toHaveLength(1);
    expect(sut.error()).toBe('');
  });

  it('surfaces a load error', async () => {
    service.list.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const sut = store();
    await sut.load();
    expect(sut.error()).toContain('could not be loaded');
  });

  it('returns the clone id', async () => {
    service.clone.mockReturnValue(of({ id: 'clone-1' }));
    const sut = store();
    expect(await sut.clone('business-intake')).toBe('clone-1');
  });

  it('reloads after listing a template', async () => {
    service.setListing.mockReturnValue(of({ id: 'template-1', isLibraryListed: true }));
    service.list.mockReturnValue(of([]));
    const sut = store();
    const result = await sut.setListing('template-1', { libraryKey: 'individual-tax-intake', isListed: true });
    expect(result?.isLibraryListed).toBe(true);
    expect(service.list).toHaveBeenCalled();
  });

  it('surfaces a listing error', async () => {
    service.setListing.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
    const sut = store();
    const result = await sut.setListing('template-1', { libraryKey: 'x', isListed: true });
    expect(result).toBeNull();
    expect(sut.error()).toContain('could not be listed');
  });
});
