/** QR code SVG generation for the pairing URL. */

import qrcode from 'qrcode-generator'

/**
 * @param {string} text
 * @returns {string} self-contained SVG markup
 */
export function createQrSvg(text) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true })
}
