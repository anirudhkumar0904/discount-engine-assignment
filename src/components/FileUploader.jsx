/**
 * FileUploader.jsx
 *
 * Generic click-to-upload area. Reads the chosen file as text (CSV) or as an
 * ArrayBuffer (PDF) and calls onLoad(contents, fileName). Knows nothing about
 * what the file means — parsing belongs to the input adapters.
 */

import { useRef } from 'react'

export default function FileUploader({
  label,
  description,
  accept,
  readAs = 'text',
  onLoad,
  hasData,
  fileName,
  busy = false,
}) {
  const inputRef = useRef(null)

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => onLoad(evt.target.result, file.name)
    if (readAs === 'arrayBuffer') reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
    // Reset input so the same file can be re-uploaded
    e.target.value = ''
  }

  const active = hasData && !busy
  return (
    <div
      role="button"
      tabIndex={0}
      style={{
        border: `2px dashed ${active ? '#1e5c2c' : '#CECECE'}`,
        borderRadius: 6,
        padding: '0.8rem 1rem',
        background: active ? '#f0faf2' : '#fafafa',
        cursor: busy ? 'progress' : 'pointer',
        transition: 'border-color 0.15s',
      }}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && inputRef.current?.click()}
    >
      <input ref={inputRef} type="file" accept={accept} style={{ display: 'none' }} onChange={handleFile} />
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: 18 }}>{busy ? '⏳' : active ? '✅' : '📄'}</span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#131A48' }}>{label}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {busy ? 'Reading…' : active ? fileName : description}
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: active ? '#1e5c2c' : '#FF5800',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {active ? 'Change' : 'Upload'}
          </span>
        </div>
      </div>
    </div>
  )
}
