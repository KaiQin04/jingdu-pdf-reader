# Jingdu PDF Reader

English | [繁體中文](README.zh-Hant.md)

Jingdu is a PDF reader that sits next to your ChatGPT conversation. Open a PDF from your device, preview the text you want to share, then send it to the conversation in a supported host. You can read the original while you ask ChatGPT to explain, compare, or summarize the shared text. The app is currently in a trial phase. Its interface defaults to English; choose 繁體中文 from the Language control in the toolbar to switch. The language choice stays only in the current window.

## How to use

1. In a ChatGPT conversation where Jingdu is connected, open 「PDF 閱讀器」 (PDF Reader) and choose a PDF from your device.
2. Click **ChatGPT** in the reader toolbar. Choose **Selected text**, **Current PDF page**, or **Whole document text**, then click **Prepare preview**.
3. Check the preview and click **Send to ChatGPT**. If sending isn't available, select the preview text, copy with Ctrl+C (⌘+C on Mac), and paste it into your conversation.
4. Ask your question in the conversation. Opening a PDF or preparing a preview does not give ChatGPT its contents.

This shares extracted text with the filename and physical PDF page numbers, which may differ from printed page numbers. The original PDF, images, diagrams, and local notes are not attached. Pages without extractable text are marked in the preview. Large documents may need to be shared a page or passage at a time; see the [development notes](docs/development.md#pdf-text-sharing) for limits.

To find passages or check the original, use search, the table of contents, or the two-page and side-by-side views in the reader window. You can also highlight, underline, comment, draw by hand, or capture an area of a page. In the export preview, copy your notes as JSON or Markdown. To continue later, reopen the same PDF and import the JSON.

## Interface preview

![English reader interface](docs/images/reader-en.jpg)

Local standalone preview using a synthetic PDF, showing the English interface and search results. No real user documents. This does not demonstrate ChatGPT installation, sidebar pinning, or cross-account verification.

## ChatGPT sidebar entry

The app declares both global-sidebar and conversation-side-panel entries, as described in the [official entrypoint reference](https://developers.openai.com/plugins/build/extensions#sidebar-apps). They require a connected app and a host that supports these extensions. Cloning this repository does not install or automatically pin the plugin. Appearance and automatic pinning have not been verified on another account; public end-to-end MCP access is also unconfirmed. See the [connection notes](docs/development.md#mcp).

## Save before you leave

Annotations stay only in the current window. They are not saved automatically and are not written to the original PDF. Export them before closing or refreshing the page.

## Privacy

Your original PDF is processed in your browser and is not uploaded to this service. **Send to ChatGPT** shares everything in the text preview with the host, under its policies. **Download via ChatGPT** (「交由 ChatGPT 下載」 in Traditional Chinese) separately shares previewed notes or captures. These may include filenames or quoted text. Reading and preparing previews do not send content. Closing the reader does not retract content already shared. On the standalone site, sending and host download are disabled; you can copy text or save an image yourself.

The site is hosted on Cloudflare, which may keep standard access logs and set security cookies. During the trial, we recommend using non-sensitive documents.

## Current limitations

- No OCR. Image-only scanned PDFs cannot be searched; scanned PDFs with a text layer can.
- You cannot edit the original PDF, load a PDF from a URL, or sync to the cloud.
- Each PDF must be no larger than 500 MiB and no longer than 5,000 pages. Larger files use more memory.

## More

- [Try the standalone web reader](https://pdf.zhiweiqin.me)
- [ChatGPT connection and development notes (Traditional Chinese)](docs/development.md)
- [License](LICENSE)
- [Third-party licenses (Traditional Chinese)](docs/third-party-licenses.md)
