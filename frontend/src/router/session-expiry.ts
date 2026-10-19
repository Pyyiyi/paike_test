import type { Pinia } from 'pinia';
import type { Router } from 'vue-router';
import { onUnauthorized, resetCsrfToken } from '@/shared/api/http';
import { useSessionStore } from '@/shared/stores/session';

export function installSessionExpiryRedirect(router: Router, pinia: Pinia): void {
  onUnauthorized(() => {
    const session = useSessionStore(pinia);
    session.clear();
    session.loaded = true;
    resetCsrfToken();

    const current = router.currentRoute.value;
    if (current.name && current.name !== 'login') {
      void router.replace({
        name: 'login',
        query: {
          redirect: current.fullPath,
          reason: 'session-expired',
        },
      });
    }
  });
}
