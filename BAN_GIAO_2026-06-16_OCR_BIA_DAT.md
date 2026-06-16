# Bàn giao công việc OCR bìa đất - 2026-06-16

## Trạng thái hiện tại

- Project local: `C:\Users\Administrator\Documents\HDTC-OCR-Review-Giai-doan-1`
- Apps Script project đã push source bằng `npx.cmd clasp push --force`.
- Web app review hiện tại đã được cập nhật đúng deployment cũ:
- Deployment ID: `AKfycbyXkDTtk4PVPzjdCwy1duKEtbqJrNUHlbsF7TO_jTaMJ1JCCz8PJUf7vzerZijF1KyD`
- Version đang chạy: `@89`
- Mô tả version: `land certificate OCR review fixes`
- Không tạo deployment/web app mới.
- Git đã commit và push lên `origin/main`.
- Commit sửa chính: `e68e588` - `Fix land certificate OCR review and lab training`.

## Kiểm tra đã chạy

- `npx.cmd clasp status`: các file Apps Script cần chạy đã được clasp track, gồm `LabTraining.gs`.
- `node --check` cho `DataMergeService.gs`: OK.
- `node --check` cho script trong `Review.html`: OK.
- `npx.cmd clasp deployments`: deployment review chính đang trỏ `@89`.

## File đã thay đổi

- `AdminSetup.gs`
  - Thêm menu/chức năng quản trị lab training, show URL, check properties, recover production form.

- `Config.gs`
  - Thêm cấu hình/sheet phục vụ lab training OCR.

- `LabTraining.gs`
  - File mới.
  - Tạo 2 form lab: CCCD và bìa đất.
  - Cài trigger lab dùng chung pipeline OCR/review thật.
  - Có fallback nếu Google Form không cho tạo câu hỏi File Upload bằng code.

- `DataMergeService.gs`
  - Sửa parser bìa đất.
  - Tách lại `Số GCN` và `Số vào sổ`.
  - Nếu `Số vào sổ` bị nhận nhầm dạng số GCN thì xóa/cảnh báo.
  - Chuẩn hóa diện tích thành `m²`.
  - Đọc lại các mục `a/b/c/d/đ/e/g` trong phần thửa đất.
  - Bổ sung đọc `IV. Những thay đổi sau khi cấp Giấy chứng nhận`.
  - Nếu mục IV có chữ viết tay/mờ và OCR chỉ đọc được một phần thì thêm cảnh báo kiểm tra kỹ.

- `ReviewService.gs`
  - Khi mở review, chạy thêm các hàm repair từ OCR full text:
    - số GCN/số vào sổ
    - diện tích
    - mục IV sau cấp giấy

- `Review.html`
  - Review bìa đất hiển thị đủ:
    - `4. Rừng sản xuất là rừng trồng`
    - `5. Cây lâu năm`
    - `6. Ghi chú`
    - `IV. Những thay đổi sau khi cấp Giấy chứng nhận`
  - Diện tích hiển thị chuẩn `m²`.
  - Nếu mục IV không có dữ liệu: hiển thị `Không có`.
  - Nếu có dữ liệu đọc được: hiển thị nội dung OCR đọc được.
  - Nếu có dấu hiệu mờ/đọc một phần: hiển thị cảnh báo kiểm tra kỹ.

- `tools/ocr-skill-lab/server.js`
  - Có chỉnh nhỏ phục vụ lab local.

## Lý do lỗi đã xử lý

- Lỗi không chỉ do môi trường lab. Phần chính là code parser/merge chưa đủ chặt:
  - `Số GCN` và `Số vào sổ` có dạng gần nhau, OCR dễ lẫn.
  - Các mục trên bìa đất có thể nằm cùng dòng hoặc bị OCR nối dòng, regex cũ bắt sai ranh giới.
  - Review chỉ hiển thị một phần cấu trúc giấy chứng nhận, nên các mục 4-5-6 và mục IV không có chỗ kiểm tra.
  - Chữ viết tay ở mục IV không thể đảm bảo đọc đúng 100%, nên phải hiển thị kèm cảnh báo khi chất lượng thấp.

## Cách tiếp tục ở máy khác

1. Mở đúng thư mục project:

   ```powershell
   cd C:\Users\Administrator\Documents\HDTC-OCR-Review-Giai-doan-1
   ```

2. Kiểm tra trạng thái:

   ```powershell
   git status --short
   npx.cmd clasp deployments
   npx.cmd clasp status
   ```

3. Nếu cần chỉnh Apps Script:

   ```powershell
   npx.cmd clasp pull
   ```

   Chỉ pull khi chắc chắn muốn đồng bộ từ Apps Script về local. Nếu local đang có sửa mới chưa commit, đọc diff trước để tránh ghi đè.

4. Sau khi sửa code:

   ```powershell
   npx.cmd clasp push --force
   ```

5. Nếu sửa `Review.html` hoặc code web app cần người dùng nhìn thấy ngay trên link review:

   ```powershell
   npx.cmd clasp version "mo ta thay doi"
   npx.cmd clasp deploy -i AKfycbyXkDTtk4PVPzjdCwy1duKEtbqJrNUHlbsF7TO_jTaMJ1JCCz8PJUf7vzerZijF1KyD -V <version> -d "mo ta thay doi"
   ```

   Không tạo deployment mới nếu không có yêu cầu rõ ràng.

## Nguyên tắc làm việc người dùng yêu cầu

- Trước khi sửa code: nêu nguyên nhân, nêu hướng khắc phục, chờ người dùng đồng ý.
- Khi đã được đồng ý thì sửa hẹp, không làm nhiễu code gốc.
- Với project này, người dùng muốn dùng Chrome profile `1412`. Trước đó mở Chrome bằng profile sai gây nhảy profile mới, cần tránh.
- Không rollback tùy tiện. Nếu cần rollback phải nói rõ file/version và xin xác nhận.

## Lưu ý quan trọng

- Script Properties từng bị xóa do dùng `setProperties(..., true)`. Đã sửa để không xóa properties cũ.
- Các properties cần còn tồn tại:
  - `OPENAI_API_KEY`
  - `CLOUD_VISION_API_KEY`
  - `REVIEW_WEB_APP_URL`
  - `FORM_ID`
  - `LAB_CCCD_FORM_ID`
  - `LAB_LAND_FORM_ID`
- Production `FORM_ID` đã từng recover:
  - `11MW9u13k_bX9aVXBAK6X7CoTkeS5dNAtyI2tc2QeL8`
- Không để lab training ghi đè hoặc xóa form production.

## Việc nên test tiếp

- Submit lại case bìa đất gồm `bia 1.jpg` và `bia 1-1.jpg`.
- Kiểm tra trên review:
  - `Số GCN` phải là `CO402507`.
  - `Số vào sổ` không được lấy nhầm `CO402507`; nếu OCR không đọc được dòng sổ thì để trống/cảnh báo.
  - Diện tích hiển thị `108,0 m²`.
  - `Hình thức sử dụng`: chỉ là `Sử dụng riêng`.
  - `Mục đích sử dụng`: `Đất ở tại nông thôn`.
  - `Thời hạn sử dụng`: `Lâu dài`.
  - `Nguồn gốc sử dụng`: không bị mất cuối câu nếu OCR có đủ text.
  - Mục `4/5/6` hiển thị dù không có thông tin.
  - Mục `IV` hiển thị `Không có`, nội dung đọc được, hoặc cảnh báo mờ tùy ảnh.

## Trạng thái Git cuối phiên

- Source Apps Script đã upload.
- Review web app chính đã chạy version `@89`.
- GitHub đã nhận commit sửa chính `e68e588`.
- Sau khi cập nhật nội dung bàn giao này, có thể có thêm một commit nhỏ chỉ để cập nhật file bàn giao. Máy mới chỉ cần `git pull origin main`.
- Nếu kiểm tra lại bằng `git status --short`, working tree nên sạch.
