import type { VideoSession } from "./schema";
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("frame-whole-video", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("sessions");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
type StoredSession = Omit<VideoSession, "clips"> & {
  clips: (Omit<VideoSession["clips"][number], "blob"> & {
    blob?: Blob;
    bytes?: ArrayBuffer;
    mime?: string;
  })[];
};
// WebKit private/ephemeral stores can reject Blob serialization even with ample quota.
// Store the exact bytes as ArrayBuffer; do not transcode or discard the original.
const bytesCache = new WeakMap<Blob, Promise<ArrayBuffer>>();
function originalBytes(blob: Blob) {
  let bytes = bytesCache.get(blob);
  if (!bytes) {
    bytes = blob.arrayBuffer();
    bytesCache.set(blob, bytes);
  }
  return bytes;
}
export async function saveVideoSession(session: VideoSession) {
  const data: StoredSession = {
    ...session,
    clips: await Promise.all(
      session.clips.map(async ({ blob, ...clip }) => ({
        ...clip,
        bytes: await originalBytes(blob),
        mime: blob.type,
      })),
    ),
  };
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("sessions", "readwrite");
      const request = t.objectStore("sessions").put(data, "current");
      const fail = () => {
        const e = request.error || t.error;
        reject(
          new Error(
            e?.name === "QuotaExceededError"
              ? "기기 저장 공간이 부족해요. 원본 영상을 먼저 저장해주세요."
              : `이 브라우저에서 관찰 기록을 저장하지 못했어요 (${e?.name || "저장 오류"}). 원본 영상을 먼저 저장해주세요.`,
          ),
        );
      };
      t.oncomplete = () => resolve();
      t.onerror = fail;
      t.onabort = fail;
    });
  } finally {
    db.close();
  }
}
export async function loadVideoSession(): Promise<VideoSession | null> {
  const db = await open();
  try {
    const data = await new Promise<StoredSession | null>((resolve, reject) => {
      const r = db
        .transaction("sessions")
        .objectStore("sessions")
        .get("current");
      r.onsuccess = () => resolve(r.result?.version === 1 ? r.result : null);
      r.onerror = () => reject(r.error);
    });
    if (!data) return null;
    return {
      ...data,
      clips: data.clips.map(({ bytes, mime, blob, ...clip }) => {
        if (blob) return { ...clip, blob };
        if (!bytes) throw new Error("보관된 원본 영상이 없어요.");
        const source = new Blob([bytes], { type: mime || "video/mp4" });
        bytesCache.set(source, Promise.resolve(bytes));
        return { ...clip, blob: source };
      }),
    };
  } finally {
    db.close();
  }
}
