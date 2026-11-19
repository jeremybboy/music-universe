export const beatsPerBar = 4;

export type ClockAnchor = { time: number; beat: number; secondsPerBeat: number };

export function beatAt(anchor: ClockAnchor, time: number): number {
  return anchor.beat + Math.max(0, time - anchor.time) / anchor.secondsPerBeat;
}

export function nextBoundaryBar(beat: number, nextUnscheduledBar: number): number {
  const nextPair = (Math.floor(beat / (beatsPerBar * 2)) + 1) * 2;
  return Math.max(nextPair, Math.ceil(nextUnscheduledBar / 2) * 2);
}
