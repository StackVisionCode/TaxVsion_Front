import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { BuilderPaletteComponent } from './builder-palette.component';

describe('BuilderPaletteComponent', () => {
  it('adds a component with an accessible command', async () => {
    await TestBed.configureTestingModule({ imports: [BuilderPaletteComponent] }).compileComponents();
    const fixture = TestBed.createComponent(BuilderPaletteComponent);
    const emitted = vi.fn();
    fixture.componentInstance.componentAdded.subscribe(emitted);
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('[aria-label="Add Short text"]') as HTMLButtonElement;
    button.click();
    expect(emitted).toHaveBeenCalledWith('text');
  });

  it('disables blocked types and moves the drag ghost to the body', async () => {
    await TestBed.configureTestingModule({ imports: [BuilderPaletteComponent] }).compileComponents();
    const fixture = TestBed.createComponent(BuilderPaletteComponent);
    fixture.componentInstance.disabledTypes = ['signatureStep'];
    fixture.componentInstance.disabledReason = 'Needs Configure actions';
    const emitted = vi.fn();
    fixture.componentInstance.componentAdded.subscribe(emitted);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const signature = [...root.querySelectorAll<HTMLButtonElement>('button')].find((item) =>
      item.getAttribute('aria-label')?.toLowerCase().includes('signature'),
    )!;
    expect(signature.disabled).toBe(true);
    expect(signature.title).toBe('Needs Configure actions');
    fixture.componentInstance.add('signatureStep');
    expect(emitted).not.toHaveBeenCalled();
    expect(document.body.querySelector(':scope > [aria-hidden="true"].fixed')).not.toBeNull();
    fixture.destroy();
  });
});
