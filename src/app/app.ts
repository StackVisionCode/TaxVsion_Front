import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SessionRevokedModalComponent } from '@core/auth/session-revoked-modal.component';
import { SessionTakeoverModalComponent } from '@core/auth/session-takeover-modal.component';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SessionRevokedModalComponent, SessionTakeoverModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('TaxVsion_Front');
}
