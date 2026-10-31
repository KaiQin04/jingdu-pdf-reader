# 開發與技術說明

[返回使用說明](../README.md)

## 本機開發

需要 Node.js 24 或更新版本。在專案根目錄依鎖檔全新安裝依賴；`.npmrc` 預設停用安裝腳本，不需要將它關閉：

```sh
npm ci
npm run build
npm test
npm run validate
node scripts/update-checksums.mjs
npm run check:package
npm run dev
```

測試會匯入 `dist/server/index.js`，因此全新安裝後須先建置。`check:package` 使用前一步產生的本機 `SHA256SUMS.json`；這份清單涵蓋本次來源與建置產物，不提交至 Git，也不是原始附件的 checksum。

本機預覽預設監聽 4173 埠，可用 `PORT` 修改；預覽 adapter 不包含在正式 Worker bundle。`npm run build` 產生自含 PDF.js、字型與 CMap 的閱讀頁及 Cloudflare Worker ESM。不要把依賴套件或字型的授權移除。本倉庫不含自動部署 workflow，公開原始碼不會更新現有網站。

## MCP

公開試用端點：`https://jingdu-pdf-reader.qqqqqwz.chatgpt.site/mcp`

工具 `open_pdf_reader` 的參數固定為 `{}`，只開啟空白閱讀介面；不接受 PDF、檔名、URL 或文件內容，也不產生摘要。程式支援 MCP `2026-07-28`，自動化測試另涵蓋 `2025-11-25` 舊版初始化流程；這不是所有宿主的相容性保證；本服務尚未送 ChatGPT 目錄審查，也沒有官方認證。

**已知平台限制（前次交付記錄，2026-10-31）：**匿名驗證客戶端的 MCP POST 曾遭 Cloudflare Error 1010 封鎖，公眾端對端 MCP 連線尚未確認。網站閱讀入口可開啟，不代表 MCP 已可供所有客戶端連線。不要更換識別或路由繞過平台封鎖。

## 部署與資料邊界

正式 Worker 需要非秘密環境設定 `PDF_READER_SITE_ORIGIN`，值為服務自己的完整 HTTPS origin。僅提供 `/`、`/reader`、`/privacy`、`/help`、`/licenses` 及 POST `/mcp`；不設檔案儲存或使用者資料庫。預覽 adapter 的 origin 是開發設定，部署其他網域時須與實際服務設定一致。

閱讀器以 sandbox、雜湊腳本、blob Worker 及 `connect-src 'none'` 限制網路活動。PDF 與註記在記憶體處理；宿主下載僅在使用者點擊後傳送預覽中的衍生資料。託管平台仍可能保存一般存取紀錄及安全 Cookie。

MCP 具有 32 KiB 請求上限、巢狀深度 16、10 秒處理時限及每個 isolate 4 個同時請求上限。這些不是跨節點限流，也不是阻斷服務攻擊的保證。

## 大檔與縮放

500 MiB／5,000 頁是拒收上限，不是可流暢開啟的保證。大型或複雜文件仍可能耗用大量記憶體。顯示縮放目標為 25–600%；個別超大頁面的顯示尺寸另限寬 8,192／高 6,000 CSS px，實際可用倍率可能更低。畫布單軸上限 8,192 px；可見頁合計配置預算為 1,150 萬像素（從 1,200 萬預算預留 50 萬），最多 12 個可見／鄰頁。大倍率會降低點陣解析度，可能較模糊。

## 第三方授權

建置會保留依賴的授權全文並在網站 `/licenses` 提供：

- PDF.js：Apache-2.0；CMaps 另有 Adobe 的授權條件。
- PDFium／Foxit 標準字型：所附 PDFium Authors 三條款 BSD 文字。
- Liberation 字型：所附 GPL v2 及例外條款。散布字型時須保留原授權，不應將其改標成主程式的授權。
- MCP 套件：以套件所附 LICENSE 為準，包含 Apache-2.0 遷移說明及仍適用 MIT 的既有貢獻；不是全部改為同一授權。
- Zod：MIT。

MCP 已打包的 `content-type` 程式碼另附完整 MIT 授權。各檔案、版本、建置路徑與字型散布注意事項見[第三方授權對照](third-party-licenses.md)。自有程式的授權不取代第三方條款；本次檢查不構成完整法律審查。

