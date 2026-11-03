import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommunicationSettingsStore } from '../../data-access/communication-settings.store';
import { RecordingSettingsPageComponent } from './recording-settings-page.component';

/** Lo mínimo que lee la página de grabación. */
function fakeStore(managedByTenant: boolean) {
  const ceilings = new Proxy({}, { get: (_target, key) => (typeof key === 'string' && key.endsWith('Allowed') ? true : 120) });
  return {
    draft: signal({
      recordingConsentPolicy: 'NoRejections',
      maxRecordingMinutesMeeting: null,
      maxRecordingMinutesAudioCall: null,
      maxRecordingMinutesVideoCall: null,
      recordingVisibleInPortal: true,
      transcriptLanguage: null,
      voiceNoteTranscriptEnabled: null,
      transcriptPrompt: null,
      purgeEnabled: null,
      messageRetentionDays: null,
      recordingRetentionDays: null,
    }),
    effective: signal({
      ceilings,
      recording: { maxMinutesMeeting: 60, maxMinutesAudioCall: 60, maxMinutesVideoCall: 60, transcriptLanguage: 'auto', voiceNote: { enabled: true } },
      retention: {
        messageDays: 365,
        recordingDays: 90,
        purgeEnabled: false,
        managedByTenant,
        platformDefault: { messageDays: 365, recordingDays: 90, purgeEnabled: false },
      },
    }),
    overview: signal({ transcriptPromptMaxLength: 500 }),
    range: vi.fn((key: string) => (key === 'recordingRetentionDays' ? { min: 1, max: 3650 } : { min: 1, max: 120 })),
    set: vi.fn(),
  };
}

function render(store: ReturnType<typeof fakeStore>) {
  TestBed.configureTestingModule({
    imports: [RecordingSettingsPageComponent],
    providers: [{ provide: CommunicationSettingsStore, useValue: store }],
  });
  const fixture = TestBed.createComponent(RecordingSettingsPageComponent);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('RecordingSettingsPageComponent — retención (D-72)', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('sin la capacidad: días y limpieza solo se muestran', () => {
    const el = render(fakeStore(false));
    expect(el.querySelector('[data-role="retention-recordings"]')?.textContent?.trim()).toBe('90 days');
    expect(el.querySelector('[data-role="retention-cleanup"]')?.textContent?.trim()).toBe(
      'Off — managed by your platform administrator',
    );
    expect(el.querySelector('input[aria-label="Recordings are kept for"]')).toBeNull();
  });

  it('con la capacidad: los días de grabación y la limpieza se editan', () => {
    const store = fakeStore(true);
    const el = render(store);
    expect(el.querySelector('[data-role="retention-recordings"]')).toBeNull();
    expect(el.querySelector('[aria-label="Automatic cleanup"]')).not.toBeNull();

    // null = default de la plataforma: desmarcar "Use default" fija el valor heredado.
    const useDefault = Array.from(el.querySelectorAll<HTMLInputElement>('[data-role="use-default"]')).find(input =>
      input.closest('label')?.textContent?.includes('90 days'),
    );
    expect(useDefault?.checked).toBe(true);
    useDefault!.checked = false;
    useDefault!.dispatchEvent(new Event('change'));
    expect(store.set).toHaveBeenCalledWith('recordingRetentionDays', 90);
  });
});
