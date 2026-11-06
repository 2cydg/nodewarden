/** Read the trusted prefix set by the Worker at ingress. */
export function publicBasePath(request: Request): string {
  return request.headers.get('X-NodeWarden-Base-Path') || '';
}
