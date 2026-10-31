from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont, CIDEncoding
font=UnicodeCIDFont('MSung-Light');font.encodingName='UniCNS-UCS2-H';font.encoding=CIDEncoding('UniCNS-UCS2-H');pdfmetrics.registerFont(font)
c=canvas.Canvas('tests/fixtures/academic-navigation.pdf',pagesize=(600,800))
for n in range(1,7):
 c.setPageSize((600,800) if n%2 else (800,600));c.bookmarkPage('p'+str(n));c.addOutlineEntry('Chapter '+str(n),'p'+str(n),0)
 c.setFont('Helvetica',20);c.drawString(40,540,'Academic sample page '+str(n));c.setFont('Helvetica',14)
 c.drawString(40,500,'Alpha alpha economics markets and welfare.');c.drawString(40,460,'Select this sentence to highlight and annotate.')
 c.setFont('MSung-Light',16);c.drawString(40,420,'經濟制度與市場機制，福利政策與競爭。')
 c.setFont('Helvetica',14);c.drawString(40,380,'Internal link: chapter 6');c.linkRect('', 'p6',(40,375,260,400),relative=0)
 c.drawString(40,340,'External link must stay inert');c.linkURL('https://example.invalid/no-access',(40,335,280,360),relative=0)
 c.showPage()
c.save()
