/**
 * FileUploader.jsx
 *
 * Click or drag-and-drop file area. Hands the raw File to onFile(file) —
 * reading and parsing belong to the input adapters, not this component.
 */

import { useRef, useState } from 'react'
import Icon from './Icon.jsx'

export default function FileUploader({ title, hint, accept, onFile, loadedName, busy = false }) {
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  function pick(file) {
    if (file && !busy) onFile(file)
  }

  const cls = ['dropzone', dragging && 'is-dragging', loadedName && !busy && 'is-loaded'].filter(Boolean).join(' ')

  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files[0]) }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => { pick(e.target.files[0]); e.target.value = '' }}
      />
      <div className="dropzone-icon">
        <Icon name={loadedName && !busy ? 'check' : busy ? 'file' : 'upload'} size={18} />
      </div>
      <div className="dropzone-text">
        <div className="dropzone-title">{title}</div>
        <div className="dropzone-hint">{busy ? 'Reading file…' : loadedName || hint}</div>
      </div>
      <span className="dropzone-action">{loadedName ? 'Replace' : 'Browse'}</span>
    </div>
  )
}
