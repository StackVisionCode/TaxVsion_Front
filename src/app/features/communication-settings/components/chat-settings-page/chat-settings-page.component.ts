import { Component, inject } from '@angular/core';
import { SwitchComponent } from '@shared/ui/switch/switch.component';
import { CommunicationSettingsStore } from '../../data-access/communication-settings.store';
import { CommSettingsSectionComponent } from '../../ui/settings-section/settings-section.component';
import { CommSettingRowComponent } from '../../ui/setting-row/setting-row.component';
import { CommNumberSettingComponent } from '../../ui/number-setting/number-setting.component';

/** F9 — Settings → Communication → Chat: canales, quién chatea con quién, grupos, edición y retención. */
@Component({
  selector: 'app-chat-settings-page',
  imports: [SwitchComponent, CommSettingsSectionComponent, CommSettingRowComponent, CommNumberSettingComponent],
  template: `
    @if (store.draft(); as d) {
      @if (store.effective(); as e) {
        <div class="flex flex-col gap-4">
          <app-comm-settings-section heading="Chat" description="Who can chat and what they can share.">
            <app-comm-setting-row label="Chat" hint="Turn chat on or off for the whole office.">
              <app-switch [checked]="d.chatEnabled" (checkedChange)="store.set('chatEnabled', $event)" ariaLabel="Chat"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="File attachments" hint="Let people share files and images in chat.">
              <app-switch [checked]="d.screenshotsEnabled" (checkedChange)="store.set('screenshotsEnabled', $event)" ariaLabel="File attachments"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Chat between team members" hint="Employees can message each other, not only clients.">
              <app-switch [checked]="d.employeeToEmployeeChatEnabled" (checkedChange)="store.set('employeeToEmployeeChatEnabled', $event)" ariaLabel="Chat between team members"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Clients chat only with their preparer" hint="A client can only start or receive a chat from the preparer assigned to them.">
              <app-switch [checked]="d.restrictCustomerChatToAssignedPreparer" (checkedChange)="store.set('restrictCustomerChatToAssignedPreparer', $event)" ariaLabel="Clients chat only with their preparer"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Several clients in one group" hint="Clients in the same group can see each other's messages.">
              <app-switch [checked]="d.groupsAllowMultipleClients" (checkedChange)="store.set('groupsAllowMultipleClients', $event)" ariaLabel="Several clients in one group"></app-switch>
            </app-comm-setting-row>
            <app-comm-setting-row label="Support chat" hint="Team members can open support tickets with our team."
              [locked]="!e.ceilings.supportAllowed" lockedReason="Not included in your plan.">
              <app-switch [checked]="d.supportEnabled && e.ceilings.supportAllowed" [disabled]="!e.ceilings.supportAllowed"
                (checkedChange)="store.set('supportEnabled', $event)" ariaLabel="Support chat"></app-switch>
            </app-comm-setting-row>
          </app-comm-settings-section>

          <app-comm-settings-section heading="Editing messages" description="How long people have to fix a message after sending it. 0 means messages can't be edited.">
            <app-comm-setting-row label="Direct chats">
              <app-comm-number-setting label="Edit window for direct chats" [nullable]="true" unit="min" [value]="d.chatEditWindowMinutesDirect"
                [inherited]="e.chat.edit.windowMinutes.Direct" [min]="store.range('chatEditWindowMinutesDirect', e.ceilings.chatEditWindowMinutesDirect).min"
                [max]="store.range('chatEditWindowMinutesDirect', e.ceilings.chatEditWindowMinutesDirect).max" limitLabel="your plan's limit"
                (valueChange)="store.set('chatEditWindowMinutesDirect', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Group chats">
              <app-comm-number-setting label="Edit window for group chats" [nullable]="true" unit="min" [value]="d.chatEditWindowMinutesGroup"
                [inherited]="e.chat.edit.windowMinutes.Group" [min]="store.range('chatEditWindowMinutesGroup', e.ceilings.chatEditWindowMinutesGroup).min"
                [max]="store.range('chatEditWindowMinutesGroup', e.ceilings.chatEditWindowMinutesGroup).max" limitLabel="your plan's limit"
                (valueChange)="store.set('chatEditWindowMinutesGroup', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Support chats">
              <app-comm-number-setting label="Edit window for support chats" [nullable]="true" unit="min" [value]="d.chatEditWindowMinutesSupport"
                [inherited]="e.chat.edit.windowMinutes.Support" [min]="store.range('chatEditWindowMinutesSupport', e.ceilings.chatEditWindowMinutesSupport).min"
                [max]="store.range('chatEditWindowMinutesSupport', e.ceilings.chatEditWindowMinutesSupport).max" limitLabel="your plan's limit"
                (valueChange)="store.set('chatEditWindowMinutesSupport', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
            <app-comm-setting-row label="Edits per message" hint="How many times one message can be edited.">
              <app-comm-number-setting label="Edits per message" [nullable]="true" [value]="d.chatMaxEditsPerMessage"
                [inherited]="e.chat.edit.maxEdits" [min]="store.range('chatMaxEditsPerMessage', e.ceilings.chatMaxEditsPerMessage).min"
                [max]="store.range('chatMaxEditsPerMessage', e.ceilings.chatMaxEditsPerMessage).max" limitLabel="your plan's limit"
                (valueChange)="store.set('chatMaxEditsPerMessage', $event)"></app-comm-number-setting>
            </app-comm-setting-row>
          </app-comm-settings-section>

          <!-- La retención la fija la plataforma (obligaciones de conservación): aquí solo se muestra -->
          <app-comm-settings-section heading="Keeping messages" description="Set by the platform to meet record-keeping requirements. Contact support to change it.">
            <app-comm-setting-row label="Automatic cleanup" hint="Messages and recordings older than their retention period are deleted.">
              <p class="text-sm font-medium text-gray-900" data-role="retention-cleanup">{{ e.retention.purgeEnabled ? 'On' : 'Off' }}</p>
            </app-comm-setting-row>
            <app-comm-setting-row label="Messages are kept for">
              <p class="text-sm font-medium text-gray-900" data-role="retention-messages">{{ e.retention.messageDays + ' days' }}</p>
            </app-comm-setting-row>
          </app-comm-settings-section>
        </div>
      }
    }
  `,
})
export class ChatSettingsPageComponent {
  protected readonly store = inject(CommunicationSettingsStore);
}
