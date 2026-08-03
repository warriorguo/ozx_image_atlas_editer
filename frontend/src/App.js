import React, { useState, useRef, useEffect } from 'react';
import client, { isLocal, FS_NOT_SUPPORTED } from './api/client';
import AsyncImage from './api/AsyncImage';
import './App.css';

// A press that never travels this far (in screen px) stays a click, so
// selecting a cell by clicking it keeps working alongside drag-to-move.
const DRAG_THRESHOLD_PX = 3;

/**
 * Atlas pixels per screen pixel for a rendered cell <img>.
 *
 * The scale comes from the sliced cell size, never from the image's own
 * natural size: the preview endpoint is free to serve a differently sized
 * bitmap (and the browser may hand back a cached one from an earlier slice),
 * so only `gridParams` states the true cell dimensions.
 *
 * The editor preview paints with `object-fit: contain`, so the painted
 * content can be letterboxed inside the element box — taking the larger of
 * the two axis ratios measures the painted content rather than the box.
 */
function atlasPerScreenPx(img, cellW, cellH) {
  const rect = img.getBoundingClientRect();
  if (!rect.width || !rect.height || !cellW || !cellH) return 1;
  return Math.max(cellW / rect.width, cellH / rect.height);
}

function App() {
  const [imageData, setImageData] = useState(null);
  const [gridParams, setGridParams] = useState(null);
  const [cells, setCells] = useState([]);
  const [selectedCells, setSelectedCells] = useState(new Set());
  const [activeCell, setActiveCell] = useState(null);
  const [showCenterCross, setShowCenterCross] = useState(false);
  const [moveX, setMoveX] = useState(0);
  const [moveY, setMoveY] = useState(0);
  const [scaleFactor, setScaleFactor] = useState(1.0);
  const [despillAmount, setDespillAmount] = useState(100);
  const [despillTint, setDespillTint] = useState('#ffffff');
  const [rows, setRows] = useState(8);
  const [cols, setCols] = useState(8);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [opacity, setOpacity] = useState(100);
  const [removeColor, setRemoveColor] = useState('#ffffff');
  const [colorTolerance, setColorTolerance] = useState(30);
  const [playerFps, setPlayerFps] = useState(12);
  const [playerLoop, setPlayerLoop] = useState(true);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerFrameIndex, setPlayerFrameIndex] = useState(0);
  const [playerRotation, setPlayerRotation] = useState(0);
  const [backgrounds, setBackgrounds] = useState([]);
  const [selectedBgId, setSelectedBgId] = useState(null);
  const [bgFit, setBgFit] = useState('fill');
  const [bgCellIds, setBgCellIds] = useState(new Set());
  const [currentPath, setCurrentPath] = useState(null);
  const [notice, setNotice] = useState(null);
  const [cellDrag, setCellDrag] = useState(null);
  const fileInputRef = useRef();
  const bgInputRef = useRef();
  const noticeTimerRef = useRef(null);
  // True once the current press has travelled past DRAG_THRESHOLD_PX, so the
  // click the browser fires on mouseup is swallowed instead of re-selecting.
  const draggedRef = useRef(false);
  const dragTeardownRef = useRef(null);

  const showNotice = (message, type = 'success') => {
    setNotice({ message, type });
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2500);
  };

  // Prevent default drag and drop behavior globally
  useEffect(() => {
    const preventDefaults = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleGlobalDrop = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    // Prevent browser from opening dragged files
    document.addEventListener('dragenter', preventDefaults, false);
    document.addEventListener('dragleave', preventDefaults, false);
    document.addEventListener('dragover', preventDefaults, false);
    document.addEventListener('drop', handleGlobalDrop, false);

    return () => {
      document.removeEventListener('dragenter', preventDefaults, false);
      document.removeEventListener('dragleave', preventDefaults, false);
      document.removeEventListener('dragover', preventDefaults, false);
      document.removeEventListener('drop', handleGlobalDrop, false);
    };
  }, []);

  const fileShortcutsRef = useRef({});

  // Sprite player animation loop
  useEffect(() => {
    if (!playerPlaying) return;
    const frames = [...selectedCells].sort((a, b) => a - b);
    if (frames.length === 0) {
      setPlayerPlaying(false);
      return;
    }

    const interval = setInterval(() => {
      setPlayerFrameIndex(prev => {
        const next = prev + 1;
        if (next >= frames.length) {
          if (playerLoop) return 0;
          setPlayerPlaying(false);
          return frames.length - 1;
        }
        return next;
      });
    }, 1000 / playerFps);

    return () => clearInterval(interval);
  }, [playerPlaying, playerFps, playerLoop, selectedCells]);

  const handleFileUpload = async (file) => {
    if (!file) return;
    
    // Check if it's an image file
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG, JPG, WEBP)');
      return;
    }
    
    setLoading(true);
    try {
      const data = await client.uploadImage(file);
      setImageData(data);
      setGridParams(null);
      setCells([]);
      setSelectedCells(new Set());
      setActiveCell(null);
      setBgCellIds(new Set());
      // File loaded via HTML input — no on-disk path to save back to.
      setCurrentPath(null);
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload image');
    }
    setLoading(false);
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  const handleSliceImage = async () => {
    if (!imageData) return;
    
    setLoading(true);
    try {
      const data = await client.sliceImage(imageData.imageId, { rows, cols });
      setGridParams(data);
      setCells(data.cells);
      setSelectedCells(new Set([0]));
      setActiveCell(0);
      // A re-slice invalidates every cell preview: same imageId, same cellIds,
      // different bitmaps behind them. Without a new key the URLs are
      // byte-identical and the browser serves the previous grid's cached
      // images (and AsyncImage would not even re-run its loader).
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Slice failed:', error);
      alert('Failed to slice image');
    }
    setLoading(false);
  };

  const refreshBgCells = async (imageId) => {
    try {
      const r = await client.bgCells(imageId);
      setBgCellIds(new Set(r.cellIds || []));
    } catch (error) {
      console.error('Failed to fetch bg cells:', error);
    }
  };

  // `targetCells` overrides the current selection — used by drag-to-move,
  // which captures its targets on mousedown and must not read a selection
  // that may still be mid-update.
  const handleCellOperation = async (operation, targetCells = null) => {
    const targets = [...(targetCells || selectedCells)];
    if (!imageData || targets.length === 0) return;

    try {
      await client.batchCellOp(imageData.imageId, targets, operation);
      setRefreshKey(prev => prev + 1);
      refreshBgCells(imageData.imageId);
    } catch (error) {
      console.error('Operation failed:', error);
      alert(error.response?.data?.error || error.message || 'Failed to apply operation');
    }
  };

  const handleUndo = async () => {
    if (!imageData || selectedCells.size === 0) return;

    try {
      await client.batchUndo(imageData.imageId, [...selectedCells]);
      setRefreshKey(prev => prev + 1);
      refreshBgCells(imageData.imageId);
    } catch (error) {
      console.error('Undo failed:', error);
      alert('Failed to undo operation');
    }
  };

  const handleBackgroundUpload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file');
      return;
    }
    try {
      const bg = await client.uploadBackground(file);
      setBackgrounds(prev => [...prev, bg]);
      setSelectedBgId(bg.bgId);
    } catch (error) {
      console.error('Background upload failed:', error);
      alert('Failed to upload background');
    }
  };

  const handleApplyBackground = () => {
    if (!selectedBgId) {
      alert('Pick or upload a background image first');
      return;
    }
    handleCellOperation({ type: 'set_background', bg_id: selectedBgId, fit: bgFit });
  };

  const handleExport = async () => {
    if (!imageData) return;

    try {
      const blob = await client.exportAtlas(imageData.imageId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `atlas_${imageData.imageId}.png`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      showNotice('Exported atlas');
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export atlas');
    }
  };

  // Native File → Open via Tauri dialog. In web mode this falls back to the
  // existing Upload Image button (HTML file input).
  const handleOpen = async () => {
    if (!isLocal) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const result = await client.openFromPath();
      if (result === FS_NOT_SUPPORTED || !result) return;
      setImageData({
        imageId: result.imageId,
        width: result.width,
        height: result.height,
        previewUrl: result.previewUrl,
      });
      setCurrentPath(result.path);
      setGridParams(null);
      setCells([]);
      setSelectedCells(new Set());
      setActiveCell(null);
      setBgCellIds(new Set());
    } catch (error) {
      console.error('Open failed:', error);
      alert('Failed to open file');
    }
  };

  // Native File → Save. Writes to currentPath if known, otherwise prompts.
  // In web mode this is the same as Export Atlas (browser download).
  const handleSave = async () => {
    if (!imageData) return;
    if (!isLocal) {
      await handleExport();
      return;
    }
    if (!currentPath) {
      await handleSaveAs();
      return;
    }
    try {
      await client.saveToPath(imageData.imageId, currentPath);
      showNotice(`Saved to ${currentPath}`);
    } catch (error) {
      console.error('Save failed:', error);
      alert('Failed to save file');
    }
  };

  const handleSaveAs = async () => {
    if (!imageData) return;
    if (!isLocal) {
      await handleExport();
      return;
    }
    try {
      const defaultName = currentPath
        ? currentPath.split('/').pop()
        : `atlas_${imageData.imageId}.png`;
      const path = await client.pickSavePath(defaultName);
      if (!path || path === FS_NOT_SUPPORTED) return;
      await client.saveToPath(imageData.imageId, path);
      setCurrentPath(path);
      showNotice(`Saved to ${path}`);
    } catch (error) {
      console.error('Save As failed:', error);
      alert('Failed to save file');
    }
  };

  // Bind file shortcuts in JS — recipe lesson: do NOT register Cmd+O/S/⇧S as
  // native menu key_equivalents, or the menu intercepts before the webview
  // hears the keystroke. Use a ref so the listener stays mounted once but
  // always sees the latest handler closures.
  fileShortcutsRef.current = { handleOpen, handleSave, handleSaveAs };

  // Tauri intercepts native drag-drop, so the .upload-area's HTML5 onDrop
  // never fires in the bundled app. Subscribe to the webview's drag-drop
  // event in local mode; web mode keeps using HTML5 (this no-ops).
  const loadFromDrop = async (path) => {
    setLoading(true);
    try {
      const result = await client.loadFromPath(path);
      if (result === FS_NOT_SUPPORTED || !result) return;
      setImageData({
        imageId: result.imageId,
        width: result.width,
        height: result.height,
        previewUrl: result.previewUrl,
      });
      setCurrentPath(result.path);
      setGridParams(null);
      setCells([]);
      setSelectedCells(new Set());
      setActiveCell(null);
      setBgCellIds(new Set());
    } catch (error) {
      console.error('Drop load failed:', error);
      alert('Failed to load dropped file');
    }
    setLoading(false);
  };

  const dropHandlerRef = useRef(null);
  dropHandlerRef.current = loadFromDrop;

  useEffect(() => {
    let unlisten = null;
    let cancelled = false;
    client
      .onDragDrop((payload) => {
        if (payload.type === 'over') {
          setDragOver(true);
        } else if (payload.type === 'leave') {
          setDragOver(false);
        } else if (payload.type === 'drop') {
          setDragOver(false);
          const path = payload.paths?.[0];
          if (path) dropHandlerRef.current(path);
        }
      })
      .then((fn) => {
        if (cancelled) fn?.();
        else unlisten = fn;
      });
    return () => {
      cancelled = true;
      if (typeof unlisten === 'function') unlisten();
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'o') {
        e.preventDefault();
        fileShortcutsRef.current.handleOpen();
      } else if (k === 's' && e.shiftKey) {
        e.preventDefault();
        fileShortcutsRef.current.handleSaveAs();
      } else if (k === 's') {
        e.preventDefault();
        fileShortcutsRef.current.handleSave();
      } else if (k === 'r') {
        e.preventDefault();
        window.location.reload();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /**
   * Drag the cell content to set the move offset.
   *
   * Runs off plain mouse events (not HTML5 drag-and-drop) so it cannot
   * collide with the image-import drop path, and commits a single
   * `move` operation on release — one drag is one undo step.
   */
  const beginCellDrag = (e, cellId, { selectOnGrab = false } = {}) => {
    if (e.button !== 0 || !imageData || !gridParams) return;
    const imgEl = e.currentTarget.querySelector('img');
    if (!imgEl) return;

    const { cellWidth, cellHeight } = gridParams;
    const scale = atlasPerScreenPx(imgEl, cellWidth, cellHeight);
    const startX = e.clientX;
    const startY = e.clientY;

    // Grabbing a cell outside the selection acts on that cell alone;
    // grabbing one inside it moves the whole selection together.
    const alreadySelected = selectedCells.has(cellId);
    const targets = alreadySelected ? new Set(selectedCells) : new Set([cellId]);
    // A modifier press is a multi-select gesture, so leave the selection to
    // the click handler.
    const claimSelection = selectOnGrab && !alreadySelected && !e.ctrlKey && !e.metaKey;

    // Suppress the browser's own image drag ghost / text selection.
    e.preventDefault();
    draggedRef.current = false;
    let delta = { dx: 0, dy: 0 };

    const onMove = (ev) => {
      const sdx = ev.clientX - startX;
      const sdy = ev.clientY - startY;
      if (!draggedRef.current && Math.hypot(sdx, sdy) < DRAG_THRESHOLD_PX) return;
      if (!draggedRef.current && claimSelection) {
        // Only once this is a real drag — doing it on mousedown would
        // clobber the selection that a plain or modifier click is about
        // to make.
        setSelectedCells(new Set([cellId]));
        setActiveCell(cellId);
        setPlayerFrameIndex(0);
      }
      draggedRef.current = true;
      delta = { dx: Math.round(sdx * scale), dy: Math.round(sdy * scale) };
      // Keep the numeric inputs showing the in-flight offset.
      setMoveX(delta.dx);
      setMoveY(delta.dy);
      setCellDrag({ targets, dx: delta.dx, dy: delta.dy });
    };

    const detach = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('keydown', onKey, true);
      dragTeardownRef.current = null;
    };

    const cancel = () => {
      detach();
      setCellDrag(null);
      setMoveX(0);
      setMoveY(0);
    };

    const onUp = async () => {
      detach();
      if (!draggedRef.current || (delta.dx === 0 && delta.dy === 0)) {
        // A click, or a drag returned to its origin: nothing to commit.
        setCellDrag(null);
        setMoveX(0);
        setMoveY(0);
        return;
      }
      try {
        // Hold the preview transform until the re-rendered cells arrive,
        // otherwise the content snaps back for a frame.
        await handleCellOperation({ type: 'move', dx: delta.dx, dy: delta.dy }, targets);
      } finally {
        setCellDrag(null);
        setMoveX(0);
        setMoveY(0);
      }
    };

    const onKey = (ev) => {
      // Escape aborts; draggedRef stays set so the trailing click does not
      // reshuffle the selection.
      if (ev.key === 'Escape') cancel();
    };

    dragTeardownRef.current = cancel;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('keydown', onKey, true);
  };

  // Drop any in-flight drag listeners if the component goes away mid-drag.
  useEffect(() => () => dragTeardownRef.current?.(), []);

  /**
   * Live preview offset for a cell taking part in the current drag, as a
   * percentage of its own box — so the same value is correct for the small
   * grid thumbnail and the larger editor preview alike.
   */
  const dragTransform = (cellId) => {
    if (!cellDrag || !cellDrag.targets.has(cellId) || !gridParams) return undefined;
    const x = (cellDrag.dx / gridParams.cellWidth) * 100;
    const y = (cellDrag.dy / gridParams.cellHeight) * 100;
    return { transform: `translate(${x}%, ${y}%)` };
  };

  const handleCellClick = (cellId, e) => {
    // The mouseup that ends a drag also fires a click — ignore it.
    if (draggedRef.current) return;
    if (e.ctrlKey || e.metaKey) {
      setSelectedCells(prev => {
        const next = new Set(prev);
        if (next.has(cellId)) {
          next.delete(cellId);
        } else {
          next.add(cellId);
        }
        // Jump the sprite player to the just-clicked cell within the new selection.
        const sortedFrames = [...next].sort((a, b) => a - b);
        const idx = sortedFrames.indexOf(cellId);
        if (idx >= 0) setPlayerFrameIndex(idx);
        return next;
      });
      setActiveCell(cellId);
    } else {
      setSelectedCells(new Set([cellId]));
      setActiveCell(cellId);
      setPlayerFrameIndex(0);
    }
  };

  const handleSelectAll = () => {
    setSelectedCells(new Set(cells.map(c => c.cellId)));
    if (activeCell === null && cells.length > 0) setActiveCell(cells[0].cellId);
  };

  const handleDeselectAll = () => {
    setSelectedCells(new Set());
    setActiveCell(null);
  };

  const renderGridOverlay = () => {
    if (!gridParams || !imageData) return null;
    
    const { rows, cols, cellWidth, cellHeight } = gridParams;
    const lines = [];
    
    // Vertical lines
    for (let i = 1; i < cols; i++) {
      lines.push(
        <div
          key={`v-${i}`}
          style={{
            position: 'absolute',
            left: `${(i * cellWidth / imageData.width) * 100}%`,
            top: 0,
            width: '1px',
            height: '100%',
            background: 'rgba(255, 0, 0, 0.5)'
          }}
        />
      );
    }
    
    // Horizontal lines
    for (let i = 1; i < rows; i++) {
      lines.push(
        <div
          key={`h-${i}`}
          style={{
            position: 'absolute',
            left: 0,
            top: `${(i * cellHeight / imageData.height) * 100}%`,
            width: '100%',
            height: '1px',
            background: 'rgba(255, 0, 0, 0.5)'
          }}
        />
      );
    }
    
    // Selected cells highlight
    if (selectedCells.size > 0 && cells.length > 0) {
      selectedCells.forEach(cellId => {
        const cell = cells[cellId];
        if (cell) {
          lines.push(
            <div
              key={`selected-${cellId}`}
              style={{
                position: 'absolute',
                left: `${(cell.x / imageData.width) * 100}%`,
                top: `${(cell.y / imageData.height) * 100}%`,
                width: `${(cell.w / imageData.width) * 100}%`,
                height: `${(cell.h / imageData.height) * 100}%`,
                border: '2px solid #007bff',
                boxSizing: 'border-box'
              }}
            />
          );
        }
      });
    }
    
    return lines;
  };

  const renderCellGrid = () => {
    if (!gridParams || !cells.length) return null;
    
    const { rows, cols } = gridParams;
    
    return (
      <div
        className="cell-grid"
        style={{
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gridTemplateRows: `repeat(${rows}, 1fr)`
        }}
      >
        {cells.map((cell, index) => (
          <div
            key={cell.cellId}
            className={`cell-thumbnail ${selectedCells.has(cell.cellId) ? 'selected' : ''} ${cellDrag ? 'dragging' : ''}`}
            onClick={(e) => handleCellClick(cell.cellId, e)}
            onMouseDown={(e) => beginCellDrag(e, cell.cellId, { selectOnGrab: true })}
            title="Drag to offset · click to select"
          >
            <AsyncImage
              loader={() => client.cellPreviewSrc(imageData.imageId, cell.cellId, refreshKey)}
              deps={[imageData.imageId, cell.cellId, refreshKey]}
              alt={`Cell ${cell.cellId}`}
              draggable={false}
              style={dragTransform(cell.cellId)}
            />
            {showCenterCross && <div className="center-cross" />}
            {bgCellIds.has(cell.cellId) && <div className="bg-badge" title="Has background">BG</div>}
          </div>
        ))}
      </div>
    );
  };

  const renderCellEditor = () => {
    if (!imageData || activeCell === null) return null;

    return (
      <div className="cell-editor">
        <div className="section-title">
          Cell Editor
          {selectedCells.size > 1 && <span className="batch-badge">{selectedCells.size} cells selected</span>}
        </div>
        <div
          className={`cell-preview ${cellDrag ? 'dragging' : ''}`}
          onMouseDown={(e) => beginCellDrag(e, activeCell)}
          title="Drag to offset the cell content"
        >
          <AsyncImage
            loader={() => client.cellPreviewSrc(imageData.imageId, activeCell, refreshKey)}
            deps={[imageData.imageId, activeCell, refreshKey]}
            alt={`Cell ${activeCell}`}
            draggable={false}
            style={dragTransform(activeCell)}
          />
        </div>
        <div className="opacity-control">
          <label>Opacity: {opacity}%</label>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={opacity}
            onChange={(e) => setOpacity(parseInt(e.target.value))}
          />
          <button
            className="opacity-apply-btn"
            onClick={() => {
              handleCellOperation({ type: 'opacity', value: opacity / 100 });
              setOpacity(100);
            }}
          >
            Apply Opacity
          </button>
        </div>
        <div className="color-remove-control">
          <label>Remove Color:</label>
          <input
            type="color"
            value={removeColor}
            onChange={(e) => setRemoveColor(e.target.value)}
          />
          <label>Tolerance: {colorTolerance}</label>
          <input
            type="range"
            min="0"
            max="255"
            step="1"
            value={colorTolerance}
            onChange={(e) => setColorTolerance(parseInt(e.target.value))}
          />
          <button
            className="color-remove-btn"
            onClick={() => handleCellOperation({ type: 'remove_color', color: removeColor, tolerance: colorTolerance })}
          >
            Remove Color
          </button>
        </div>
        <div className="despill-control">
          <label>Despill: {despillAmount}%</label>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={despillAmount}
            onChange={(e) => setDespillAmount(parseInt(e.target.value))}
          />
          <label>Tint:</label>
          <input
            type="color"
            value={despillTint}
            onChange={(e) => setDespillTint(e.target.value)}
            title="Colour the spill converts toward (#ffffff = neutral gray)"
          />
          <button
            className="despill-btn"
            onClick={() =>
              handleCellOperation({
                type: 'despill',
                amount: despillAmount / 100,
                tint: despillTint,
              })
            }
          >
            Remove Green Spill
          </button>
        </div>
        <div className="bg-control">
          <div className="bg-control-row">
            <label>Background:</label>
            <input
              type="file"
              ref={bgInputRef}
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                handleBackgroundUpload(e.target.files[0]);
                e.target.value = '';
              }}
            />
            <button className="bg-upload-btn" onClick={() => bgInputRef.current?.click()}>
              Upload BG
            </button>
            <select value={bgFit} onChange={(e) => setBgFit(e.target.value)} className="bg-fit-select">
              <option value="fill">Fill (cover)</option>
              <option value="fit">Fit (contain)</option>
              <option value="stretch">Stretch</option>
            </select>
            <button
              className="bg-apply-btn"
              onClick={handleApplyBackground}
              disabled={!selectedBgId || selectedCells.size === 0}
            >
              Apply BG
            </button>
          </div>
          {backgrounds.length > 0 && (
            <div className="bg-library">
              {backgrounds.map((bg) => (
                <div
                  key={bg.bgId}
                  className={`bg-thumb ${selectedBgId === bg.bgId ? 'selected' : ''}`}
                  onClick={() => setSelectedBgId(bg.bgId)}
                  title={`${bg.width}×${bg.height}`}
                >
                  <img src={bg.previewUrl} alt="bg" />
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="move-control">
          <label>X:</label>
          <input
            type="number"
            value={moveX}
            onChange={(e) => setMoveX(parseInt(e.target.value) || 0)}
          />
          <label>Y:</label>
          <input
            type="number"
            value={moveY}
            onChange={(e) => setMoveY(parseInt(e.target.value) || 0)}
          />
          <button
            className="move-apply-btn"
            onClick={() => {
              handleCellOperation({ type: 'move', dx: moveX, dy: moveY });
              setMoveX(0);
              setMoveY(0);
            }}
          >
            Apply Move
          </button>
        </div>
        <div className="move-hint">
          Tip: drag the preview or a cell thumbnail to set the offset · Esc cancels
        </div>
        <div className="scale-control">
          <label>Scale: {scaleFactor.toFixed(2)}×</label>
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.05"
            value={scaleFactor}
            onChange={(e) => setScaleFactor(parseFloat(e.target.value))}
          />
          <button
            className="scale-apply-btn"
            onClick={() => {
              handleCellOperation({ type: 'scale', factor: scaleFactor });
              setScaleFactor(1.0);
            }}
          >
            Apply Scale
          </button>
        </div>
        <div className="edit-controls">
          <button
            className="erase-btn"
            onClick={() => handleCellOperation({ type: 'erase' })}
          >
            Erase
          </button>
          <button
            className="rotate-btn"
            onClick={() => handleCellOperation({ type: 'rotate', degree: 90 })}
          >
            Rotate 90°
          </button>
          <button
            className="rotate-btn"
            onClick={() => handleCellOperation({ type: 'rotate', degree: 180 })}
          >
            Rotate 180°
          </button>
          <button
            className="rotate-btn"
            onClick={() => handleCellOperation({ type: 'rotate', degree: 270 })}
          >
            Rotate 270°
          </button>
          <button
            className="undo-btn"
            onClick={handleUndo}
          >
            Undo
          </button>
        </div>
      </div>
    );
  };

  const renderSpritePlayer = () => {
    if (!imageData || selectedCells.size === 0) return null;

    const frames = [...selectedCells].sort((a, b) => a - b);
    const safeIndex = Math.min(playerFrameIndex, frames.length - 1);
    const currentFrame = frames[safeIndex >= 0 ? safeIndex : 0];

    return (
      <div className="sprite-player">
        <div className="section-title">Sprite Player</div>
        <div className="player-display">
          <div style={{ position: 'relative', display: 'inline-block', transform: `rotate(${playerRotation}deg)`, transition: 'transform 0.1s ease' }}>
            <AsyncImage
              loader={() => client.cellPreviewSrc(imageData.imageId, currentFrame, refreshKey)}
              deps={[imageData.imageId, currentFrame, refreshKey]}
              alt={`Frame ${safeIndex + 1}`}
            />
            {showCenterCross && <div className="center-cross" />}
          </div>
        </div>
        <div className="player-info">
          Frame {safeIndex + 1} / {frames.length} · Cell #{currentFrame}
        </div>
        <div className="player-controls">
          <button
            className={`player-btn ${playerPlaying ? 'stop' : 'play'}`}
            onClick={() => {
              if (!playerPlaying) setPlayerFrameIndex(0);
              setPlayerPlaying(!playerPlaying);
            }}
          >
            {playerPlaying ? 'Stop' : 'Play'}
          </button>
          <label>FPS:</label>
          <input
            type="number"
            value={playerFps}
            min="1"
            max="60"
            onChange={(e) => setPlayerFps(Math.max(1, parseInt(e.target.value) || 1))}
          />
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={playerLoop}
              onChange={(e) => setPlayerLoop(e.target.checked)}
            />
            Loop
          </label>
        </div>
        <div className="player-rotation">
          <label>Rotation: {playerRotation}°</label>
          <input
            type="range"
            min="0"
            max="360"
            step="1"
            value={playerRotation}
            onChange={(e) => setPlayerRotation(parseInt(e.target.value))}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="app">
      {notice && (
        <div className={`toast toast-${notice.type}`} onClick={() => setNotice(null)}>
          {notice.message}
        </div>
      )}
      <div className="toolbar">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => handleFileUpload(e.target.files[0])}
          accept="image/*"
          style={{ display: 'none' }}
        />
        <button onClick={handleOpen} title={isLocal ? 'Open file (⌘O)' : 'Upload image'}>
          {isLocal ? 'Open File…' : 'Upload Image'}
        </button>
        <button onClick={() => window.location.reload()} title="Reload (⌘R)">
          Reload
        </button>

        {imageData && (
          <>
            <div className="input-group">
              <label>Rows:</label>
              <input
                type="number"
                value={rows}
                onChange={(e) => setRows(parseInt(e.target.value) || 1)}
                min="1"
                max="50"
              />
            </div>
            <div className="input-group">
              <label>Cols:</label>
              <input
                type="number"
                value={cols}
                onChange={(e) => setCols(parseInt(e.target.value) || 1)}
                min="1"
                max="50"
              />
            </div>
            <button onClick={handleSliceImage} disabled={loading}>
              Slice Image
            </button>
          </>
        )}
        
        {gridParams && (
          <>
            {isLocal ? (
              <>
                <button onClick={handleSave} title="Save (⌘S)">Save</button>
                <button onClick={handleSaveAs} title="Save As… (⇧⌘S)">Save As…</button>
              </>
            ) : (
              <button onClick={handleExport}>Export Atlas</button>
            )}
          </>
        )}
      </div>

      <div className="main-content">
        <div className="left-panel">
          {!imageData && (
            <div
              className={`upload-area ${dragOver ? 'dragover' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
            >
              <div>Click or drag to upload an image</div>
              <div style={{ fontSize: '14px', color: '#666', marginTop: '10px' }}>
                Supports PNG, JPG, WEBP
              </div>
              {dragOver && (
                <div style={{ fontSize: '16px', color: '#007bff', marginTop: '10px', fontWeight: 'bold' }}>
                  Drop image here!
                </div>
              )}
            </div>
          )}
          
          {imageData && (
            <div>
              <div className="section-title">Image Preview</div>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img
                  src={imageData.previewUrl}
                  alt="Original"
                  className="image-preview"
                  style={{ maxWidth: '100%', maxHeight: '60vh' }}
                />
                {renderGridOverlay()}
              </div>
              <div style={{ marginTop: '10px', fontSize: '14px', color: '#666' }}>
                Size: {imageData.width} × {imageData.height}
              </div>
              {currentPath && (
                <div style={{ marginTop: '4px', fontSize: '12px', color: '#888', wordBreak: 'break-all' }}>
                  Editing: {currentPath}
                </div>
              )}
            </div>
          )}
          {renderSpritePlayer()}
        </div>

        <div className="right-panel">
          {loading && (
            <div className="loading">Loading...</div>
          )}
          
          {gridParams && (
            <div>
              <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <span>Cells ({gridParams.rows}×{gridParams.cols})</span>
                <button className="batch-btn" onClick={handleSelectAll}>Select All</button>
                <button className="batch-btn" onClick={handleDeselectAll}>Deselect All</button>
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={showCenterCross}
                    onChange={(e) => setShowCenterCross(e.target.checked)}
                  />
                  Show Center Cross
                </label>
              </div>
              {renderCellGrid()}
            </div>
          )}
          
          {renderCellEditor()}
        </div>
      </div>
    </div>
  );
}

export default App;