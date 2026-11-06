/** Deployment prefix, empty for root deployments. */
export function normalizeBasePath(value?: string): string {
  if (!value || value === '/') return '';
  if (!/^\/(?:[A-Za-z0-9._~-]+)(?:\/[A-Za-z0-9._~-]+)*$/.test(value) || value.split('/').some(part => part === '.' || part === '..')) {
    throw new Error('Invalid BASE_PATH: use slash-separated URL-safe path segments without a trailing slash');
  }
  return value;
}

export function stripBasePath(path: string, base: string): string | null {
  if (!base) return path;
  if (path === base) return '/';
  return path.startsWith(base + '/') ? path.slice(base.length) : null;
}

export function withBasePath(path: string, base: string): string {
  return base + path;
}
