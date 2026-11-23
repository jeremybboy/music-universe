export const worlds = ['intimate', 'rnb', 'club'] as const;
export const moods = ['relaxed', 'intimate', 'groovy', 'energetic'] as const;
export const instruments = ['drums', 'bass', 'keys', 'lead', 'pad'] as const;

export type World = typeof worlds[number];
export type Mood = typeof moods[number];
export type Instrument = typeof instruments[number];

export const instrumentLabels = { drums: 'Drums', bass: 'Bass', keys: 'Keys', lead: 'Lead', pad: 'Pad / FX' };
