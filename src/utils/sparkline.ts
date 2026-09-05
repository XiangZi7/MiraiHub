/** Geometry for a decorative trend line; SVG handles resize without JS observers. */
export function sparklineGeometry(data: readonly number[]): {
  line: string
  area: string
} {
  if (!data.length) return { line: '', area: '' }
  const values = data.map(value => (Number.isFinite(value) ? value : 0))
  let min = Infinity,
    max = -Infinity
  for (const value of values) {
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  const range = max - min
  const points = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index * 300) / (values.length - 1)
    const y = range ? 82 - ((value - min) / range) * 64 : 50
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  if (points.length === 1) points.push('300.00,50.00')
  const line = `M${points.join(' L')}`
  return { line, area: `${line} L300,100 L0,100 Z` }
}
