/** Download rows as a CSV file (UTF-8 with BOM so spreadsheets open accents correctly). */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  // A leading = + - @ would be run as a formula by spreadsheet programs; prefix such cells.
  const cell = (value: string | number) => {
    let text = String(value)
    if (/^[=+\-@\t\r]/.test(text) && Number.isNaN(Number(text))) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const blob = new Blob(['\ufeff' + rows.map((row) => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.append(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
