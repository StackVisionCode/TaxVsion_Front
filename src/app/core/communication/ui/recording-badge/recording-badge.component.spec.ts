import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { RecordingBadgeComponent } from './recording-badge.component';

describe('RecordingBadgeComponent (F7)', () => {
  function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(RecordingBadgeComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('Recording: REC con transcurrido y, con tope, el restante', () => {
    const el = render({ state: 'Recording', elapsed: '1:23', remaining: '4:37' });
    expect(el.querySelector('[data-role="rec-badge"]')?.textContent).toContain('REC 1:23');
    expect(el.querySelector('[data-role="rec-remaining"]')?.textContent).toContain('4:37 left');
  });

  it('sin tope no muestra restante', () => {
    const el = render({ state: 'Recording', elapsed: '0:05', remaining: null });
    expect(el.querySelector('[data-role="rec-remaining"]')).toBeNull();
  });

  it('Composing / Processing muestran "Processing recording…"; Idle nada', () => {
    expect(render({ state: 'Composing' }).querySelector('[data-role="rec-processing"]')?.textContent).toContain('Processing recording');
    expect(render({ state: 'Processing' }).querySelector('[data-role="rec-processing"]')).not.toBeNull();
    const idle = render({ state: 'Idle' });
    expect(idle.querySelector('[data-role="rec-badge"]')).toBeNull();
    expect(idle.querySelector('[data-role="rec-processing"]')).toBeNull();
  });
});
