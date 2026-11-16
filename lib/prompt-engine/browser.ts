import { restoreWorkspace, type Workspace } from './workspace.ts';

const database = 'frame-prompt-v1';
async function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(database, 2);
    req.onupgradeneeded = () => { for (const name of ['workspace', 'handoffs']) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('이 브라우저에서 저장 공간을 열지 못했어요.'));
  });
}
export async function loadWorkspace(): Promise<Workspace | null> {
  const db = await openDatabase();
  try {
    const raw = await new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction('workspace'); const req = tx.objectStore('workspace').get('current');
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
    return raw ? restoreWorkspace(raw) : null;
  } finally { db.close(); }
}
export async function saveWorkspace(workspace: Workspace) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('workspace', 'readwrite'); tx.objectStore('workspace').put(workspace, 'current');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export async function prepareImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG, WebP 사진을 선택해주세요. HEIC는 JPG로 변환해주세요.');
  if (file.size > 15 * 1024 * 1024) throw new Error('한 장당 15MB 이하의 사진을 선택해주세요.');
  const url = URL.createObjectURL(file);
  try {
    const img = new Image(); img.src = url; await img.decode();
    const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('사진을 읽을 수 없어요.');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/jpeg', .86);
    if (data.length > 900_000) data = canvas.toDataURL('image/jpeg', .65);
    if (data.length > 900_000) throw new Error('사진 용량이 커요. 크기를 줄여 다시 선택해주세요.');
    return data;
  } finally { URL.revokeObjectURL(url); }
}
export function download(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function saveHandoff(packet: import('./handoff.ts').CaptureHandoff) {
  const db = await openDatabase();
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('handoffs', 'readwrite'); tx.objectStore('handoffs').put(packet, packet.id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function loadHandoff(id: string) {
  const { handoffSchema } = await import('./handoff.ts');
  const db = await openDatabase();
  try { const raw = await new Promise<unknown>((resolve, reject) => {
    const req = db.transaction('handoffs').objectStore('handoffs').get(id);
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  }); if (!raw) throw new Error('촬영 사진을 찾지 못했어요. 촬영 화면에서 다시 연결해주세요.'); return handoffSchema.parse(raw);
  } finally { db.close(); }
}
// Originals remain in IndexedDB and exports. Only the model request is compressed.
export async function prepareModelBrief<T extends { images: import('./schema.ts').ProductImage[] }>(brief: T): Promise<T> {
  const budget = Math.floor(3_000_000 / brief.images.length);
  const images = await Promise.all(brief.images.map(async image => {
    if (image.data.length <= budget) return image;
    const img = new Image(); img.src = image.data; await img.decode();
    for (const max of [1200, 960, 720, 540]) {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(img.width * scale)); canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('분석용 사진을 준비하지 못했어요.');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [.82, .65, .48]) { const data = canvas.toDataURL('image/jpeg', quality); if (data.length <= budget) return { ...image, data }; }
    }
    throw new Error('분석할 사진 용량이 커요. 불필요한 사진을 제외하고 다시 시도해주세요.');
  }));
  return { ...brief, images };
}
