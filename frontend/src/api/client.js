import axios from 'axios';

export const isLocal = typeof window !== 'undefined'
  && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__));

let _invokeFn = null;
async function invoke(cmd, args) {
  if (!_invokeFn) {
    const mod = await import('@tauri-apps/api/core');
    _invokeFn = mod.invoke;
  }
  return _invokeFn(cmd, args);
}

function asUint8Array(payload) {
  if (payload instanceof Uint8Array) return payload;
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload);
  if (Array.isArray(payload)) return new Uint8Array(payload);
  return new Uint8Array(payload);
}

function bytesToBlobUrl(bytes, mime = 'image/png') {
  const blob = new Blob([asUint8Array(bytes)], { type: mime });
  const src = URL.createObjectURL(blob);
  return { src, revoke: () => URL.revokeObjectURL(src) };
}

async function fileToBytes(file) {
  const buf = await file.arrayBuffer();
  return Array.from(new Uint8Array(buf));
}

const webClient = {
  async uploadImage(file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await axios.post('/api/image/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data;
  },

  async uploadBackground(file) {
    const fd = new FormData();
    fd.append('file', file);
    const r = await axios.post('/api/background/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return r.data;
  },

  async sliceImage(imageId, params) {
    const r = await axios.post(`/api/image/${imageId}/slice`, params);
    return r.data;
  },

  async batchCellOp(imageId, cellIds, operation) {
    const r = await axios.post(`/api/image/${imageId}/batch/op`, { cellIds, operation });
    return r.data;
  },

  async batchUndo(imageId, cellIds) {
    const r = await axios.post(`/api/image/${imageId}/batch/undo`, { cellIds });
    return r.data;
  },

  async bgCells(imageId) {
    const r = await axios.get(`/api/image/${imageId}/bg-cells`);
    return r.data;
  },

  async exportAtlas(imageId) {
    const r = await axios.get(`/api/image/${imageId}/export`, { responseType: 'blob' });
    return r.data;
  },

  imagePreviewSrc(imageId) {
    return { src: `/api/image/${imageId}/preview`, revoke: null };
  },

  cellPreviewSrc(imageId, cellId, refreshKey) {
    return { src: `/api/image/${imageId}/cell/${cellId}/preview?t=${refreshKey}`, revoke: null };
  },

  bgPreviewSrc(bgId) {
    return { src: `/api/background/${bgId}/preview`, revoke: null };
  },
};

const localClient = {
  async uploadImage(file) {
    const bytes = await fileToBytes(file);
    const r = await invoke('image_load_bytes', { bytes });
    // Mirror webClient.uploadImage shape; use a blob URL for preview from the file we already have.
    return {
      imageId: r.imageId,
      width: r.width,
      height: r.height,
      previewUrl: URL.createObjectURL(file),
    };
  },

  async uploadBackground(file) {
    const bytes = await fileToBytes(file);
    const r = await invoke('background_upload_bytes', { bytes });
    return {
      bgId: r.bgId,
      width: r.width,
      height: r.height,
      previewUrl: URL.createObjectURL(file),
    };
  },

  async sliceImage(imageId, { rows, cols, cellWidth, cellHeight }) {
    return invoke('image_slice', { imageId, rows, cols, cellWidth, cellHeight });
  },

  async batchCellOp(imageId, cellIds, operation) {
    await invoke('batch_cell_op', { imageId, cellIds, operation });
    return { ok: true };
  },

  async batchUndo(imageId, cellIds) {
    await invoke('batch_cell_undo', { imageId, cellIds });
    return { ok: true };
  },

  async bgCells(imageId) {
    const cellIds = await invoke('image_bg_cells', { imageId });
    return { cellIds };
  },

  async exportAtlas(imageId) {
    const bytes = await invoke('atlas_export', { imageId });
    return new Blob([asUint8Array(bytes)], { type: 'image/png' });
  },

  imagePreviewSrc(imageId) {
    // No refresh on the original image — content never changes after upload.
    return new Promise(async (resolve) => {
      const bytes = await invoke('image_preview', { imageId });
      resolve(bytesToBlobUrl(bytes));
    });
  },

  cellPreviewSrc(imageId, cellId, _refreshKey) {
    return new Promise(async (resolve) => {
      const bytes = await invoke('cell_preview', { imageId, cellId });
      resolve(bytesToBlobUrl(bytes));
    });
  },

  bgPreviewSrc(bgId) {
    return new Promise(async (resolve) => {
      const bytes = await invoke('background_preview', { bgId });
      resolve(bytesToBlobUrl(bytes));
    });
  },
};

const client = isLocal ? localClient : webClient;
export default client;
