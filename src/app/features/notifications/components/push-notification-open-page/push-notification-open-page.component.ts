import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NotificationRouteResolver } from '../../data-access/notification-route-resolver.service';

@Component({
  selector: 'app-push-notification-open-page',
  template: '<p class="p-6 text-sm text-gray-500">Opening notification...</p>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PushNotificationOpenPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly resolver = inject(NotificationRouteResolver);

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const resourceType = params.get('rt');
    const resourceId = params.get('rid');
    if (!resourceType || !resourceId) {
      void this.router.navigate(['/notifications']);
      return;
    }
    const customerId = params.get('cid');
    const target = this.resolver.resolveResource(
      resourceType,
      resourceId,
      customerId ? { customerId } : {},
    );
    void this.router.navigate([...target.commands], { queryParams: target.queryParams, replaceUrl: true });
  }
}
