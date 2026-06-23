# Ban giao OCR bia dat - 2026-06-23

## 1. Muc dich tai lieu

Tai lieu nay dung de mo mot Codex session moi va tiep tuc project OCR HDTC ma khong can doc lai toan bo lich su chat.

Session moi can doc theo thu tu:

1. `HANDOFF_OCR_BIA_DAT_2026-06-23.md`
2. `skills/ocr-bia-dat/SKILL.md`
3. `skills/ocr-bia-dat/references/core-rules.md`
4. Code lien quan trong `OCRService.gs`, `DataMergeService.gs`, `ReviewService.gs`, `Review.html`
5. Test trong `tools/land_ocr_regression_test.js`

Khong sua OCR bia dat truoc khi doc het ba tai lieu dau.

## 2. Trang thai repository va trien khai

- Repository: `HDTC-OCR-Review-Giai-doan-1`
- Branch: `main`
- GitHub da dong bo: co
- Commit ban giao: `aeca2c3 Stabilize A4 land field crop persistence`
- Web App deployment ID: `AKfycbyXkDTtk4PVPzjdCwy1duKEtbqJrNUHlbsF7TO_jTaMJ1JCCz8PJUf7vzerZijF1KyD`
- Web App version dang chay: `141`
- Rollback tag truoc dot sua hinh hoc lon: `backup-before-geometry-ocr-20260622`
- Rollback tag som hon: `backup-before-general-a4-field-crops-20260622`
- Test hien tai: `npm run test:land-ocr` -> OK
- Working tree tai thoi diem ban giao: sach, `main` dong bo `origin/main`

Lenh kiem tra nhanh:

```powershell
git status --short --branch
npm.cmd run test:land-ocr
npx.cmd clasp deployments
```

## 3. Nguyen tac lam viec bat buoc

1. Ton trong noi dung va bo cuc Giay chung nhan o muc cao nhat.
2. Khong suy luan, khong dien them noi dung khong co tren bia.
3. Khong hard-code gia tri cua mot case.
4. Case moi phat sinh phai lam giau quy tac tong quat, khong ghi de hoac pha quy tac case cu.
5. Logic dac thu cua truong nao chi duoc tac dong truong do.
6. Sua lon phai co diem rollback, test lai case cu va case moi.
7. Phai neu nguyen nhan va huong sua truoc neu nguoi dung yeu cau trao doi truoc khi lam.
8. Ket qua crop tap trung da xac minh co uu tien cao hon OCR toan trang.
9. Chinh sua that cua nguoi dung co uu tien tuyet doi; OCR tu dong khong duoc ghi de.
10. Khong override rieng mot case trong production.

## 4. Ba loai mau Giay chung nhan

Phan loai theo ten loai Giay chung nhan OCR doc duoc, khong theo ten file.

### 4.1. `gcn_qsdd`

Ten: `Giay chung nhan quyen su dung dat`.

- Mau cu nhat, bia do, vi du user goi la `bia mua`.
- Thuong co bo cuc cu, noi dung dat va thay doi co the nam tren trang viet tay/bang.
- Page class: `gcn_qsdd_cover`, `gcn_qsdd_land`, `gcn_qsdd_change`.

### 4.2. `gcn_qsdd_qsh_nha_o_va_tsk`

Ten: `Giay chung nhan quyen su dung dat, quyen so huu nha o va tai san khac gan lien voi dat`.

- Mau 4 trang doi sau, vi du `mau 2 (1)` va `mau 2 (2)`.
- Phan dat theo bo cuc cu `II. Thua dat`, cac muc `a-g`.
- Page class: cover, land, change cua chinh generation nay.

### 4.3. `gcn_qsdd_qsh_tsglvd`

Ten: `Giay chung nhan quyen su dung dat, quyen so huu tai san gan lien voi dat`.

- Mau moi kho A4, vi du `mau 3`.
- Trang 1: `1. Nguoi su dung`, `2. Thong tin thua dat`, `3. Thong tin tai san gan lien voi dat`.
- Trang 2: `4. So do`, `5. Ghi chu`, `6. Nhung thay doi`.
- Page class: `gcn_qsdd_qsh_tsglvd_page_1`, `gcn_qsdd_qsh_tsglvd_page_2`.
- Tuyet doi khong hien thi mau nay bang bo cuc cu `I/II/IV`.

Neu xuat hien mau thu tu co bo cuc khac, them generation/layout moi; khong ep vao mot trong ba mau neu marker khong phu hop.

## 5. Pipeline OCR tong the

### 5.1. Tiep nhan va dinh huong

- Anh co the chua mot trang hoac hai trang doi dien.
- PDF phai render tung trang thanh anh; khong coi mot blob OCR Drive la nguon duy nhat.
- Moi anh/trang PDF phai xac dinh huong chu chinh va xoay chuan truoc khi crop.
- Luon giu candidate toan trang da chuan hoa.
- Chi tao candidate trai/phai co overlap neu trang rong va hinh hoc OCR cho thay co the la hai trang; khong chia doi mu quang.

### 5.2. Phan loai

- Dung ten GCN va marker muc/trang de xac dinh generation va page class.
- Khong dung ten file hoac thu tu upload lam bang chung.
- Moi truong land chi duoc lay tu page class land/page 1 phu hop.
- Muc thay doi sau cap chi duoc lay tu change/page 2.

### 5.3. Doc toan trang va doc tap trung

- OCR toan trang dung de phan loai, tim nhan va tao context.
- So GCN, so vao so va ngay cap la ba pipeline doc tap trung doc lap.
- So vao so va ngay cap bat buoc crop, zoom va OCR o moi case, du dang in hay viet tay.
- Crop critical field bang nhieu ban dung: mau goc, xam, adaptive black/white va tach mau muc chroma.
- Khong gia dinh muc mau xanh; muc co the xanh, den, do hoac mau khac.
- Chi chap nhan khi it nhat hai ban dung dong thuan, hoac co bang chung doc lap tu trang/file khac.

### 5.4. Trich truong

- Trich theo nhan in va ranh gioi nhan/muc, khong theo so dong co dinh.
- Truong nhieu dong keo dai den nhan/muc tiep theo.
- Dung OCR word coordinates de khoi phuc hang chu.
- Truoc khi nhom hang, khu do nghieng tu canh tren bounding box cua tu.
- Khong chuyen cum tu giua cac truong bang suy doan ngu nghia neu toa do/nhan khong chung minh.

### 5.5. Luu va review

Thu tu uu tien:

1. `manual_value` do nguoi dung sua
2. Ket qua focused crop da xac minh
3. OCR block/trang dung layout
4. OCR toan trang de goi y
5. De trong/canh bao neu khong du bang chung

- `AUTO_OCR` khong phai `manual_value`.
- Cac truong land critical da co ham luu extracted-data rieng; bo qua legacy `AUTO_OCR` override cu khi rebuild review.
- Full OCR repair khong duoc ghi de source `AUTO_OCR_A4_GEOMETRY_CROP_V2`.
- Sau khi auto save, giao dien phai render lai.
- Cac pipeline crop tren review chay tuan tu de tranh tranh chap tai nguyen/ghi du lieu.

## 6. Quy tac chi tiet tung truong

### 6.1. Ten loai GCN

- Lay dung ten in tren bia.
- Khong rut gon thanh mot ten mau co dinh.
- Ten nay dieu khien bo cuc review va cau `theo [ten GCN] so [so GCN]` trong hop dong.
- Chi sua loi OCR ro rang trong cung cum, vi du `hwuux/hwux/huux` thanh `huu`.

### 6.2. So GCN

- Crop rieng theo anchor so serial tren bia/trang cap.
- Luu khong co khoang trang: `AA02378604`, khong phai `AA 02378604`.
- Khong nham voi so vao so.
- Khong suy doan ky tu neu crop khong ro.

### 6.3. So vao so

- Tim nhan `So vao so cap GCN`, `So vao so cap Giay chung nhan` va bien the OCR tuong duong.
- Crop ca nhan va phan dong dien tay phia sau; khong bat buoc phai thay san code moi crop.
- Doc tat ca trang PDF vi so co the nam trang sau.
- Bo chuoi cham in dai `........` khi day la fill line.
- Neu chi co mot/vai dau cham that thi giu lai.
- Neu code viet xen tren cham in, bo cham nen nhung giu code, vi du `C.N.5.4.2.9` -> `CN5429` chi khi co bang chung fill line in.
- Neu khong co fill line dai, giu dau cau noi tai cua code.
- Bo khoang trang noi bo; khong tu them dau cau.
- Tu choi gia tri chi co duoi so nhu `027`.
- Khong lay so serial GCN lam so vao so.
- Khong hoc phep thay ky tu rieng tu mot case, vi du khong tao rule `4 -> 1`.
- Gia tri hop le ve format van phai qua focused crop verification.

### 6.4. Ngay cap

- Moi case deu crop rieng dong in `ngay ... thang ... nam ...` va phan viet/in tren dong.
- Zoom va doc nhieu ban dung mau.
- Chuan hoa ve `dd/MM/yyyy` chi khi doc du bo ngay/thang/nam.
- Khong lay ngay trong muc thay doi, ngay CCCD hoac ngay khac.
- Khong suy doan chu so thieu.

### 6.5. Noi cap

- Lay co quan cap tren dung trang cap.
- Chuan hoa viet hoa ten rieng/dia danh, vi du `Luong Son` -> `Lương Sơn` khi OCR co du bang chung.
- Khong tron chu ky, chuc danh, ngay thang hoac text muc thay doi vao noi cap.

### 6.6. Nguoi su dung/chu so huu

- Bao toan prefix in: `Ong:`, `Ba:`, `Va vo:`, `Va chong:`.
- Chi hien `vo/chong` neu bia co in.
- Bao toan nhan giay to: `CCCD` giu `CCCD`, `CC` giu `CC`; khong mo rong viet tat.
- Khong tu them dia chi nguoi su dung neu muc owner chi co ten va so giay to.
- `e. Dia chi` trong muc thong tin thua dat la dia chi dat, khong phai dia chi owner.
- Khong nhan cum `Nguoi su dung dat` trong muc thay doi sau cap lam owner heading.
- Voi mau cu, ghep dong ten voi dong `Nam sinh, CMND/CCCD so` ke tiep trong cung owner section.

### 6.7. Thua dat so va to ban do

- Trich theo nhan `Thua dat so` va `to ban do so`.
- Khong cat mat chu so dau; anh ro ma doc `10` thanh `1` la loi nghiem trong.
- Khong lay ky hieu so do, toa do hoac so thua lan can.

### 6.8. Dien tich

- Bao toan gia tri va don vi.
- Chuan hoa `m2/m²` thanh `m²` trong truong dien tich.
- Dien tich bang chu chi dien khi OCR thay ro; neu khong thi de trong/canh bao.

### 6.9. Loai dat/Muc dich su dung

- Bao toan nhan thuc te tren mau.
- A4 moi dung `c. Loai dat`; review phai hien `Loai dat`, khong doi thanh `Muc dich su dung`.
- Neu schema chua co `land_type`, co the luu noi dung vao field ky thuat `usage_purpose`, nhung presentation van giu nhan `Loai dat`.
- Gia tri co the gom nhieu loai dat va dien tich.
- Chi trong truong Loai dat, chuan hoa `344,6m`, `344,6m2`, `344,6m²` thanh `344,6 m²`.
- Khong ap sua don vi nay sang truong khac.

### 6.10. Thoi han su dung

- Lay nguyen van sau nhan den nhan tiep theo.
- Bao toan `Lau dai`, `Den ngay ...`, `Su dung den ...` va moi wording thuc te.
- Truong co the dai mot hoac nhieu dong.
- Khong cat tai tu `Den`.
- Khong dua ngay het han sang Hinh thuc su dung.
- Chi sua typo chac chan trong cung truong, vi du `Lau dai` bi OCR thanh `Lau dai` sai dau/ky tu ro rang.

### 6.11. Hinh thuc su dung

- Lay theo nhan thuc te, khong hard-code `Rieng/Chung`.
- Bao toan mot gia tri du OCR tra mot hay nhieu dong.
- Khong chen ngay het han, muc dich, dien tich hoac nhan khac vao truong nay.

### 6.12. Dia chi dat

- Thu thap tat ca dong den nhan/muc tiep theo.
- Dung truoc dien tich, `Bang chu` hoac nhan land field tiep theo neu OCR dao vi tri.
- Xoa khoang trang truoc dau phay/cham phay/cham/hai cham; giu mot khoang trang sau dau cau neu con text.
- Khong tron dia chi thuong tru cua owner vao dia chi dat.

### 6.13. Nguon goc su dung

- Co the dai 1, 2, 3 dong hoac hon; doc den nhan/muc tiep theo, khong gioi han so dong.
- Chi noi fragment trong cung land block va co noi dung nguon goc, vi du giao dat, cong nhan QSDD, chuyen nhuong, co/khong thu tien su dung dat.
- Khong chen dong nha, dien tich, dia chi, chu ky hoac co quan cap.
- Khong dung rule chi phu hop mot cau mau.

### 6.14. Thong tin tai san gan lien voi dat

Voi A4 moi, phan loai section 3:

- `absent`: bia in `-/-`; hien heading va `-/-`, khong tao a/b/c/d.
- `detailed`: chi hien cac nhan that su in tren bia: `a. Ten tai san`, `b. Dien tich su dung`, `c. Hinh thuc so huu`, `d. Thoi han so huu`.
- `unknown`: khong du bang chung; de trong/canh bao, khong suy dien tu case truoc.

Khong lay chu ky, co quan cap, QR note hoac text cuoi trang lam attached asset.

### 6.15. Ghi chu

- Lay noi dung sau `Ghi chu` den boundary tiep theo.
- Dung truoc `So vao so cap GCN/Giay chung nhan`, `IV`, section danh so tiep theo.
- `So vao so cap GCN` va bien the OCR `So vao so cap GCN` phai deu la boundary.
- Khong de registry/date/map text chay vao Ghi chu.

### 6.16. Nhung thay doi sau khi cap

- Chi doc tu change page/page 2.
- Khong lap heading `IV/6. Nhung thay doi...` vi review da render heading.
- Bo table-column headings khoi gia tri.
- Bang trong cua A4 moi phai de trong; khong tu dien `Khong co`.
- Neu chu viet tay ro, ghi day du.
- Neu qua mo/garbled, ghi `Khong ro, de nghi kiem tra`, khong doan ten/so/dia chi.

## 7. Ket qua case da xac minh cuoi cung

Case ID: `LAB-ocr-bia-dat-20260622-121250-EF2BDD7B`.

Da chay F5 bang trinh duyet that, doi crop ket thuc, sau do goi lai API doc lap. Ket qua persisted:

- So GCN: `AA01551895`
- So vao so: `CN5024`
- Ngay cap: `17/06/2025`
- Loai dat: `Dat o tai nong thon: 344,6 m²; Dat trong cay lau nam: 22,8 m²`
- Thoi han: `Dat o tai nong thon: Lau dai; Dat trong cay lau nam: Den ngay 10/10/2045`
- Hinh thuc: `Su dung rieng`
- Source ba truong A4: `AUTO_OCR_A4_GEOMETRY_CROP_V2`

Nguyen nhan loi da xu ly:

1. Legacy `AUTO_OCR` override bi hieu nham la manual va khoa field.
2. Legacy auto override cu ghi de ket qua focused crop moi khi F5.
3. Full OCR repair ghi de field geometry da xac minh.
4. Anh hoi nghieng lam cac tu cuoi dong bi nhom sang dong ke tiep.
5. Cac pipeline crop chay dong thoi tao race/qua tai.

Giai phap da trien khai:

- Tach `AUTO_OCR` khoi manual override.
- Bo qua legacy auto override voi cac critical land fields da co dedicated persistence.
- Bao ve source geometry V2 khoi full OCR repair.
- Deskew word geometry truoc khi group line.
- Chay auto crop pipeline tuan tu.
- Bo sung test skewed line va persistence/override priority.

## 8. Viec con ton tai/chua duoc coi la xong

1. Mot so warning va label noi bo van co mojibake, vi du `TrÆ°á»ng...`; can xu ly encoding rieng, khong tron vao parser OCR.
2. O case A4 tren, field table noi bo `attached_assets` van co the chua text rac nhu chu ky/co quan cap/QR note du presentation section 3 dang de trong. Can sua extraction/persistence de field raw cung thanh `-/-` hoac trong dung theo bia.
3. `certificate_info_raw_text` va `area_in_words` co warning thieu; can xac dinh co bat buoc hay chi warning.
4. Case lab khong co secured party co the hien `secured_parties: CRITICAL`; day khong phai loi OCR bia dat nhung can tach validation theo muc dich lab.
5. PDF preview trong review co luc hien `Dang tai anh...` lau; khong duoc danh dong voi OCR failure.
6. Chua co bo regression chay tu dong tren toan bo file mau thuc qua Cloud Vision do chi phi/network; hien test la parser/hinh hoc synthetic va mot so fixture OCR text.

## 9. De xuat buoc tiep theo cho session moi

Thu tu uu tien:

1. Sua `attached_assets` A4 de du lieu luu va presentation cung ton trong `-/-`/blank.
2. Sua mojibake warning/label theo mot dot encoding rieng.
3. Tao bo test matrix gom it nhat mot case cua moi generation, ca anh mot trang, anh hai trang, PDF scan, xoay 90/180 do.
4. Them diagnostic co gioi han cho crop: page class, crop reason, OCR readings, consensus, source saved; khong log token/base64.
5. Test lai cac case cu quan trong truoc khi submit case moi.

## 10. Checklist khi sua tiep

Truoc khi sua:

- Tao commit/tag rollback neu thay doi rong.
- Lay OCR text, anh goc va payload review cua case.
- Xac dinh generation, page class, field scope va source hien tai.
- Chung minh loi nam o orientation, crop, OCR, parser, merge, persistence hay presentation.

Sau khi sua:

- Them regression test dung dang loi.
- Chay `npm.cmd run test:land-ocr`.
- Kiem tra syntax Apps Script/Review HTML.
- `clasp push`, tao version va deploy dung deployment ID.
- Mo link review/F5, doi auto crop ket thuc.
- Goi API `getReview` lai doc lap de dam bao ket qua persisted, khong chi dung tam tren DOM.
- Kiem tra `git diff --check`, commit va push GitHub.

## 11. Prompt goi y de mo session moi

```text
Tiep tuc project OCR HDTC tai repository HDTC-OCR-Review-Giai-doan-1.
Hay doc day du cac file:
1. HANDOFF_OCR_BIA_DAT_2026-06-23.md
2. skills/ocr-bia-dat/SKILL.md
3. skills/ocr-bia-dat/references/core-rules.md

Tuan thu nguyen tac: ton trong nguyen van va bo cuc bia dat; khong hard-code/override rieng case; logic dac thu chi tac dong dung field; focused crop da xac minh khong bi full OCR ghi de; chinh sua nguoi dung co uu tien tuyet doi.

Truoc khi sua, hay bao cao trang thai git/deployment/test va neu ro nguyen nhan + phuong an. Sau khi duoc dong y thi thuc thi, test local, deploy, F5 case that va goi lai getReview de xac minh persistence.
```
