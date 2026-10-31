# 開發與技術說明

[English README](../README.md) · [繁體中文說明](../README.zh-Hant.md)

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

## 側邊入口與釘選

目前 `open_pdf_reader` 保留原有名稱「PDF 閱讀器」、圖標與識別，並宣告 `global` 與 `thread` 兩種入口。[官方入口文件](https://developers.openai.com/plugins/build/extensions#sidebar-apps)分別將它們定義為全域側邊入口與對話側邊入口；[自訂 MCP 說明](https://developers.openai.com/api/docs/guides/custom-mcp-server#how-to-use)要求先完成安裝與接入，且受宿主及 workspace 權限限制。

這能確認程式已提供入口 metadata，不能證明每個帳號一定自動釘選或顯示相同位置。下載 GitHub 原始碼不會自動安裝 plugin。尚未以另一個帳號完成實測，也未變更既有使用者的釘選、權限或 plugin 設定。

介面文字可在英文與繁中切換，預設英文；切換只更新已標記的介面文字，不重新開啟 PDF、不翻譯文件內容／檔名／引文／使用者註記，也不保存語言偏好。JSON 格式與文件指紋不變。Markdown 匯出可依介面語言選擇標題文字。

## 部署與資料邊界

正式 Worker 需要非秘密環境設定 `PDF_READER_SITE_ORIGIN`，值為服務自己的完整 HTTPS origin。僅提供 `/`、`/reader`、`/privacy`、`/help`、`/licenses` 及 POST `/mcp`；不設檔案儲存或使用者資料庫。預覽 adapter 的 origin 是開發設定，部署其他網域時須與實際服務設定一致。

使用自訂網域時，`PDF_READER_SITE_ORIGIN` 保留原平台的 HTTPS origin，以維持既有 MCP 接入；選用設定 `PDF_READER_PUBLIC_ORIGIN` 可再指定一個完整 HTTPS origin。程式只接受這兩個明確設定的網址：未設定第二個網址時維持原行為，設定格式錯誤時拒絕服務。這是程式內的網址白名單，不放寬 CSP；自訂網域仍須完成 Sites 的 DNS 與 TLS 驗證。

閱讀器以 sandbox、雜湊腳本、blob Worker 及 `connect-src 'none'` 限制網路活動。PDF 與註記在記憶體處理；只有使用者明確點擊傳送或宿主下載，才透過宿主橋接交付預覽中的資料。託管平台仍可能保存一般存取紀錄及安全 Cookie。

<a id="pdf-text-sharing"></a>

## PDF 文字分享

「ChatGPT」面板先在瀏覽器擷取選取文字、目前頁或全文，再顯示唯讀預覽。獨立按下「傳給 ChatGPT」才呼叫既有 SDK 的 `app.sendMessage`（`ui/message`），以使用者文字訊息交付同一份預覽；不把 PDF 或文字傳回本服務。介面依 `getHostCapabilities().message.text` 判斷支援情況，獨立網站或不支援的宿主保留手動複製。`open_pdf_reader` 仍只接收空物件，開啟閱讀器本身不讀取文件、不產生摘要。

預覽包含固定說明、經控制字元清理的檔名與實體 PDF 頁碼。PDF、檔名及擷取文字都視為不可信參考資料；不插入 HTML。沒有可擷取文字的頁面會保留佔位標記及計數，完全沒有文字則拒絕產生預覽。不包含圖片、圖表、手寫或其他本機註記；文字擷取可能失去版面與閱讀順序，PDF 頁碼可能不同於印刷頁碼。

分享與本機閱讀的上限分開：預覽最多 200 頁、100,000 個 UTF-16 code units（包含固定說明、檔名與頁碼）、400,000 UTF-8 bytes，擷取限時 30 秒；選取文字沿用 4,000 字元上限。超量、取消或擷取失敗時不會傳送，也不截斷後冒充全文。宿主可能拒絕更小的訊息，需改傳目前頁或較短文字。

傳送期間禁止重複點擊，不自動重試；拒收或無法確認結果時保留預覽供複製。逾時不能證明未送達，應先檢查對話再重試。關閉或換檔會取消尚未完成的擷取並清除本機預覽，但不會撤回已送出的訊息。SDK／模擬宿主驗證與真正 ChatGPT 對話接收需分開記錄，不能只依橋接回覆宣稱模型已讀完全文。

`useWasm: false` 保持不變。PDF.js 6 的 CCITT／JBIG2 與 JPEG 2000 JavaScript fallback 由 `scripts/pdf-worker.mjs` 靜態打包，避免原本的動態 URL 載入在離線環境失敗後只留下文字層與白頁。建置會檢查上游載入程式形狀，變動時直接失敗，要求重新核對；未加入 `unsafe-eval` 或 `wasm-unsafe-eval`。CCITT 合成掃描已經像素回歸與瀏覽器驗證；其他編碼不因此視為完整相容性驗收。

MCP 具有 32 KiB 請求上限、巢狀深度 16、10 秒處理時限及每個 isolate 4 個同時請求上限。這些不是跨節點限流，也不是阻斷服務攻擊的保證。

## 大檔與縮放

500 MiB／5,000 頁是拒收上限，不是可流暢開啟的保證。大型或複雜文件仍可能耗用大量記憶體。顯示縮放目標為 25–600%；個別超大頁面的顯示尺寸另限寬 8,192／高 6,000 CSS px，實際可用倍率可能更低。畫布單軸上限 8,192 px；可見頁合計配置預算為 1,150 萬像素（從 1,200 萬預算預留 50 萬），最多 12 個可見／鄰頁。大倍率會降低點陣解析度，可能較模糊。

## 第三方授權

建置會保留依賴的授權全文並在網站 `/licenses` 提供：

- PDF.js：Apache-2.0；CMaps 另有 Adobe 的授權條件。
- PDFium／Foxit 標準字型：所附 PDFium Authors 三條款 BSD 文字。
- Liberation 字型：所附 GPL v2 及例外條款。散布字型時須保留原授權，不應將其改標成主程式的授權。
- 掃描影像解碼器：保留 PDFium／JBIG2／OpenJPEG 及 Mozilla wrapper 所附 BSD／Apache-2.0 原文。
- MCP 套件：以套件所附 LICENSE 為準，包含 Apache-2.0 遷移說明及仍適用 MIT 的既有貢獻；不是全部改為同一授權。
- Zod：MIT。

MCP 已打包的 `content-type` 程式碼另附完整 MIT 授權。各檔案、版本、建置路徑與字型散布注意事項見[第三方授權對照](third-party-licenses.md)。自有程式的授權不取代第三方條款；本次檢查不構成完整法律審查。
