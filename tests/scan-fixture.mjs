/** Generate a tiny black CCITT scan with a separate invisible synthetic text layer. */
export function makeCcittPdf() {
  // Group 3: EOL, zero white pixels, eight black pixels, repeated for eight rows.
  const bits = ('000000000001' + '00110101' + '000101').repeat(8);
  const image = Buffer.from(bits.match(/.{8}/g).map(byte => parseInt(byte, 2)));
  const content = Buffer.from('q 300 0 0 300 40 400 cm /Im1 Do Q\nBT /F1 12 Tf 3 Tr 40 730 Td (SYNTHETIC OCR TEXT) Tj ET');
  const stream = (dictionary, data) => Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${data.length} >>\nstream\n`), data,
    Buffer.from('\nendstream'),
  ]);
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Count 1 /Kids [3 0 R] >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    stream('', content),
    stream('/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 1 /Filter /CCITTFaxDecode /DecodeParms << /K 0 /Columns 8 /Rows 8 /EndOfLine true /EndOfBlock false /BlackIs1 false >>', image),
  ];
  const chunks = [Buffer.from('%PDF-1.7\n%synthetic-ccitt\n')], offsets = [];
  let length = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
    chunks.push(chunk); length += chunk.length;
  }
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}
