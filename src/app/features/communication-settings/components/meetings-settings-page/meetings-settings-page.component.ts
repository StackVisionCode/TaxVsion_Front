import { Component, inject } from '@angular/core';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { CommunicationSettingsStore } from '../../data-access/communication-settings.store';
import { MEETING_SOUNDS_OPTIONS, MeetingSoundsPolicy } from '../../data-access/communication-settings.model';
import { CommSettingsSectionComponent } from '../../ui/settings-section/settings-section.component';
import { CommSettingRowComponent } from '../../ui/setting-row/setting-row.component';
import { CommNumberSettingComponent } from '../../ui/number-setting/number-setting.component';
import { CommInheritSwitchComponent } from '../../ui/inherit-switch/inherit-switch.component';

/**
 * F9 — Settings → Communication → Meetings: duración y cupo (≤ techo del plan), cómo se entra, invitados, chat
 * de la reunión, sonidos y reacciones, pantalla compartida y procesamiento de audio por defecto.
 */
@Component({
  selector: 'app-meetings-settings-page',
  imports: [SwitchComponent, CommSettingsSectionComponent, CommSettingRowComponent, CommNumberSettingComponent, CommInheritSwitchComponent],
  template: `
    @if (store.draft(); as d) {
      @if (store.effective(); as e) {
        <div class="flex flex-col gap-4">
          <app-comm-settings-section heading="Meetings" description="Length and size of your office's meetings.">
            <app-comm-setting-row label="Meetings" hint="Turn video meetings on or off for the whole office.">
              <app-switch [checked]="d.meetingsEnabled" (checkedChange)="store.set('meetingsEnabled', $event)" ariaLabel="Meetings"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Default length" hint="New meetings start with this length. It can't be longer than the maximum.">
              <app-comm-number-setting label="Default meeting length" [nullable]="true" unit="min" [value]="d.defaultMeetingDurationMinutes"
                [inherited]="e.meeting.defaultDurationMinutes" [min]="store.range('defaultMeetingDurationMinutes').min"
                [max]="store.range('defaultMeetingDurationMinutes', d.maxMeetingDurationMinutes ?? e.ceilings.maxMeetingDurationMinutes).max"
                limitLabel="the maximum length" data-role="default-duration"
                (valueChange)="store.set('defaultMeetingDurationMinutes', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Maximum length" hint="Meetings end when they reach this length.">
              <app-comm-number-setting label="Maximum meeting length" [nullable]="true" unit="min" [value]="d.maxMeetingDurationMinutes"
                [inherited]="e.ceilings.maxMeetingDurationMinutes" [min]="store.range('maxMeetingDurationMinutes').min"
                [max]="store.range('maxMeetingDurationMinutes', e.ceilings.maxMeetingDurationMinutes).max" limitLabel="your plan's limit"
                (valueChange)="store.set('maxMeetingDurationMinutes', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Maximum participants">
              <app-comm-number-setting label="Maximum participants" [nullable]="true" unit="people" [value]="d.maxMeetingParticipants"
                [inherited]="e.ceilings.maxParticipants" [min]="store.range('maxMeetingParticipants').min"
                [max]="store.range('maxMeetingParticipants', e.ceilings.maxParticipants).max" limitLabel="your plan's limit"
                (valueChange)="store.set('maxMeetingParticipants', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Reminder before it starts" hint="Invitees get a reminder this many minutes before. 0 turns reminders off.">
              <app-comm-number-setting label="Reminder minutes" [nullable]="true" unit="min" [value]="d.meetingReminderMinutesBefore"
                [inherited]="e.meeting.reminderMinutesBefore" [min]="store.range('meetingReminderMinutesBefore').min"
                [max]="store.range('meetingReminderMinutesBefore').max"
                (valueChange)="store.set('meetingReminderMinutesBefore', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
          </app-comm-settings-section>

          <app-comm-settings-section heading="Joining" description="How people enter a meeting. Each person can still change it before joining.">
            <app-comm-setting-row label="Camera off when joining">
              <app-switch [checked]="d.defaultCameraOff" (checkedChange)="store.set('defaultCameraOff', $event)" ariaLabel="Camera off when joining"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Microphone off when joining">
              <app-switch [checked]="d.defaultMicrophoneOff" (checkedChange)="store.set('defaultMicrophoneOff', $event)" ariaLabel="Microphone off when joining"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Guests" hint="People without an account can join with an invitation link."
              [locked]="!e.ceilings.guestsAllowed" lockedReason="Not included in your plan.">
              <app-switch [checked]="d.guestsAllowed && e.ceilings.guestsAllowed" [disabled]="!e.ceilings.guestsAllowed"
                (checkedChange)="store.set('guestsAllowed', $event)" ariaLabel="Guests"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Guests wait to be admitted" hint="The host lets each guest in.">
              <app-comm-inherit-switch label="Guests wait to be admitted" [value]="d.guestsWaitingRoom" [inherited]="e.meeting.guestsWaitingRoom"
                (valueChange)="store.set('guestsWaitingRoom', $event)"></app-comm-inherit-switch>
            </app-comm-setting-row>
          </app-comm-settings-section>

          <app-comm-settings-section heading="Meeting chat">
            <app-comm-setting-row label="Keep the chat after the meeting" hint="Participants can read the meeting chat once it ends.">
              <app-switch [checked]="d.persistChatOnEnd" (checkedChange)="store.set('persistChatOnEnd', $event)" ariaLabel="Keep the chat after the meeting"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Files per person per minute">
              <app-comm-number-setting label="Files per minute" [nullable]="true" [value]="d.meetingChatAttachmentsPerMinute"
                [inherited]="e.meeting.chatAttachmentsPerMinute" [min]="store.range('meetingChatAttachmentsPerMinute').min"
                [max]="store.range('meetingChatAttachmentsPerMinute', e.ceilings.meetingChatAttachmentsPerMinute).max" limitLabel="your plan's limit"
                (valueChange)="store.set('meetingChatAttachmentsPerMinute', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Files per meeting">
              <app-comm-number-setting label="Files per meeting" [nullable]="true" [value]="d.meetingChatAttachmentsPerMeeting"
                [inherited]="e.meeting.chatAttachmentsPerMeeting" [min]="store.range('meetingChatAttachmentsPerMeeting').min"
                [max]="store.range('meetingChatAttachmentsPerMeeting', e.ceilings.meetingChatAttachmentsPerMeeting).max" limitLabel="your plan's limit"
                (valueChange)="store.set('meetingChatAttachmentsPerMeeting', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Time to edit a message" hint="0 means meeting messages can't be edited.">
              <app-comm-number-setting label="Edit window for meeting chat" [nullable]="true" unit="min" [value]="d.chatEditWindowMinutesMeeting"
                [inherited]="e.chat.edit.windowMinutes.Meeting" [min]="store.range('chatEditWindowMinutesMeeting').min"
                [max]="store.range('chatEditWindowMinutesMeeting', e.ceilings.chatEditWindowMinutesMeeting).max" limitLabel="your plan's limit"
                (valueChange)="store.set('chatEditWindowMinutesMeeting', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
          </app-comm-settings-section>

          <app-comm-settings-section heading="Sounds and reactions">
            <app-comm-setting-row label="Join and leave sounds" hint="Each person can also mute them in their own preferences.">
              <select class="rounded-lg border border-gray-200 px-2 py-1.5 text-sm" aria-label="Join and leave sounds" data-role="sounds-policy"
                (change)="setSounds($any($event.target).value)">
                <option value="" [selected]="d.meetingSoundsPolicy === null">Default ({{ soundsLabel(e.meeting.soundsPolicy) }})</option>
                @for (option of soundsOptions; track option.value) {
                  <option [value]="option.value" [selected]="d.meetingSoundsPolicy === option.value">{{ option.label }}</option>
                }
              </select>
            </app-comm-setting-row>
            <app-comm-setting-row label="Reactions" hint="Participants can send emoji reactions during a meeting.">
              <app-comm-inherit-switch label="Reactions" [value]="d.reactionsEnabled" [inherited]="e.media.reactions.enabled"
                (valueChange)="store.set('reactionsEnabled', $event)"></app-comm-inherit-switch>
            </app-comm-setting-row>
          </app-comm-settings-section>

          <app-comm-settings-section heading="Screen sharing">
            <app-comm-setting-row label="Clients can share their screen">
              <app-comm-inherit-switch label="Clients can share their screen" [value]="d.clientsCanShareScreen" [inherited]="e.media.screenShare.clientsCanShare"
                (valueChange)="store.set('clientsCanShareScreen', $event)"></app-comm-inherit-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Share audio with the screen" hint="Sound from a shared browser tab is heard by everyone.">
              <app-comm-inherit-switch label="Share audio with the screen" [value]="d.screenAudioAllowed" [inherited]="e.media.screenShare.audioAllowed"
                (valueChange)="store.set('screenAudioAllowed', $event)"></app-comm-inherit-switch>
            </app-comm-setting-row>
          </app-comm-settings-section>

          <app-comm-settings-section heading="Audio" description="Defaults for everyone in the office. Each person can change them in their own preferences.">
            <app-comm-setting-row label="Echo cancellation">
              <app-comm-inherit-switch label="Echo cancellation" [value]="d.audioEchoCancellationDefault" [inherited]="e.media.audio.processing.echoCancellation"
                (valueChange)="store.set('audioEchoCancellationDefault', $event)"></app-comm-inherit-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Noise suppression">
              <app-comm-inherit-switch label="Noise suppression" [value]="d.audioNoiseSuppressionDefault" [inherited]="e.media.audio.processing.noiseSuppression"
                (valueChange)="store.set('audioNoiseSuppressionDefault', $event)"></app-comm-inherit-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Automatic volume" hint="Keeps your voice at a steady level.">
              <app-comm-inherit-switch label="Automatic volume" [value]="d.audioAutoGainControlDefault" [inherited]="e.media.audio.processing.autoGainControl"
                (valueChange)="store.set('audioAutoGainControlDefault', $event)"></app-comm-inherit-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Mute when echo is detected" hint="Mutes a participant's microphone if their audio is echoing.">
              <app-comm-inherit-switch label="Mute when echo is detected" [value]="d.echoMuteOnDetect" [inherited]="e.media.echo.muteOnEcho"
                (valueChange)="store.set('echoMuteOnDetect', $event)"></app-comm-inherit-switch>
            </app-comm-setting-row>
          </app-comm-settings-section>
        </div>
      }
    }
  `,
})
export class MeetingsSettingsPageComponent {
  protected readonly store = inject(CommunicationSettingsStore);
  readonly soundsOptions = MEETING_SOUNDS_OPTIONS;

  setSounds(value: string): void {
    this.store.set('meetingSoundsPolicy', value === '' ? null : (value as MeetingSoundsPolicy));
  }

  soundsLabel(policy: MeetingSoundsPolicy): string {
    return MEETING_SOUNDS_OPTIONS.find(option => option.value === policy)?.label.toLowerCase() ?? policy;
  }
}
