# Há»‡ thá»‘ng OCR vÃ  Review dá»¯ liá»‡u há»£p Ä‘á»“ng tháº¿ cháº¥p - Giai Ä‘oáº¡n 1

Giai Ä‘oáº¡n 1 chá»‰ xá»­ lÃ½: nháº­n Google Form, upload há»“ sÆ¡, OCR, bÃ³c tÃ¡ch dá»¯ liá»‡u báº±ng AI, kiá»ƒm tra thiáº¿u/mÃ¢u thuáº«n/cáº£nh bÃ¡o, gá»­i link Review, cho sá»­a thá»§ cÃ´ng, xÃ¡c nháº­n vÃ  lÆ°u dá»¯ liá»‡u sáº¡ch. ChÆ°a sinh há»£p Ä‘á»“ng Word/PDF.

## 1. Kiáº¿n trÃºc tá»•ng thá»ƒ

CÃ¡c thÃ nh pháº§n:

- Google Form: nÆ¡i ngÆ°á»i dÃ¹ng nháº­p thÃ´ng tin ban Ä‘áº§u vÃ  upload há»“ sÆ¡.
- Google Sheets: database váº­n hÃ nh gá»“m RESPONSES, CASES, OCR_RESULTS, EXTRACTED_DATA, REVIEW_OVERRIDES, FINAL_DATA, AUDIT_LOGS.
- Google Drive: lÆ°u há»“ sÆ¡ upload, text OCR, JSON AI, JSON review, JSON final vÃ  log.
- Apps Script trigger `onFormSubmit`: Ä‘iá»u phá»‘i toÃ n bá»™ pipeline sau khi submit form.
- OCR service: máº·c Ä‘á»‹nh dÃ¹ng Google Drive OCR qua Advanced Drive Service; cÃ³ tÃ¹y chá»n Cloud Vision OCR cho áº£nh.
- OpenAI API: bÃ³c tÃ¡ch OCR text thÃ nh JSON cáº¥u trÃºc. Code dÃ¹ng Responses API vá»›i Structured Outputs JSON schema theo tÃ i liá»‡u OpenAI.
- Apps Script Web App: mÃ n hÃ¬nh Review cÃ³ token báº£o máº­t.
- MailApp: gá»­i link Review.

## 2. Workflow

```mermaid
flowchart TD
  A["NgÆ°á»i dÃ¹ng submit Google Form"] --> B["Apps Script onFormSubmit"]
  B --> C["Táº¡o mÃ£ há»“ sÆ¡ vÃ  folder Drive"]
  C --> D["Copy file upload vÃ o 01_Uploaded_Files"]
  D --> E["OCR tá»«ng file"]
  E --> F["LÆ°u OCR_RESULTS vÃ  02_OCR_Text"]
  F --> G["Gá»i OpenAI extraction"]
  G --> H["Merge dá»¯ liá»‡u theo Æ°u tiÃªn"]
  H --> I["Validate missing/conflicts/warnings"]
  I --> J["LÆ°u EXTRACTED_DATA vÃ  04_Review_Data"]
  J --> K["Gá»­i email link Review cÃ³ token"]
  K --> L["NgÆ°á»i dÃ¹ng má»Ÿ Web App Review"]
  L --> M["Sá»­a tá»«ng field náº¿u cáº§n"]
  M --> N["LÆ°u REVIEW_OVERRIDES vÃ  audit log"]
  L --> O["XÃ¡c nháº­n dá»¯ liá»‡u"]
  O --> P["LÆ°u FINAL_DATA vÃ  05_Final_Data JSON"]
```

## 3. Cáº¥u trÃºc Google Sheet

- `RESPONSES`: Timestamp, Case ID, Review Email, Sender Name, Sender Phone, Asset Type, Contract Type, Asset Count, Bank Signer, Dispute Court, Valuation Amount, Manual Merged Address, Notes, Raw Form JSON.
- `CASES`: Case ID, Review Email, Status, Drive Folder URL, Review URL, Review Token Hash, Created At, OCR Done At, Email Sent At, Review Confirmed At, Last Error.
- `OCR_RESULTS`: Case ID, File Name, File ID, File Type, OCR Text, OCR Status, Confidence, OCR Text File URL, Created At.
- `EXTRACTED_DATA`: Case ID, JSON Data, Validation Status, Missing Fields, Conflicts, Warnings, AI JSON File URL, Created At.
- `REVIEW_OVERRIDES`: Case ID, Field Path, Field Label, Old Value, New Value, Edited By, Edited At, Reason.
- `FINAL_DATA`: Case ID, Final JSON, Review Status, Confirmed By, Confirmed At, Final JSON File URL.
- `AUDIT_LOGS`: Case ID, Action, Detail, User, Timestamp.

Cháº¡y hÃ m `setupSpreadsheet()` má»™t láº§n Ä‘á»ƒ táº¡o cÃ¡c sheet vÃ  header.

## 4. Cáº¥u trÃºc Google Drive

Vá»›i má»—i há»“ sÆ¡:

```text
/Hop_dong_the_chap/
  /{{MA_HO_SO}}_{{TEN_NGUOI_GUI}}/
    /01_Uploaded_Files/
    /02_OCR_Text/
    /03_AI_JSON/
    /04_Review_Data/
    /05_Final_Data/
    /06_Logs/
    /07_Contract_Output/
```

`07_Contract_Output` Ä‘Æ°á»£c táº¡o sáºµn cho giai Ä‘oáº¡n 2 nhÆ°ng chÆ°a dÃ¹ng á»Ÿ giai Ä‘oáº¡n 1.

## 5. JSON schema dá»¯ liá»‡u lÆ°u

Schema váº­n hÃ nh chÃ­nh náº±m trong `reviewJson`:

```json
{
  "schema_version": "1.0.0",
  "case_id": "HDTC-...",
  "contract_info": {
    "contract_type": {
      "label": "Loáº¡i há»£p Ä‘á»“ng",
      "ai_value": "",
      "form_value": "",
      "manual_value": "",
      "final_value": "",
      "source": "FORM",
      "confidence": "",
      "confirmed": false
    }
  },
  "secured_parties": [],
  "obligors": [],
  "assets": [],
  "ocr_results": [],
  "validation": {
    "status": "OK|HAS_ISSUES|PENDING",
    "missing_fields": [],
    "conflicts": [],
    "warnings": []
  },
  "review": {
    "status": "PENDING_REVIEW|REVIEW_CONFIRMED|REVIEW_CONFIRMED_WITH_WARNINGS",
    "review_url": "",
    "token_hash": "",
    "sent_at": "",
    "confirmed_by": "",
    "confirmed_at": ""
  },
  "manual_overrides": [],
  "audit_logs": [],
  "final_confirmed_data": {}
}
```

Má»i field quan trá»ng dÃ¹ng object chuáº©n:

```json
{
  "label": "Sá»‘ CCCD",
  "ai_value": "001...",
  "form_value": "",
  "manual_value": "",
  "final_value": "001...",
  "source": "cccd_front.jpg",
  "confidence": 0.92,
  "confirmed": false
}
```

`final_confirmed_data` lÃ  pháº§n giai Ä‘oáº¡n 2 sáº½ Ä‘á»c trá»±c tiáº¿p. Má»—i thÃ´ng tin váº«n giá»¯:

- `final_value`: giÃ¡ trá»‹ Ä‘Æ°a vÃ o há»£p Ä‘á»“ng.
- `source`: MANUAL, FORM hoáº·c OCR_AI.
- `original_ai_value`, `form_value`, `manual_value`: phá»¥c vá»¥ truy váº¿t.
- `confidence`: náº¿u cÃ³.

## 6. Prompt AI extraction

Prompt náº±m trong `Config.gs`, hÃ m `getAiExtractionPrompt()`. NguyÃªn táº¯c chÃ­nh:

- Chá»‰ tráº£ JSON theo schema.
- KhÃ´ng tá»± bá»‹a dá»¯ liá»‡u.
- KhÃ´ng tá»± sá»­a tÃªn ngÆ°á»i, sá»‘ CCCD, sá»‘ giáº¥y chá»©ng nháº­n, sá»‘ thá»­a, sá»‘ khung, sá»‘ mÃ¡y.
- CÃ³ cÄƒn cá»© thÃ¬ ghi source file vÃ  evidence.
- MÃ¢u thuáº«n Ä‘Æ°a vÃ o `conflicts`.
- OCR khÃ´ng cháº¯c Ä‘Æ°a vÃ o `warnings`.
- VNeID khÃ¡c CCCD thÃ¬ ghi cáº£nh bÃ¡o Ä‘á»ƒ ngÆ°á»i dÃ¹ng xÃ¡c nháº­n.

Schema Structured Outputs náº±m trong `AIExtractionService.gs`, hÃ m `getExtractionJsonSchema_()`.

## 7. CÃ¡c file Apps Script

- `Config.gs`: cáº¥u hÃ¬nh, tÃªn field Google Form, tÃªn sheet, tráº¡ng thÃ¡i, prompt AI.
- `FormHandler.gs`: trigger nháº­n submit, táº¡o case, gá»i toÃ n bá»™ pipeline.
- `DriveService.gs`: táº¡o folder, copy file upload, lÆ°u text/JSON.
- `OCRService.gs`: OCR báº±ng Drive OCR hoáº·c Cloud Vision OCR.
- `AIExtractionService.gs`: gá»i OpenAI API vÃ  parse JSON.
- `DataMergeService.gs`: chuáº©n hÃ³a AI JSON, gá»™p ngÆ°á»i theo CCCD, Æ°u tiÃªn dá»¯ liá»‡u form/manual, táº¡o `final_value`.
- `ValidationService.gs`: kiá»ƒm tra trÆ°á»ng thiáº¿u, mÃ¢u thuáº«n, confidence tháº¥p.
- `ReviewService.gs`: Ä‘á»c dá»¯ liá»‡u Review, lÆ°u sá»­a thá»§ cÃ´ng, xÃ¡c nháº­n dá»¯ liá»‡u.
- `ReviewWebApp.gs`: endpoint Web App `doGet` vÃ  `doPost`.
- `EmailService.gs`: gá»­i email link Review.
- `AuditLogService.gs`: ghi log.
- `SheetService.gs`: táº¡o sheet, append/update/read.
- `Utils.gs`: tiá»‡n Ã­ch token, hash, retry, path, JSON.
- `Review.html`: giao diá»‡n Review.
- `AdminSetup.gs`: menu quáº£n trá»‹, táº¡o Form máº«u, setup Sheet/trigger vÃ  kiá»ƒm tra cáº¥u hÃ¬nh.

## 8. HÆ°á»›ng dáº«n táº¡o Google Form

Táº¡o Google Form cÃ³ Ä‘Ãºng tÃªn cÃ¢u há»i sau Ä‘á»ƒ Apps Script Ä‘á»c Ä‘Æ°á»£c:

1. Email ngÆ°á»i nháº­n link Review
2. Há» tÃªn ngÆ°á»i gá»­i há»“ sÆ¡
3. Sá»‘ Ä‘iá»‡n thoáº¡i ngÆ°á»i gá»­i há»“ sÆ¡
4. Loáº¡i tÃ i sáº£n: Báº¥t Ä‘á»™ng sáº£n, Äá»™ng sáº£n
5. Loáº¡i há»£p Ä‘á»“ng: BÃªn báº£o Ä‘áº£m tháº¿ cháº¥p cho chÃ­nh nghÄ©a vá»¥ cá»§a mÃ¬nh, BÃªn báº£o Ä‘áº£m tháº¿ cháº¥p cho nghÄ©a vá»¥ cá»§a bÃªn thá»© ba
6. Sá»‘ lÆ°á»£ng tÃ i sáº£n báº£o Ä‘áº£m
7. NgÆ°á»i kÃ½ há»£p Ä‘á»“ng táº¡i ngÃ¢n hÃ ng: Ã”ng A, Ã”ng B, Ã”ng C, BÃ  D
8. TÃ²a Ã¡n xá»­ lÃ½ tranh cháº¥p: TÃ²a khu vá»±c A, TÃ²a khu vá»±c B
9. GiÃ¡ trá»‹ Ä‘á»‹nh giÃ¡
10. Äá»‹a chá»‰ má»›i sau sÃ¡p nháº­p náº¿u ngÆ°á»i dÃ¹ng muá»‘n nháº­p thá»§ cÃ´ng
11. Ghi chÃº bá»• sung
12. Upload há»“ sÆ¡ BÃªn báº£o Ä‘áº£m/chá»§ tÃ i sáº£n
13. Upload há»“ sÆ¡ BÃªn Ä‘Æ°á»£c báº£o Ä‘áº£m
14. Upload há»“ sÆ¡ tÃ i sáº£n

Ba cÃ¢u há»i upload pháº£i báº­t cho phÃ©p nhiá»u file. Loáº¡i file: áº£nh, PDF, Word.

Sau Ä‘Ã³ liÃªn káº¿t Form vá»›i Google Sheet pháº£n há»“i. Apps Script nÃªn gáº¯n trong Sheet pháº£n há»“i Ä‘Ã³.

## 9. HÆ°á»›ng dáº«n cáº¥u hÃ¬nh Apps Script

1. Má»Ÿ Google Sheet pháº£n há»“i.
2. Extensions > Apps Script.
3. Táº¡o cÃ¡c file `.gs` vÃ  `Review.html` tÆ°Æ¡ng á»©ng, copy ná»™i dung tá»« workspace nÃ y.
4. Báº­t Advanced Google Services: Drive API.
5. VÃ o Google Cloud project liÃªn káº¿t Apps Script, báº­t Google Drive API.
6. Cháº¡y `setupPhase1()` Ä‘á»ƒ táº¡o sheet quáº£n lÃ½, Google Form máº«u vÃ  trigger submit form.
7. Náº¿u khÃ´ng muá»‘n táº¡o Form tá»± Ä‘á»™ng, cháº¡y riÃªng `setupSpreadsheet()` vÃ  `installFormSubmitTrigger()`.

Sau khi reload Google Sheet, menu `HDTC OCR` sáº½ xuáº¥t hiá»‡n Ä‘á»ƒ cháº¡y láº¡i tá»«ng bÆ°á»›c setup vÃ  kiá»ƒm tra cáº¥u hÃ¬nh.

## 10. Cáº¥u hÃ¬nh API key

KhÃ´ng hard-code API key trong code.

VÃ o Apps Script > Project Settings > Script properties:

- `OPENAI_API_KEY`: API key OpenAI.
- `OPENAI_MODEL`: model muá»‘n dÃ¹ng, vÃ­ dá»¥ `gpt-5.4-mini`. Náº¿u khÃ´ng Ä‘áº·t, code dÃ¹ng default trong `Config.gs`.
- `REVIEW_WEB_APP_URL`: URL Web App sau khi deploy.
- Code hiá»‡n Ä‘Ã£ cÃ³ `DEFAULT_REVIEW_WEB_APP_URL` trá» tá»›i deployment Ä‘Ã£ táº¡o báº±ng clasp. Chá»‰ cáº§n Ä‘áº·t `REVIEW_WEB_APP_URL` náº¿u báº¡n deploy láº¡i vÃ  muá»‘n Ã©p dÃ¹ng URL má»›i.
- `CLOUD_VISION_API_KEY`: chá»‰ cáº§n náº¿u Ä‘á»•i `DEFAULT_OCR_ENGINE` sang `CLOUD_VISION`.

Ghi chÃº OpenAI: code dÃ¹ng Responses API vÃ  `text.format.type = "json_schema"`. Theo tÃ i liá»‡u OpenAI, Structured Outputs giÃºp model tráº£ vá» JSON bÃ¡m schema tá»‘t hÆ¡n JSON mode, vÃ  Responses API há»— trá»£ cáº¥u hÃ¬nh output text dáº¡ng JSON schema.

Nguá»“n tham kháº£o chÃ­nh thá»©c:

- [Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [Responses API Reference](https://platform.openai.com/docs/api-reference/responses/create)

## 11. Deploy Web App Review

1. Apps Script > Deploy > New deployment.
2. Chá»n Web app.
3. Execute as: Me.
4. Who has access: tÃ¹y chÃ­nh sÃ¡ch ná»™i bá»™. Náº¿u ngÆ°á»i review á»Ÿ ngoÃ i domain, chá»n Anyone with the link. Token váº«n Ä‘Æ°á»£c kiá»ƒm tra trong code.
5. Deploy vÃ  copy Web App URL.
6. LÆ°u URL vÃ o Script property `REVIEW_WEB_APP_URL`.
7. Deploy láº¡i náº¿u thay code.

## 12. HÆ°á»›ng dáº«n test thá»­

Checklist test tá»‘i thiá»ƒu:

1. Cháº¡y `setupSpreadsheet()` vÃ  kiá»ƒm tra Ä‘á»§ 7 sheet.
2. Deploy Web App, lÆ°u `REVIEW_WEB_APP_URL`.
3. Cháº¡y `installFormSubmitTrigger()`.
4. Submit form vá»›i 1 CCCD áº£nh rÃµ, 1 giáº¥y chá»©ng nháº­n hoáº·c Ä‘Äƒng kÃ½ xe.
5. Kiá»ƒm tra `CASES` cÃ³ mÃ£ há»“ sÆ¡ vÃ  tráº¡ng thÃ¡i `REVIEW_SENT`.
6. Kiá»ƒm tra Drive cÃ³ folder Ä‘Ãºng cáº¥u trÃºc.
7. Kiá»ƒm tra `OCR_RESULTS` cÃ³ OCR text.
8. Kiá»ƒm tra `EXTRACTED_DATA` cÃ³ JSON.
9. Má»Ÿ email Review.
10. Sá»­a má»™t field, kiá»ƒm tra `REVIEW_OVERRIDES` vÃ  `AUDIT_LOGS`.
11. Báº¥m xÃ¡c nháº­n dá»¯ liá»‡u, kiá»ƒm tra `FINAL_DATA` vÃ  file JSON trong `05_Final_Data`.
12. Kiá»ƒm tra link sai token khÃ´ng truy cáº­p Ä‘Æ°á»£c.

## 13. Lá»—i thÆ°á»ng gáº·p vÃ  cÃ¡ch sá»­a

- `Missing script property OPENAI_API_KEY`: thÃªm API key vÃ o Script properties.
- `Missing review URL`: deploy Web App vÃ  lÆ°u `REVIEW_WEB_APP_URL`.
- `Drive is not defined`: báº­t Advanced Google Services > Drive API vÃ  báº­t Google Drive API trong Google Cloud project.
- OCR PDF/áº£nh rá»—ng: file scan quÃ¡ má», bá»‹ xoay, hoáº·c Drive OCR khÃ´ng Ä‘á»c tá»‘t; thá»­ Cloud Vision OCR cho áº£nh.
- KhÃ´ng nháº­n file upload: tÃªn cÃ¢u há»i Google Form khÃ´ng khá»›p `CONFIG.FORM_FIELDS`.
- Email khÃ´ng gá»­i: kiá»ƒm tra quyá»n MailApp, quota Gmail/Apps Script, email nháº­n cÃ³ há»£p lá»‡ khÃ´ng.
- Web App bÃ¡o token sai: link bá»‹ copy thiáº¿u query `caseId` hoáº·c `token`, hoáº·c Ä‘Ã£ Ä‘á»•i row `Review Token Hash`.
- OpenAI tráº£ lá»—i schema/model: Ä‘á»•i `OPENAI_MODEL` sang model há»— trá»£ Structured Outputs hoáº·c dÃ¹ng schema Ã­t nghiÃªm ngáº·t hÆ¡n.
- Review xÃ¡c nháº­n nhÆ°ng váº«n cÃ³ cáº£nh bÃ¡o: náº¿u cÃ²n `missing_fields` hoáº·c `conflicts` vÃ  ngÆ°á»i dÃ¹ng xÃ¡c nháº­n tiáº¿p, tráº¡ng thÃ¡i sáº½ lÃ  `REVIEW_CONFIRMED_WITH_WARNINGS`.

## 14. Quy táº¯c Æ°u tiÃªn dá»¯ liá»‡u Ä‘Ã£ triá»ƒn khai

Thá»© tá»± Æ°u tiÃªn khi táº¡o `final_value`:

1. `manual_value` tá»« mÃ n hÃ¬nh Review.
2. `form_value` tá»« Google Form.
3. `ai_value` tá»« OCR/AI.
4. Náº¿u khÃ´ng cÃ³ dá»¯ liá»‡u thÃ¬ Ä‘á»ƒ trá»‘ng vÃ  Ä‘Æ°a vÃ o validation náº¿u lÃ  field quan trá»ng.

OCR gá»‘c luÃ´n Ä‘Æ°á»£c giá»¯ trong `OCR_RESULTS` vÃ  file text trong Drive. Sá»­a thá»§ cÃ´ng chá»‰ ghi thÃªm vÃ o `REVIEW_OVERRIDES`.

## 15. Pháº§n Ä‘á»ƒ sang giai Ä‘oáº¡n 2

CÃ¡c pháº§n sau chÆ°a lÃ m trong giai Ä‘oáº¡n 1:

- Map `final_confirmed_data` vÃ o máº«u há»£p Ä‘á»“ng Word/Google Docs.
- Thay placeholder trong máº«u há»£p Ä‘á»“ng.
- Sinh file Word/PDF.
- LÆ°u há»£p Ä‘á»“ng Ä‘áº§u ra vÃ o `07_Contract_Output`.
- Gá»­i há»£p Ä‘á»“ng Ä‘Ã£ sinh cho ngÆ°á»i dÃ¹ng/ngÃ¢n hÃ ng.


