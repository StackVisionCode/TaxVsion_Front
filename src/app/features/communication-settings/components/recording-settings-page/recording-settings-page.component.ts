import { CUSTOM_ELEMENTS_SCHEMA, Component, computed, inject } from '@angular/core';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { CommunicationSettingsStore } from '../../data-access/communication-settings.store';
import {
  RECORDING_CONSENT_OPTIONS,
  RecordingConsentPolicy,
  TRANSCRIPT_LANGUAGE_OPTIONS,
} from '../../data-access/communication-settings.model';
import { CommSettingsSectionComponent } from '../../ui/settings-section/settings-section.component';
import { CommSettingRowComponent } from '../../ui/setting-row/setting-row.component';
import { CommNumberSettingComponent } from '../../ui/number-setting/number-setting.component';
import { CommInheritSwitchComponent } from '../../ui/inherit-switch/inherit-switch.component';

/**
 * F9 — Settings → Communication → Recording & transcript: consentimiento, duración máxima (≤ techo del plan),
 * retención, visibilidad en el portal, idioma y vocabulario del transcript, transcripción de notas de voz.
 */
@Component({
  selector: 'app-recording-settings-page',
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  imports: [SwitchComponent, CommSettingsSectionComponent, CommSettingRowComponent, CommNumberSettingComponent, CommInheritSwitchComponent],
  template: `
    @if (store.draft(); as d) {
      @if (store.effective(); as e) {
        <div class="flex flex-col gap-4">
          @if (!e.ceilings.recordingAllowed) {
            <p class="flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-role="recording-not-in-plan">
              <ion-icon name="information-circle-outline" class="text-base"></ion-icon>
              Recording isn't included in your plan. These settings apply if you add it.
            </p>
          }

          <app-comm-settings-section heading="Recording" description="When a meeting or call is recorded.">
            <app-comm-setting-row label="Consent" [hint]="consentHint(d.recordingConsentPolicy)">
              <select class="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" aria-label="Recording consent" data-role="consent-policy"
                (change)="store.set('recordingConsentPolicy', $any($event.target).value)">
                @for (option of consentOptions; track option.value) {
                  <option [value]="option.value" [selected]="d.recordingConsentPolicy === option.value">{{ option.label }}</option>
                }
              </select>
            </app-comm-setting-row>
            <app-comm-setting-row label="Longest meeting recording">
              <app-comm-number-setting label="Longest meeting recording" [nullable]="true" unit="min" [value]="d.maxRecordingMinutesMeeting"
                [inherited]="e.recording.maxMinutesMeeting" [min]="store.range('maxRecordingMinutesMeeting').min"
                [max]="store.range('maxRecordingMinutesMeeting', e.ceilings.maxRecordingMinutesMeeting).max" limitLabel="your plan's limit"
                (valueChange)="store.set('maxRecordingMinutesMeeting', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Longest audio call recording">
              <app-comm-number-setting label="Longest audio call recording" [nullable]="true" unit="min" [value]="d.maxRecordingMinutesAudioCall"
                [inherited]="e.recording.maxMinutesAudioCall" [min]="store.range('maxRecordingMinutesAudioCall').min"
                [max]="store.range('maxRecordingMinutesAudioCall', e.ceilings.maxRecordingMinutesAudioCall).max" limitLabel="your plan's limit"
                (valueChange)="store.set('maxRecordingMinutesAudioCall', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Longest video call recording" [locked]="!e.ceilings.recordingVideoAllowed" lockedReason="Video recording isn't included in your plan.">
              <app-comm-number-setting label="Longest video call recording" [nullable]="true" unit="min" [value]="d.maxRecordingMinutesVideoCall"
                [inherited]="e.recording.maxMinutesVideoCall" [min]="store.range('maxRecordingMinutesVideoCall').min"
                [max]="store.range('maxRecordingMinutesVideoCall', e.ceilings.maxRecordingMinutesVideoCall).max" limitLabel="your plan's limit"
                [disabled]="!e.ceilings.recordingVideoAllowed"
                (valueChange)="store.set('maxRecordingMinutesVideoCall', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Keep recordings for" hint="Deleted after this long when automatic cleanup is on (Chat settings).">
              <app-comm-number-setting label="Recording retention" unit="days" [value]="d.recordingRetentionDays"
                [min]="store.range('recordingRetentionDays').min" [max]="store.range('recordingRetentionDays').max"
                (valueChange)="store.set('recordingRetentionDays', $event ?? d.recordingRetentionDays)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Clients see their recordings" hint="Recordings of a client's meetings show up in their portal.">
              <app-switch [checked]="d.recordingVisibleInPortal" (checkedChange)="store.set('recordingVisibleInPortal', $event)" ariaLabel="Clients see their recordings"></app-switch>
            </app-comm-setting-row>
          </app-comm-settings-section>

          <app-comm-settings-section heading="Transcript" description="Text versions of recordings and voice notes.">
            <app-comm-setting-row label="Language" hint="Each person can choose a different language for their own voice notes."
              [locked]="!e.ceilings.transcriptAllowed" lockedReason="Transcripts aren't included in your plan.">
              <select class="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" aria-label="Transcript language" data-role="transcript-language"
                [disabled]="!e.ceilings.transcriptAllowed" (change)="setLanguage($any($event.target).value)">
                <option value="" [selected]="d.transcriptLanguage === null">Default ({{ languageLabel(e.recording.transcriptLanguage) }})</option>
                @for (option of languageOptions(); track option.value) {
                  <option [value]="option.value" [selected]="d.transcriptLanguage === option.value">{{ option.label }}</option>
                }
              </select>
            </app-comm-setting-row>
            <app-comm-setting-row label="Transcribe voice notes" hint="Voice notes in chat can be turned into text.">
              <app-comm-inherit-switch label="Transcribe voice notes" [value]="d.voiceNoteTranscriptEnabled" [inherited]="e.recording.voiceNote.enabled"
                [disabled]="!e.ceilings.transcriptAllowed" (valueChange)="store.set('voiceNoteTranscriptEnabled', $event)"></app-comm-inherit-switch>
            </app-comm-setting-row>
            <div class="py-4">
              <label for="transcript-prompt" class="text-sm font-semibold text-gray-900">Office vocabulary</label>
              <p class="mt-0.5 text-xs text-gray-500">Names and terms the transcript should spell right, separated by commas.</p>
              <textarea id="transcript-prompt" rows="3" [attr.maxlength]="promptMax()" [value]="d.transcriptPrompt ?? ''"
                [disabled]="!e.ceilings.transcriptAllowed" (input)="setPrompt($any($event.target).value)" data-role="transcript-prompt"
                placeholder="IRS, W-2, 1099-NEC, Schedule C"
                class="mt-2 w-full resize-none rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-700 focus:border-gray-300 focus:outline-none disabled:bg-gray-50"></textarea>
              <p class="mt-1 text-right text-xs tabular-nums text-gray-400">{{ (d.transcriptPrompt ?? '').length }}/{{ promptMax() }}</p>
            </div>
          </app-comm-settings-section>
        </div>
      }
    }
  `,
})
export class RecordingSettingsPageComponent {
  protected readonly store = inject(CommunicationSettingsStore);
  readonly consentOptions = RECORDING_CONSENT_OPTIONS;
  readonly promptMax = computed(() => this.store.overview()?.transcriptPromptMaxLength ?? 0);

  /** Las opciones de siempre más el idioma guardado si no está entre ellas (p. ej. "pt"). */
  readonly languageOptions = computed(() => {
    const saved = this.store.draft()?.transcriptLanguage;
    return saved && !TRANSCRIPT_LANGUAGE_OPTIONS.some(option => option.value === saved)
      ? [...TRANSCRIPT_LANGUAGE_OPTIONS, { value: saved, label: saved }]
      : TRANSCRIPT_LANGUAGE_OPTIONS;
  });

  consentHint(policy: RecordingConsentPolicy): string {
    return RECORDING_CONSENT_OPTIONS.find(option => option.value === policy)?.hint ?? '';
  }

  languageLabel(code: string): string {
    return TRANSCRIPT_LANGUAGE_OPTIONS.find(option => option.value === code)?.label ?? code;
  }

  setLanguage(value: string): void {
    this.store.set('transcriptLanguage', value === '' ? null : value);
  }

  setPrompt(value: string): void {
    this.store.set('transcriptPrompt', value.trim() === '' ? null : value);
  }
}
