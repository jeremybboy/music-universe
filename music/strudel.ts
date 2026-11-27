export type StrudelSource = { isBundledAfterimage: boolean; world: string };

export function hasStrudelRendition(source: StrudelSource) {
  return source.isBundledAfterimage && source.world === 'intimate';
}

export const strudelOrigin = 'https://strudel.cc/';

export function strudelURL(source: string) {
  const bytes = new TextEncoder().encode(source);
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  return strudelOrigin + '#' + encodeURIComponent(btoa(binary));
}
