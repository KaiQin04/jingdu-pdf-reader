from reportlab.pdfgen import canvas
from pathlib import Path
out=Path('tests/fixtures')
for name,count in [('continuous-mixed.pdf',12),('continuous-short.pdf',30)]:
 c=canvas.Canvas(str(out/name))
 for n in range(1,count+1):
  size=(600,200) if 'short' in name else ((600,800) if n%2 else (800,600))
  c.setPageSize(size);c.setPageRotation(90 if name=='continuous-mixed.pdf' and n%3==0 else 0)
  c.setFont('Helvetica',16);c.drawString(30,100,f'Synthetic continuous page {n}')
  c.setFont('Helvetica',12);c.drawString(30,70,'Mixed geometry and reading-anchor verification only.')
  c.showPage()
 c.save()
