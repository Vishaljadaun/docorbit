import { classifyMediaLink } from './mediaLinks';

/**
 * Android commonly sends links inside the shared text instead of the URL field.
 * Only accept the supported public-post URLs already recognized by DocOrbit.
 */
export function sharedMediaLink(search: string): string {
  const params = new URLSearchParams(search);
  const candidates = ['shared_url', 'shared_text', 'shared_title']
    .map(key => params.get(key) || '')
    .filter(value => value.length > 0 && value.length <= 8192);

  for (const candidate of candidates) {
    const direct = candidate.trim();
    if (classifyMediaLink(direct)) return direct;

    const matches = candidate.match(/https:\/\/[^\s<>"'\[\]{}]+/gi) || [];
    for (const match of matches) {
      // A caption may end in punctuation, which is not part of the shared URL.
      const link = match.replace(/[),.;!?]+$/, '');
      if (classifyMediaLink(link)) return link;
    }
  }
  return '';
}

export function isSharedMediaLaunch(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get('source') === 'share' ||
    params.has('shared_url') || params.has('shared_text') || params.has('shared_title');
}
