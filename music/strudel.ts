export type StrudelSource = { isBundledAfterimage: boolean; world: string };

export function hasStrudelRendition(source: StrudelSource) {
  return source.isBundledAfterimage && source.world === 'intimate';
}

export const strudelOrigin = 'https://strudel.cc/';
