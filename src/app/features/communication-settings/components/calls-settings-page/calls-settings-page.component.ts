import { Component, inject } from '@angular/core';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { CommunicationSettingsStore } from '../../data-access/communication-settings.store';
import { CommSettingsSectionComponent } from '../../ui/settings-section/settings-section.component';
import { CommSettingRowComponent } from '../../ui/setting-row/setting-row.component';
import { CommNumberSettingComponent } from '../../ui/number-setting/number-setting.component';

/** F9 — Settings → Communication → Calls: audio y video, tiempo de timbre y los límites del plan (solo lectura). */
@Component({
  selector: 'app-calls-settings-page',
  imports: [SwitchComponent, CommSettingsSectionComponent, CommSettingRowComponent, CommNumberSettingComponent],
  template: `
    @if (store.draft(); as d) {
      @if (store.effective(); as e) {
        <div class="flex flex-col gap-4">
          <app-comm-settings-section heading="Calls" description="Audio and video calls between your team and clients.">
            <app-comm-setting-row label="Audio calls" [locked]="!e.ceilings.callsAllowed" lockedReason="Not included in your plan.">
              <app-switch [checked]="d.callsEnabled && e.ceilings.callsAllowed" [disabled]="!e.ceilings.callsAllowed"
                (checkedChange)="store.set('callsEnabled', $event)" ariaLabel="Audio calls"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Video calls" [locked]="!e.ceilings.callsAllowed" lockedReason="Not included in your plan.">
              <app-switch [checked]="d.videoCallsEnabled && e.ceilings.callsAllowed" [disabled]="!e.ceilings.callsAllowed"
                (checkedChange)="store.set('videoCallsEnabled', $event)" ariaLabel="Video calls"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Ring for" hint="An unanswered call stops ringing after this long.">
              <app-comm-number-setting label="Ringing time" [nullable]="true" unit="sec" [value]="d.ringingTimeoutSeconds"
                [inherited]="e.calls.ringingTimeoutSeconds" [min]="store.range('ringingTimeoutSeconds').min"
                [max]="store.range('ringingTimeoutSeconds').max"
                (valueChange)="store.set('ringingTimeoutSeconds', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
          </app-comm-settings-section>

          <app-comm-settings-section heading="Plan limits" description="Set by your plan. Contact us to change them.">
            <app-comm-setting-row label="Longest call">
              <span class="text-sm font-semibold text-gray-700" data-role="plan-limit">{{ minutes(e.calls.maxCallMinutes) }}</span>
            </app-comm-setting-row>
            <app-comm-setting-row label="Calls at the same time">
              <span class="text-sm font-semibold text-gray-700" data-role="plan-limit">{{ e.calls.maxConcurrentCalls ?? 'No limit' }}</span>
            </app-comm-setting-row>
            <app-comm-setting-row label="Call minutes per month">
              <span class="text-sm font-semibold text-gray-700" data-role="plan-limit">{{ minutes(e.calls.maxMonthlyMinutes) }}</span>
            </app-comm-setting-row>
          </app-comm-settings-section>

          <p class="px-1 text-xs text-gray-500">Whether a client can call from the portal is set on each client's profile.</p>
        </div>
      }
    }
  `,
})
export class CallsSettingsPageComponent {
  protected readonly store = inject(CommunicationSettingsStore);

  minutes(value: number | null): string {
    return value === null ? 'No limit' : `${value} min`;
  }
}
