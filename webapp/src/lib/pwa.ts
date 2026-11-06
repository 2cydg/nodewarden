import { appPath } from './base-path';

export function registerNodeWardenServiceWorker(): void {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

  const register = () => {
    void navigator.serviceWorker.register(appPath('/sw.js'), { scope: appPath('/') }).catch(() => {
      // PWA support is progressive enhancement; the vault still works without it.
    });
  };

  if (document.readyState === 'complete') {
    register();
    return;
  }

  window.addEventListener('load', register, { once: true });
}
