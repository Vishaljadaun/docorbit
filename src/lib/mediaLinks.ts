/** Supported public social-video post links.
 * Validation is repeated on the media backend: frontend checks are not security controls.
 */
export type MediaPlatform = 'YouTube' | 'Instagram' | 'X' | 'Threads';

export function classifyMediaLink(input: string): MediaPlatform | null {
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const host = u.hostname.toLowerCase().replace(/\.$/, '');
    const path = u.pathname;
    if (['youtube.com','www.youtube.com','m.youtube.com'].includes(host)) {
      if (path === '/watch' && /^[\w-]{11}$/.test(u.searchParams.get('v') || '')) return 'YouTube';
      if (/^\/(?:shorts|live)\/[\w-]{11}\/?$/.test(path)) return 'YouTube';
    }
    if (host === 'youtu.be' && /^\/[\w-]{11}\/?$/.test(path)) return 'YouTube';
    if (['instagram.com','www.instagram.com'].includes(host) && /^\/(?:reel|p|tv)\/[\w-]{5,30}\/?$/.test(path)) return 'Instagram';
    if (['x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com'].includes(host) && /^\/(?:[a-zA-Z0-9_]{1,15}|i)\/status\/\d{5,22}\/?$/.test(path)) return 'X';
    if (['threads.com','www.threads.com','threads.net','www.threads.net'].includes(host) && (/^\/@[^/]+\/post\/[\w-]{5,40}\/?$/.test(path) || /^\/t\/[\w-]{5,40}\/?$/.test(path))) return 'Threads';
  } catch {
    return null;
  }
  return null;
}

/** Configured only after a separate media-processing service is deployed. */
export function configuredMediaApi(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    return url.origin;
  } catch {
    return null;
  }
}


/** Show resolution caps only when a source offers an equally high or higher stream. */
export function availableDownloadQualities(resolutions: readonly number[]): ('best'|'1080'|'720'|'480')[] {
  const max = Math.max(0,...resolutions.filter(value => Number.isFinite(value) && value > 0));
  return ['best', ...([1080,720,480] as const).filter(value => max >= value).map(String)] as ('best'|'1080'|'720'|'480')[];
}
