import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

/**
 * Every feature is lazily loaded. The board is what people come for; the settings and
 * administration screens should not be in the bundle that renders it.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'requests' },
  {
    path: 'requests',
    title: 'Feedback — FeedbackHub',
    loadComponent: () =>
      import('./features/feedback/list/feedback-list.component').then(
        (m) => m.FeedbackListComponent,
      ),
  },
  {
    path: 'requests/new',
    title: 'New request — FeedbackHub',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/feedback/create/create-request.component').then(
        (m) => m.CreateRequestComponent,
      ),
  },
  {
    path: 'requests/:id',
    title: 'Request — FeedbackHub',
    loadComponent: () =>
      import('./features/feedback/detail/request-detail.component').then(
        (m) => m.RequestDetailComponent,
      ),
  },
  { path: '**', redirectTo: 'requests' },
];
