# PROJECT STATUS - HDTC OCR Review

Cập nhật: 2026-06-10. Repo local chuẩn: `C:\Users\ADMIN\Documents\tool tự soạn hợp đồng thế chấp ngân hàng`.

## 1. Mục tiêu tổng thể

Xây dựng hệ thống tự động hóa hồ sơ hợp đồng thế chấp ngân hàng:

- Giai đoạn 1: nhận hồ sơ qua Google Form, OCR, bóc tách AI, review/sửa thủ công, xác nhận và lưu dữ liệu sạch.
- Giai đoạn 2: sau khi dữ liệu đã xác nhận, người dùng nhập thêm thông tin soạn thảo, chọn mẫu Word và hệ thống xuất DOCX từ bộ mẫu có sẵn.

Nguyên tắc chính: không tự bịa dữ liệu pháp lý; dữ liệu sửa thủ công ưu tiên cao nhất; OCR gốc phải được giữ để truy vết.

## 1A. Nguyen tac cot loi bat buoc giu khi sua code

- CCCD/Can cuoc mat truoc va mat sau chi duoc lien ket bang day so CCCD/Can cuoc co tren ca 2 mat hoac bang chung ro rang cung mot nguoi trong cung nhom upload. Khong ghep lan lon giua Ben bao dam va Ben duoc bao dam, khong ghep cheo giua nguoi nay voi nguoi khac, khong tim bua, khong lay "gan nhat" neu khong co bang chung.
- Khi lay ngay cap tu mat sau CCCD/Can cuoc, phai dam bao mat sau do thuoc dung so CCCD/Can cuoc/cung nguoi. Neu khong chac thi de trong hoac canh bao de sua tay.
- Voi mat sau CCCD co MRZ dong dau dang `IDVNM...`, bo qua phan chu cai va ky tu `<`, chi tinh phan so. Neu sau `IDVNM` co 22 so lien ke thi 10 so dau la thong tin khac, 12 so tiep theo la so CCCD/Can cuoc dung de khop voi mat truoc. Vi du `IDVNM0760027248001076002724<9` cho ra so CCCD `001076002724`.
- Quy tac MRZ CCCD ap dung chung cho moi nguoi trong ho so, khong phan biet Ben bao dam/Ben duoc bao dam; neu co 4-5 Ben bao dam thi van khop tung nguoi bang so CCCD/Can cuoc rieng, khong dung vi tri hay thu tu gan nhat.
- MRZ chi dung de khop dung nguoi; ngay cap van phai doc tu dong `Ngay, thang, nam / Date, month, year` ro rang. Neu OCR ngay cap hong thanh dang nhu `Oro712021`, `Or0712021` hoac khong du dinh dang ngay/thang/nam thi khong duoc suy dien, phai de `Khong ro, de nghi sua thu cong` hoac chay OCR fallback vung ngay cap.
- Review tai san bat dong san phai the hien dung noi dung tren bia dat/giay chung nhan, gom dau cham, dau phay, dau ngoac, dau muc I, II, 1, 2, a), b), c)... theo dung thu tu va cach ghi trong bia dat.
- Xuat hop dong: mau Word chi la khung trinh bay; phan mo ta tai san phai sinh theo cac truong thuc te doc duoc tren bia dat/giay chung nhan. Co truong nao thi ghi truong do, khong duoc bo qua chi vi mau khong co, va khong duoc them noi dung mau neu tren bia dat khong co.
- Nguon goc su dung dat, ghi chu/thay doi sau cap, tai san gan lien voi dat chi hien thi trong hop dong khi bia dat co noi dung thuc. Cac tieu de bang, chu ky, so vao so, dong `Chua chung nhan quyen so huu`, de trong, `-/-` hoac tuong tu khong duoc coi la noi dung mo ta thuc.
- Khi OCR bia dat co bo cuc khac thuong hoac mot muc bi xuong dong, phai uu tien tach theo chi muc muc/diem: II, 1, 2, a), b), c), d), đ), e), g). Noi dung cua mot muc keo dai den ngay truoc chi muc ke tiep. Vi du `b) Dia chi` phai lay ca dong tiep theo cho den truoc `c) Dien tich`, khong chi lay dong cuoi.
- Khong tu dien giai, khong rut gon, khong doi cach viet neu OCR/bia dat da co noi dung ro. Vi du dien tich co dong bang chu thi giu dang `88,7 m2 (Bang chu: Tam muoi tam phay bay met vuong)`, khong hien thanh `88,7 m2 Tam muoi tam phay bay met vuong`.
- Cac hang muc ve nha o, cong trinh xay dung, tai san khac gan lien voi dat neu bia dat ghi "Chua chung nhan quyen so huu", de trong, "-/-" hoac gia tri tuong tu thi khong can hien thi noi dung chi tiet ben duoi, neu co.
- Neu khong doc chac thong tin tren bia dat thi uu tien de trong/canh bao/sua tay, khong tu suy dien.

## 2. Công nghệ/framework đang dùng

- Google Apps Script V8.
- Google Form: form đầu vào chỉ còn email review và 3 nhóm upload hồ sơ.
- Google Sheets: database vận hành.
- Google Drive: lưu hồ sơ, OCR text, JSON, file DOCX đầu ra.
- Apps Script Web App: màn hình Review và màn hình soạn thảo/xuất hợp đồng.
- Google Cloud Vision OCR cho ảnh; Drive OCR/convert Google Docs cho PDF/Word/Google Docs.
- OpenAI Responses API để bóc tách OCR text thành JSON.
- Advanced Google Service: Drive API v2.
- `clasp` để push/deploy Apps Script từ local.
- Node/npm chỉ dùng cho tooling/phân tích file Word/Excel; project runtime chính nằm trên Apps Script.

## 3. Cấu trúc thư mục quan trọng

- `*.gs`: toàn bộ backend Apps Script.
- `Review.html`: frontend Web App Review/soạn thảo/xuất hợp đồng.
- `appsscript.json`: scopes, Drive advanced service, web app access.
- `.clasp.json`: liên kết tới Apps Script project thật.
- `README_GIAI_DOAN_1.md`: tài liệu giai đoạn 1 cũ, có nhiều đoạn lỗi encoding.
- `HUONG_DAN_LAM_VIEC_TREN_MAY_MOI.txt`: hướng dẫn setup máy mới.
- `.analysis/`: dữ liệu phân tích template Word/Excel, không push Git theo `.gitignore`.
- `node_modules/`: dependency local, không push Git.
- `docs/PROJECT_STATUS.md`: file trạng thái hiện tại cho session Codex mới.

Google Drive vận hành:

- Root hồ sơ: `/Hop_dong_the_chap/{CASE_ID}_{EMAIL}/`
- Subfolder case: `01_Uploaded_Files`, `02_OCR_Text`, `03_AI_JSON`, `04_Review_Data`, `05_Final_Data`, `06_Logs`, `07_Contract_Output`.
- Folder template Phase 2: `HDTC_Phase2_Templates`.

## 4. Các tính năng đã hoàn thành

- Tạo/cập nhật Google Form OCR-only: email review + upload Bên bảo đảm, Bên được bảo đảm, Tài sản.
- Trigger `onFormSubmit` tạo case, folder Drive, copy file upload, OCR, gọi AI, validate, gửi email Review.
- Review URL dùng token ngẫu nhiên; Web App deploy dạng `ANYONE_ANONYMOUS`, `executeAs USER_DEPLOYING`.
- OCR ảnh bằng Cloud Vision; PDF/Word/Google Docs dùng Drive OCR/convert fallback.
- Bóc tách AI sang schema JSON có `contract_info`, `secured_parties`, `obligors`, `assets`, `ocr_results`, `validation`, `review`, `manual_overrides`, `final_confirmed_data`.
- Merge người theo số CCCD/Căn cước; hỗ trợ 1 người nhiều mặt giấy tờ.
- Suy luận giới tính theo chữ số thứ 4 của số định danh 12 số.
- Chuẩn hóa loại giấy tờ: `Chứng minh nhân dân`, `Căn cước công dân`, `Căn cước`.
- Chuẩn hóa nơi cấp: CCCD thường là `Cục Cảnh sát quản lý hành chính về trật tự xã hội`; Căn cước là `Bộ Công an`.
- Review UI hiển thị ảnh bên trái và thông tin OCR/final bên phải; có nút sửa từng field, lưu manual override.
- Review UI đã có tab Bên bảo đảm, Bên được bảo đảm, Tài sản, OCR; tài sản bất động sản hiển thị theo format gần bìa đất.
- Sau xác nhận review, chuyển sang khu vực soạn thảo hợp đồng.
- Màn hình soạn thảo có các nhóm: thông tin hồ sơ, giá trị tài sản định giá, người ký, thông tin còn lại.
- `Loại tài sản` và `Loại hợp đồng` tự suy luận, hiển thị disabled.
- `Người ký` tự nhảy chức vụ; địa chỉ đơn vị tự nhảy nhưng cho sửa.
- Giá trị đất/nhà có format dấu chấm; tổng giá trị tự cộng.
- Template selection hiện theo hàng dọc; chỉ hiện sau khi lưu thông tin soạn thảo.
- Xuất DOCX và tạo link tải trực tiếp trên giao diện; vẫn gửi email nếu review email hợp lệ.
- Đã push/deploy Apps Script gần nhất: deployment `AKfycbyXkDTtk4PVPzjdCwy1duKEtbqJrNUHlbsF7TO_jTaMJ1JCCz8PJUf7vzerZijF1KyD @48`.
- GitHub private repo đang dùng: `thanhbinh231019911/HDTC-OCR-Review-Giai-doan-1`, branch `main`.

## 5. Các tính năng đang làm dở

- Phase 2 mới liên kết chắc chắn cho:
  - `03b_bds_ben_thu_ba`: đang thay dữ liệu vào mẫu Word 03b bằng code xử lý literal.
  - `17_uy_quyen_xu_ly_tai_san`: đang sinh bằng Apps Script document builder, không phải template Word gốc.
- Các mẫu còn lại đã có config/template nhưng `isTemplateMappingReady_()` đang chặn xuất để tránh file trắng:
  - `03a_bds_chinh_chu`
  - `03c_bds_ts_chua_chung_nhan_chinh_chu`
  - `03d_bds_ts_chua_chung_nhan_ben_thu_ba`
  - `02a_dong_san_chinh_chu`
  - `02b_dong_san_ben_thu_ba`
  - `bm05a_phieu_ban_giao_ho_so`
  - `bctd_mau_moi`
  - `bbdg_bds_mau_moi`
  - `mau01a_dktc`
  - `bbgn_tc`
- Mẫu 03b vẫn đang được tinh chỉnh theo phản hồi thực tế từ file Word xuất ra.
- Chưa có test tự động đầy đủ; chủ yếu test bằng submit case thật và xuất DOCX.

## 6. Lỗi hiện tại hoặc điểm cần kiểm tra

- Cần test lại mẫu 03b sau bản `@48`, đặc biệt:
  - Bà Linh/những người sau người thứ nhất có đủ `ngày cấp` trong dòng `Căn cước/CCCD số ... do ... cấp ngày ...` hay chưa.
  - Đơn vị quản lý khách hàng không còn lặp `Chi nhánh Hòa Bình`.
  - Dòng trống `-` sau `Thời hạn sử dụng` đã bị xóa.
  - Ghi chú/chuyển nhượng trên bìa đất không còn xuất nếu OCR không có.
  - Tên riêng được bôi đậm trong hợp đồng.
- Nếu ngày cấp vẫn thiếu: kiểm tra OCR text của mặt sau giấy tờ; fallback đang dò theo số giấy tờ trong `OCR_RESULTS`.
- Một số label trong `DataMergeService.gs` và `Config.gs` còn mojibake do lịch sử chỉnh encoding. Runtime nhiều chỗ vẫn dùng Unicode escape đúng, nhưng nên chuẩn hóa dần để UI không hiện `?`.
- `Config.gs` `DEFAULT_CONTRACT_TEMPLATES` có vài chuỗi asset/contract type bị mojibake; hiện UI/frontend có suy luận riêng, nhưng nên sửa khi dọn code.
- FormHandler vẫn ghi một số field cũ vào `RESPONSES` (`Asset Type`, `Contract Type`, `Bank Signer`, v.v.) dù Form hiện tại đã OCR-only; dữ liệu này có thể rỗng và không phải lỗi.
- Review email cũ đôi khi có dạng `, email@gmail.com`; `generateContractsForCase()` đã có `extractFirstValidEmail_()` để lấy email hợp lệ khi gửi hợp đồng.
- Google Form file upload không luôn tạo được bằng code Apps Script trong mọi context; nếu lỗi, cần sửa thủ công câu hỏi upload trong Google Form.
- Cloud Vision yêu cầu `CLOUD_VISION_API_KEY` và billing/API bật đúng project.

## 7. Các file quan trọng đã sửa

- `Config.gs`: cấu hình, sheet headers, template config mặc định, prompt extraction.
- `AdminSetup.gs`: menu setup, form OCR-only, trigger, diagnose/reprocess, setup templates.
- `FormHandler.gs`: pipeline submit form, map file upload theo group, gửi review email.
- `OCRService.gs`: Cloud Vision OCR cho ảnh, Drive OCR fallback, retry.
- `AIExtractionService.gs`: OpenAI Responses API, JSON schema.
- `DataMergeService.gs`: normalize/merge dữ liệu, gộp người theo CCCD, chuẩn hóa ngày/giới tính/giấy tờ/nơi cấp, asset extraction helpers.
- `ValidationService.gs`: missing/conflict/warning, lọc bớt cảnh báo nhiễu.
- `ReviewService.gs`: payload review, save override, confirm review, save draft info.
- `ReviewWebApp.gs`: API Web App.
- `Review.html`: UI review ảnh + dữ liệu; UI soạn thảo; chọn mẫu; tải DOCX.
- `ContractGenerationService.gs`: list template, setup template Drive, mapping/xuất DOCX, mẫu 03b, mẫu 17, signer profile.
- `CaseReprocess.gs`: diagnose/reprocess latest case.

## 8. Cách chạy project local

Project không chạy local như web app Node; local dùng để chỉnh Apps Script và push/deploy.

Setup máy mới:

```powershell
git clone https://github.com/thanhbinh231019911/HDTC-OCR-Review-Giai-doan-1.git
cd "HDTC-OCR-Review-Giai-doan-1"
npm install
npm install -g @google/clasp
clasp login
```

Kiểm tra project:

```powershell
clasp.cmd status
clasp.cmd push
```

Deploy lại Web App hiện tại:

```powershell
clasp.cmd deploy --deploymentId AKfycbyXkDTtk4PVPzjdCwy1duKEtbqJrNUHlbsF7TO_jTaMJ1JCCz8PJUf7vzerZijF1KyD --description "your description"
```

Kiểm tra cú pháp local:

```powershell
$tmp=Join-Path $env:TEMP 'ContractGenerationService.check.js'; Copy-Item 'ContractGenerationService.gs' $tmp -Force; node --check $tmp
$html=[System.IO.File]::ReadAllText('Review.html'); $m=[regex]::Match($html,'<script>([\s\S]*)</script>'); $tmp=Join-Path $env:TEMP 'review-script-check.js'; [System.IO.File]::WriteAllText($tmp,$m.Groups[1].Value,[System.Text.UTF8Encoding]::new($false)); node --check $tmp
```

Trong Google Sheets/App Script:

- Menu `HDTC OCR` có các hàm setup, check config, diagnose latest case, reprocess latest case, setup templates.
- Hàm quan trọng: `checkPhase1Configuration`, `runDiagnoseLatestCase`, `runReprocessLatestCase`, `setupPhase2Templates`, `setupPhase2Template03b`.

## 9. Biến môi trường / Script Properties cần có

Không lưu key trong repo. Apps Script dùng Script Properties, không phải `.env` runtime.

Bắt buộc:

- `OPENAI_API_KEY`: OpenAI API key.
- `CLOUD_VISION_API_KEY`: Google Cloud Vision API key nếu dùng `CONFIG.DEFAULT_OCR_ENGINE = 'CLOUD_VISION'`.

Nên có:

- `OPENAI_MODEL`: ví dụ `gpt-5.4-mini`. Nếu thiếu, dùng `CONFIG.OPENAI_MODEL_DEFAULT`.
- `REVIEW_WEB_APP_URL`: URL Web App deploy. Nếu thiếu, dùng `CONFIG.DEFAULT_REVIEW_WEB_APP_URL`.
- `FORM_ID`, `FORM_EDIT_URL`, `FORM_PUBLIC_URL`: do hàm tạo/cập nhật Form lưu.
- `CONTRACT_TEMPLATE_CONFIG_JSON`: cấu hình template doc IDs, do `setupPhase2TemplatesFromDriveFolder()` lưu.
- `TEST_OCR_FILE_ID`: dùng cho `OcrTest.gs` nếu cần test OCR riêng.

Local `.env` hiện không bắt buộc; nếu tạo để ghi chú key thì không commit vì `.gitignore` đã bỏ qua `.env*`.

## 10. Quy ước dữ liệu OCR và các trường chính

Field chuẩn có dạng:

```json
{
  "label": "Số CCCD",
  "ai_value": "",
  "form_value": "",
  "manual_value": "",
  "final_value": "",
  "source": "",
  "confidence": "",
  "confirmed": false
}
```

Ưu tiên dữ liệu:

1. `manual_value` từ màn hình Review.
2. `form_value` từ Form/draft info.
3. OCR/AI có confidence cao.
4. OCR/AI đã được user xác nhận.
5. Không có thì để trống/đánh dấu thiếu, không tự bịa.

Nhóm dữ liệu chính:

- `contract_info`: thông tin hợp đồng/draft, gồm `asset_type`, `contract_type`, `asset_count`, `valuation_land_amount`, `valuation_house_amount`, `valuation_total_amount`, `bank_signer`, `bank_signer_title`, `bank_unit_address`, `dispute_court`, `cif_customer`, `contract_date`, `contract_sequence`, `actual_asset_differs_from_certificate`, `actual_asset_difference_description`, `actual_house_asset`.
- `secured_parties[]`: bên bảo đảm/chủ tài sản.
- `obligors[]`: bên được bảo đảm/người có nghĩa vụ được bảo đảm.
- `assets[]`: tài sản bảo đảm.
- `ocr_results[]`: file OCR theo group `secured_party`, `obligor`, `asset`.
- `validation`: `missing_fields`, `conflicts`, `warnings`.
- `final_confirmed_data`: dữ liệu đã flatten để Phase 2 đọc.

Person fields chính:

- `full_name`, `date_of_birth`, `gender`, `nationality`
- `id_document_type`, `id_number`, `id_issue_date`, `id_issue_place`, `id_expiry_date`
- `permanent_address`, `origin_place`, `vneid_current_address`, `current_address_final`

Asset real estate fields chính:

- `asset_type`, `certificate_title`, `owner_name`, `owner_identity_summary`, `owner_id_document_type`, `owner_id_number`
- `real_estate.certificate_number`, `registry_number`, `issuing_authority`, `issue_date`
- `land_plot_number`, `map_sheet_number`, `land_address`, `area`
- `usage_form`, `usage_purpose`, `usage_term`
- `attached_assets`, `post_issue_changes`

Contract generation placeholders nằm chủ yếu trong `buildContractPlaceholderMap_()` và helpers `addPersonPlaceholders_()`, `addAssetPlaceholders_()`.

## 11. Việc cần làm tiếp theo theo thứ tự ưu tiên

1. Test lại case mới nhất trên Web App deploy `@48`: lưu thông tin soạn thảo, xuất mẫu `03b`, kiểm tra DOCX theo các lỗi đã nêu ở mục 6.
2. Nếu ngày cấp của người thứ 2 vẫn thiếu, lấy OCR text từ `OCR_RESULTS` của ảnh mặt sau tương ứng và sửa regex `extractIssueDateFromContractOcrText_()` / `extractIssueDateFromIdentityOcr_()`.
3. Sửa/chuẩn hóa các label mojibake còn trong `DataMergeService.gs`, `Config.gs`, `Review.html` bằng Unicode escape hoặc UTF-8 sạch.
4. Hoàn thiện mapping mẫu `03b` theo đúng mẫu Word của người dùng, tránh thay literal quá phụ thuộc vào text mẫu nếu có thể.
5. Chuyển mẫu `17` từ document builder sang dùng template Word gốc nếu người dùng yêu cầu giữ nguyên mẫu.
6. Liên kết tiếp các mẫu còn lại, mỗi mẫu xong mới thêm code vào `isTemplateMappingReady_()`.
7. Bổ sung test helper cho generation: tạo map từ một `caseId` cố định và log các placeholder quan trọng trước khi xuất DOCX.
8. Dọn `README_GIAI_DOAN_1.md` hoặc thay bằng tài liệu mới không lỗi encoding.
9. Nếu làm trên máy khác: clone GitHub, `npm install`, `clasp login`, `clasp status`; không dùng Google Drive sync làm nguồn code chính.
