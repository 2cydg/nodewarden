export const basePath = (typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="nodewarden-base-path"]')?.content) || '';
export const appPath = (path: string): string => basePath + path;

export function installBasePathFetch(): void {
  if (!basePath) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === 'string' && /^\/(?:api|identity|notifications|icons|config|setup)(?:\/|\?|$)/.test(input)) {
      input = appPath(input);
    }
    return originalFetch(input, init);
  };
}
