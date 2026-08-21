export const FRAMEWORKS_DIR: string;
export const SAFE_NAME: RegExp;
export function safeFilename(input: unknown): string | null;
export function fmField(fm: string, key: string): string;
export function validateDispatchedNote(raw: string): { ok: true; fm: string } | { ok: false; reason: string };
export function ensurePlanetId(raw: string, fm: string): string;
export function applyDispatchPayload(
  payload: { filename?: unknown; content?: unknown } | null | undefined,
  frameworksDir?: string,
): { status: "written" | "skipped"; filename?: string; reason?: string };
export function applyFromEventPath(
  eventPath: string | undefined,
  frameworksDir?: string,
): { status: "written" | "skipped"; filename?: string; reason?: string };
