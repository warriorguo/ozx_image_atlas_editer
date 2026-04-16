import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [imageData, setImageData] = useState(null);
  const [gridParams, setGridParams] = useState(null);
  const [cells, setCells] = useState([]);
  const [selectedCells, setSelectedCells] = useState(new Set());
  const [activeCell, setActiveCell] = useState(null);
  const [showCenterCross, setShowCenterCross] = useState(false);
  const [moveX, setMoveX] = useState(0);
  const [moveY, setMoveY] = useState(0);
  const [rows, setRows] = useState(8);
  const [cols, setCols] = useState(8);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [opacity, setOpacity] = useState(100);
  const [removeColor, setRemoveColor] = useState('#ffffff');
  const [colorTolerance, setColorTolerance] = useState(30);
  const fileInputRef = useRef();

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

  const handleFileUpload = async (file) => {
    if (!file) return;
    
    // Check if it's an image file
    if (!file.type.startsWith('image/')) {
      alert('Please upload an image file (PNG, JPG, WEBP)');
      return;
    }
    
    setLoading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post('/api/image/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setImageData(response.data);
      setGridParams(null);
      setCells([]);
      setSelectedCells(new Set());
      setActiveCell(null);
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
      const response = await axios.post(`/api/image/${imageData.imageId}/slice`, {
        rows,
        cols
      });
      
      setGridParams(response.data);
      setCells(response.data.cells);
      setSelectedCells(new Set([0]));
      setActiveCell(0);
    } catch (error) {
      console.error('Slice failed:', error);
      alert('Failed to slice image');
    }
    setLoading(false);
  };

  const handleCellOperation = async (operation) => {
    if (!imageData || selectedCells.size === 0) return;

    try {
      await axios.post(`/api/image/${imageData.imageId}/batch/op`, {
        cellIds: [...selectedCells],
        operation
      });
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Operation failed:', error);
      alert('Failed to apply operation');
    }
  };

  const handleUndo = async () => {
    if (!imageData || selectedCells.size === 0) return;

    try {
      await axios.post(`/api/image/${imageData.imageId}/batch/undo`, {
        cellIds: [...selectedCells]
      });
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Undo failed:', error);
      alert('Failed to undo operation');
    }
  };

  const handleExport = async () => {
    if (!imageData) return;
    
    try {
      const response = await axios.get(`/api/image/${imageData.imageId}/export`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `atlas_${imageData.imageId}.png`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export atlas');
    }
  };

  const handleCellClick = (cellId, e) => {
    if (e.ctrlKey || e.metaKey) {
      setSelectedCells(prev => {
        const next = new Set(prev);
        if (next.has(cellId)) {
          next.delete(cellId);
        } else {
          next.add(cellId);
        }
        return next;
      });
      setActiveCell(cellId);
    } else {
      setSelectedCells(new Set([cellId]));
      setActiveCell(cellId);
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
            className={`cell-thumbnail ${selectedCells.has(cell.cellId) ? 'selected' : ''}`}
            onClick={(e) => handleCellClick(cell.cellId, e)}
          >
            <img
              src={`/api/image/${imageData.imageId}/cell/${cell.cellId}/preview?t=${refreshKey}`}
              alt={`Cell ${cell.cellId}`}
            />
            {showCenterCross && <div className="center-cross" />}
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
        <div className="cell-preview">
          <img
            src={`/api/image/${imageData.imageId}/cell/${activeCell}/preview?t=${refreshKey}`}
            alt={`Cell ${activeCell}`}
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

  return (
    <div className="app">
      <div className="toolbar">
        <input
          type="file"
          ref={fileInputRef}
          onChange={(e) => handleFileUpload(e.target.files[0])}
          accept="image/*"
          style={{ display: 'none' }}
        />
        <button onClick={() => fileInputRef.current?.click()}>
          Upload Image
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
          <button onClick={handleExport}>
            Export Atlas
          </button>
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
            </div>
          )}
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