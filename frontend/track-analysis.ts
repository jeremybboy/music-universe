export type Channel = 'mix' | 'drums' | 'bass' | 'other' | 'vocals';
export type TrackStatus = {
  connected: boolean; source?: string; id?: string; running: boolean; percent: number; stage: string;
  available: Channel[]; channel: Channel; playing: boolean; position: number; duration: number;
  reportReady?: boolean; error?: string;
};

type NativeHandler = { postMessage: (request: Record<string, unknown>) => Promise<unknown> };
const handler = (window as Window & { webkit?: { messageHandlers?: { trackAnalysis?: NativeHandler } } })
  .webkit?.messageHandlers?.trackAnalysis;

export const hasLocalAnalyst = Boolean(handler && window.location.protocol === 'file:');

export async function analysisAction<T = TrackStatus>(action: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!hasLocalAnalyst || !handler) throw new Error('Track analysis runs in the standalone Mac app.');
  return await handler.postMessage({ ...args, action }) as T;
}

export const stopTrackAudio = () => hasLocalAnalyst ? analysisAction('pause').catch(() => {}) : Promise.resolve();
