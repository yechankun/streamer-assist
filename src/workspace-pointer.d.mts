export type PointerPoint = { x: number; y: number };
type Send = (action: string, payload: unknown) => Promise<{ ok: boolean } | undefined>;
export class WorkspacePointerDrag {
  constructor(send: Send, payload: { id: string; windowMove: boolean; point: PointerPoint; token: string }, scheduler?: { request: (callback: () => void) => number; cancel: (id: number) => void });
  move(point: PointerPoint): void;
  finish(cancel: boolean, point?: PointerPoint): Promise<unknown>;
}
