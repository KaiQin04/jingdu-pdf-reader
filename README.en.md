# Jingdu PDF Reader

[繁體中文](README.md) | English

Jingdu is a PDF reader that sits next to your ChatGPT conversation. In a ChatGPT setup where Jingdu is connected, open the reader window and choose a PDF from your device. You can then read the original while you talk it through with ChatGPT. Paste any passage into the chat with its page number, and ask ChatGPT to explain, compare, or summarize it. The app is currently in a trial phase, and its interface is in Traditional Chinese.

## How to use

1. In a ChatGPT conversation where Jingdu is connected, open 「PDF 閱讀器」 (PDF Reader) and choose a PDF from your device.
2. Select the text you want to discuss, open 「工具 → 搜尋」 (Tools → Search), click 「建立頁碼引用」 (Create page citation), then click 「選取引用文字」 (Select citation text).
3. Press Ctrl+C (⌘+C on Mac) and paste it into your ChatGPT conversation.
4. Ask your question. For example, have ChatGPT explain the passage, compare it with another passage you paste into the chat, or turn it into key points.

To find passages or check the original, use search, the table of contents, or the two-page and side-by-side views in the reader window. You can also highlight, underline, comment, draw by hand, or capture an area of a page. In the export preview, copy your notes as JSON or Markdown. To continue later, reopen the same PDF and import the JSON.

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

- [Try the standalone web reader](https://jingdu-pdf-reader.qqqqqwz.chatgpt.site)
- [ChatGPT connection and development notes (Traditional Chinese)](docs/development.md)
- [License](LICENSE)
- [Third-party licenses (Traditional Chinese)](docs/third-party-licenses.md)
