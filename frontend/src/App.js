import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import './App.css';

function App() {
  const [imageData, setImageData] = useState(null);
  const [gridParams, setGridParams] = useState(null);
  const [cells, setCells] = useState([]);
  const [selectedCell, setSelectedCell] = useState(null);
  const [rows, setRows] = useState(8);
  const [cols, setCols] = useState(8);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
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
      setSelectedCell(null);
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
      setSelectedCell(0);
    } catch (error) {
      console.error('Slice failed:', error);
      alert('Failed to slice image');
    }
    setLoading(false);
  };

  const handleCellOperation = async (operation) => {
    if (!imageData || selectedCell === null) return;
    
    try {
      await axios.post(`/api/image/${imageData.imageId}/cell/${selectedCell}/op`, operation);
      // Force refresh of cell preview by incrementing refresh key
      setRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Operation failed:', error);
      alert('Failed to apply operation');
    }
  };

  const handleUndo = async () => {
    if (!imageData || selectedCell === null) return;
    
    try {
      await axios.post(`/api/image/${imageData.imageId}/cell/${selectedCell}/undo`);
      // Force refresh of cell preview by incrementing refresh key
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
    
    // Selected cell highlight
    if (selectedCell !== null && cells.length > 0) {
      const cell = cells[selectedCell];
      lines.push(
        <div
          key="selected"
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
            className={`cell-thumbnail ${selectedCell === cell.cellId ? 'selected' : ''}`}
            onClick={() => setSelectedCell(cell.cellId)}
          >
            <img
              src={`/api/image/${imageData.imageId}/cell/${cell.cellId}/preview?t=${refreshKey}`}
              alt={`Cell ${cell.cellId}`}
            />
          </div>
        ))}
      </div>
    );
  };

  const renderCellEditor = () => {
    if (!imageData || selectedCell === null) return null;
    
    return (
      <div className="cell-editor">
        <div className="section-title">Cell Editor</div>
        <div className="cell-preview">
          <img
            src={`/api/image/${imageData.imageId}/cell/${selectedCell}/preview?t=${refreshKey}`}
            alt={`Cell ${selectedCell}`}
          />
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
              <div className="section-title">
                Cells ({gridParams.rows}×{gridParams.cols})
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