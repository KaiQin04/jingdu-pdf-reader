# 第三方授權

本專案自有程式採 [MIT](../LICENSE)；不重新授權第三方程式、字型或資料。以下對照以 `package-lock.json` 與本次全新 `npm ci` 的實際檔案為準。

| 元件／來源 | 適用文字 | 倉庫內完整授權 |
| --- | --- | --- |
| PDF.js `pdfjs-dist@6.4.299` | Apache-2.0 | [PDFJS-LICENSE](../licenses/PDFJS-LICENSE) |
| 同套件 CMaps | Adobe CMap 授權 | [CMAPS-LICENSE](../licenses/CMAPS-LICENSE) |
| 同套件 Foxit `.pfb` 字型（取自 PDFium） | PDFium Authors 三條款 BSD | [FONT-LICENSE-FOXIT](../licenses/FONT-LICENSE-FOXIT) |
| 同套件 Liberation Sans `.ttf` 字型，1.07.4 | GPLv2，加字型嵌入與實體產品例外 | [FONT-LICENSE-LIBERATION](../licenses/FONT-LICENSE-LIBERATION) |
| 同套件 CCITT／JBIG2 JavaScript 解碼器 | PDFium BSD 及 Apache-2.0；Mozilla wrapper 為 Apache-2.0 | [JBIG2-LICENSE](../licenses/JBIG2-LICENSE)、[PDFJS-JBIG2-LICENSE](../licenses/PDFJS-JBIG2-LICENSE) |
| 同套件 OpenJPEG JavaScript 解碼器 | 所附 OpenJPEG BSD 及 Mozilla BSD 文字 | [OPENJPEG-LICENSE](../licenses/OPENJPEG-LICENSE)、[PDFJS-OPENJPEG-LICENSE](../licenses/PDFJS-OPENJPEG-LICENSE) |
| MCP client／core／server `2.4.0`、node `2.1.2`、ext-apps `2.0.4` | 所附 Apache-2.0 遷移說明及未取得重新授權同意之 MIT 貢獻 | [client](../licenses/MCP-CLIENT-LICENSE)、[core](../licenses/MCP-CORE-LICENSE)、[server](../licenses/MCP-SERVER-LICENSE)、[node](../licenses/MCP-NODE-LICENSE)、[ext-apps](../licenses/MCP-EXT-APPS-LICENSE) |
| Zod `4.6.7` | MIT | [ZOD-LICENSE](../licenses/ZOD-LICENSE) |
| MCP 預打包程式中的 `content-type` | MIT；上游 bundle 的 notices 未標示獨立版本 | [CONTENT-TYPE-LICENSE](../licenses/CONTENT-TYPE-LICENSE) |

原有 10 份授權與本次安裝的對應套件檔案逐位元相同，未修改。MCP ext-apps 的套件 metadata／鎖檔仍標示 MIT，但隨附 LICENSE 含遷移說明；此處保留完整原文，不用單一標籤取代。

掃描影像空白修正另外保留鎖定套件內 4 份解碼器授權全文，逐位元複製，並納入建置後 `/licenses`。`scripts/pdf-worker.mjs` 將上游 Worker 的動態解碼器載入改成建置時靜態匯入；解碼器內容未修改，不需要外部下載或 WASM 編譯。這是建置轉接，不宣稱原封不動散布整份 Worker。

`scripts/build.mjs` 會將上述元件的授權、自有程式 MIT 文字及 esbuild 產生的 `THIRD-PARTY-NOTICES.txt` 放進 `dist/licenses/`、`dist/documents.json`。Worker 的 `/licenses` 可讀取全文，`npm test` 會核對建置後路由包含這些完整文字。依賴本身與產物不提交至本倉庫；本次只發布來源與合成 fixtures。開發／測試工具沒有打包進閱讀器。

`content-type` 授權補自[上游 LICENSE](https://github.com/jshttp/content-type/blob/v1.0.5/LICENSE)，對應 bundle 保留的 2015 Douglas Christopher Wilson 版權聲明；未將該 tag 推定為 MCP 內嵌版本。

PDF.js 的[同版本字型來源說明](https://github.com/mozilla/pdf.js/blob/v6.4.299/external/standard_fonts/README.md)確認 Liberation Sans 為未修改的 1.07.4，不能改套 Liberation 2.x 的 OFL。字型嵌入例外描述的是使用字型的文件，不能據此推論任意軟體 bundle 免除 GPLv2 的其他義務。若日後另行散布含字型的 bundle／實體產品，仍須評估字型對應來源、取得及修改／重新安裝方式等適用條件；本次保留全文與上游來源，未對所有散布情境作完整法律審查。
