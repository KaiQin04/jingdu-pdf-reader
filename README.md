# 靜讀 PDF 閱讀器

在瀏覽器裡閱讀自己的 PDF，支援搜尋、目錄、雙頁比較、註記與引用。這是公開試用版；原始 PDF 在瀏覽器記憶體處理，不上傳至本服務。

- [使用者短版說明](docs/help.txt)
- [隱私與匯出資料說明](docs/privacy.txt)
- [更新與驗證範圍](CHANGELOG.md)
- [自有程式 MIT 授權](LICENSE)與[第三方授權](docs/third-party-licenses.md)
- 部署網站的 `/licenses` 提供實際隨建置附上的第三方授權全文。

註記不會自動保存。關閉前請複製 JSON／Markdown 或另存區域截圖。宿主中的「交由 ChatGPT 下載」是額外的、需主動點擊的外送動作，可能包含檔名或引文。沒有 OCR、原 PDF 回寫、網址載入、雲端同步或閱讀器主動 AI 呼叫。

## 給開發者

### 本機開發

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

### MCP

公開試用端點：`https://jingdu-pdf-reader.qqqqqwz.chatgpt.site/mcp`

工具 `open_pdf_reader` 的參數固定為 `{}`，只開啟空白閱讀介面；不接受 PDF、檔名、URL 或文件內容，也不產生摘要。程式支援 MCP `2026-07-28`，自動化測試另涵蓋 `2025-11-25` 舊版初始化流程；這不是所有宿主的相容性保證；本服務尚未送 ChatGPT 目錄審查，也沒有官方認證。

**已知平台限制（前次交付記錄，2026-10-31）：**匿名驗證客戶端的 MCP POST 曾遭 Cloudflare Error 1010 封鎖，公眾端對端 MCP 連線尚未確認。網站閱讀入口可開啟，不代表 MCP 已可供所有客戶端連線。不要更換識別或路由繞過平台封鎖。

### 部署與資料邊界

正式 Worker 需要非秘密環境設定 `PDF_READER_SITE_ORIGIN`，值為服務自己的完整 HTTPS origin。僅提供 `/`、`/reader`、`/privacy`、`/help`、`/licenses` 及 POST `/mcp`；不設檔案儲存或使用者資料庫。預覽 adapter 的 origin 是開發設定，部署其他網域時須與實際服務設定一致。

閱讀器以 sandbox、雜湊腳本、blob Worker 及 `connect-src 'none'` 限制網路活動。PDF 與註記在記憶體處理；宿主下載僅在使用者點擊後傳送預覽中的衍生資料。託管平台仍可能保存一般存取紀錄及安全 Cookie。

MCP 具有 32 KiB 請求上限、巢狀深度 16、10 秒處理時限及每個 isolate 4 個同時請求上限。這些不是跨節點限流，也不是阻斷服務攻擊的保證。

### 大檔與縮放

500 MiB／5,000 頁是拒收上限，不是可流暢開啟的保證。大型或複雜文件仍可能耗用大量記憶體。顯示縮放目標為 25–600%；個別超大頁面的顯示尺寸另限寬 8,192／高 6,000 CSS px，實際可用倍率可能更低。畫布單軸上限 8,192 px；可見頁合計配置預算為 1,150 萬像素（從 1,200 萬預算預留 50 萬），最多 12 個可見／鄰頁。大倍率會降低點陣解析度，可能較模糊。

### 第三方授權

建置會保留依賴的授權全文並在網站 `/licenses` 提供：

- PDF.js：Apache-2.0；CMaps 另有 Adobe 的授權條件。
- PDFium／Foxit 標準字型：所附 PDFium Authors 三條款 BSD 文字。
- Liberation 字型：所附 GPL v2 及例外條款。散布字型時須保留原授權，不應將其改標成主程式的授權。
- MCP 套件：以套件所附 LICENSE 為準，包含 Apache-2.0 遷移說明及仍適用 MIT 的既有貢獻；不是全部改為同一授權。
- Zod：MIT。

MCP 已打包的 `content-type` 程式碼另附完整 MIT 授權。各檔案、版本、建置路徑與字型散布注意事項見[第三方授權對照](docs/third-party-licenses.md)。自有程式的授權不取代第三方條款；本次檢查不構成完整法律審查。

## 驗證範圍

2026-10-31 公開原始碼準備：以 Node.js 26.12.1／npm 11.20.0 在獨立目錄全新執行 `npm ci`，保留鎖檔、TLS 驗證與 `ignore-scripts=true`。安裝 27 個套件；npm 當次 audit 回報 0 個已知弱點，不代表不存在未知風險。`npm run build`、`npm test`（89 項通過、0 失敗、0 略過）、`npm run validate` 及更新 checksum 後的 `npm run check:package` 通過。原附件記錄的 88 項測試不計入本次結果；本次新增授權全文路由檢查。

測試涵蓋實際 PDF.js 解析／Node canvas、搜尋與目錄、註記、縮放／像素預算、DOM doubles，以及本機 Worker 的 MCP 現行與舊版初始化流程。Retina 縮放超過舊倍率停滯點的回歸檢查通過，但不等於瀏覽器視覺驗收。

本機預覽頁可載入；本次未能完成瀏覽器的合成 PDF 檔案選取，因此開檔後的連續捲動、搜尋、目錄、雙頁、註記匯出與縮放仍未完成瀏覽器驗收。Apple Pencil、宿主下載、完整無障礙相容性及公開 MCP 端對端均未驗證。程式測試不等於真機或公眾平台端對端測試。

原始附件的 68 個檔案已核對大小、SHA256 與封裝路徑；本次公開清單為這些檔案加 1 份授權，不含私人 Git 歷史、依賴目錄、建置產物或測試執行紀錄。合成 PDF 的文字、metadata、附件與圖標已檢查。本次只公開倉庫，未部署網站或變更 plugin。請先用不敏感文件試用；公開回報問題時不要附私人 PDF、註記或截圖。
