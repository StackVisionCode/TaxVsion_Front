import { Routes } from '@angular/router';
import { WalletPageComponent } from './components/wallet-page/wallet-page.component';

/** `WalletStore` es singleton (providedIn root) para compartirse con el pill del layout — no va per-route. */
export const WALLET_ROUTES: Routes = [{ path: '', component: WalletPageComponent, title: 'Wallet' }];
