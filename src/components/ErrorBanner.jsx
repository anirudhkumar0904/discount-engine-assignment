/**
 * ErrorBanner.jsx — list of parse/validation problems (or warnings).
 */

export default function ErrorBanner({ errors, title, tone = 'error' }) {
  if (!errors || errors.length === 0) return null
  return (
    <div className={`alert alert-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <div className="alert-title">
        {title || `${errors.length} issue${errors.length > 1 ? 's' : ''} found`}
      </div>
      <ul>
        {errors.map((e, i) => <li key={i}>{e}</li>)}
      </ul>
    </div>
  )
}
