# Jingdu PDF Reader

[繁體中文](README.md) | English

[Open the reader](https://jingdu-pdf-reader.qqqqqwz.chatgpt.site)

Read your own PDFs in the browser. Scroll continuously, search, browse the table of contents, and switch between single-page, two-page, or side-by-side comparison views. Select text to copy it with a page-number citation. You can also highlight, underline, comment, draw by hand, or capture an area of a page. The app is currently in a trial phase, and its interface is in Traditional Chinese.

## How to use

1. Open the reader and choose a PDF from your computer.
2. Read, search, and add any annotations you need.
3. In the export preview, copy your notes as JSON or Markdown. Depending on browser support, you can also save area captures as preview images. To continue annotating later, reopen the same PDF and then import the JSON.

## Save before you leave

Annotations stay only in the current window. They are not saved automatically and are not written to the original PDF. Export them before closing or refreshing the page.

## Privacy

Your PDF is processed in your browser and is not uploaded to this service. In supported hosts, previewed notes or captures are sent to the host only when you click 「交由 ChatGPT 下載」 ("Hand off to ChatGPT for download"). This content may include file names or quoted text, and the host handles it under its own policies. On the standalone site, host download is not supported and this control is shown as disabled. You can copy the text or save the image yourself instead.

The site is hosted on Cloudflare, which may keep standard access logs and set security cookies. During the trial, we recommend using non-sensitive documents.

## Current limitations

- No OCR. Image-only scanned PDFs cannot be searched; scanned PDFs with a text layer can.
- You cannot edit the original PDF, load a PDF from a URL, or sync to the cloud.
- Each PDF must be no larger than 500 MiB and no longer than 5,000 pages. Larger files use more memory.

## More

- [Development and technical notes (Traditional Chinese)](docs/development.md)
- [License](LICENSE)
- [Third-party licenses (Traditional Chinese)](docs/third-party-licenses.md)