# Core Rules: OCR Bia Dat

## Scope

This skill owns only land-certificate/property-certificate extraction:

- certificate title
- certificate number
- registry number
- issuing authority
- issue date
- land plot number
- map sheet number
- land address
- area and area in words
- usage form
- usage purpose
- usage term
- usage origin
- attached assets
- post-issue changes
- contract asset-description text

It must not contain CCCD/Can cuoc identity-card rules.

## Certificate Title

Recognize at least these standard title types:

- Giấy chứng nhận quyền sử dụng đất, quyền sở hữu tài sản gắn liền với đất
- Giấy chứng nhận quyền sử dụng đất, quyền sở hữu nhà ở và tài sản khác gắn liền với đất
- Giấy chứng nhận quyền sử dụng đất

Rules:

- OCR/certificate type controls the contract wording.
- Do not hard-code only `Giấy chứng nhận quyền sử dụng đất`.
- In contract text, write the matching type at `theo ... số ...`.
- Correct clear OCR typo variants such as `hwuux`, `hwux`, `huux` in `quyền sở hữu` to `hữu`.

## Page And Layout Classification

Land-certificate uploads may contain one physical page per image, two facing pages in one image, or rendered PDF pages. Before extracting certificate fields, classify candidate pages/regions by OCR markers.

Use the OCR-read certificate title as a classification signal. Different certificate generations have different titles and section structures; do not assume all land certificates use the old 4-page `II. Thua dat` layout.

Recognize these three certificate title/template generations. Name templates by certificate title, not by filename:

- `gcn_qsdd`: `Giay chung nhan quyen su dung dat`. This is the oldest red-cover certificate, like the user sample `bia mua`. Land information and change/map information may be on old handwritten/table pages.
- `gcn_qsdd_qsh_nha_o_va_tsk`: `Giay chung nhan quyen su dung dat, quyen so huu nha o va tai san khac gan lien voi dat`. This is the later 4-page certificate, like the user samples `mau 2 (1)` and `mau 2 (2)`. Land fields are still old-style `II. Thua dat` / `a-g`.
- `gcn_qsdd_qsh_tsglvd`: `Giay chung nhan quyen su dung dat, quyen so huu tai san gan lien voi dat`. This is the newest A4 certificate, like the user sample `mau 3`. Page 1 contains `1. Nguoi su dung`, `2. Thong tin thua dat`, `3. Thong tin tai san gan lien voi dat`; page 2 contains `4. So do`, `5. Ghi chu`, `6. Nhung thay doi`.

Classify page/layout classes within those generations:

- `gcn_qsdd_cover`, `gcn_qsdd_land`, `gcn_qsdd_change`
- `gcn_qsdd_qsh_nha_o_va_tsk_cover`, `gcn_qsdd_qsh_nha_o_va_tsk_land`, `gcn_qsdd_qsh_nha_o_va_tsk_change`
- `gcn_qsdd_qsh_tsglvd_page_1`, `gcn_qsdd_qsh_tsglvd_page_2`

For images that show two pages at once, create left/right page candidates after orientation normalization. For single-page images, keep the full page candidate. Classify by OCR markers, not by filename or upload order.
Normalize every uploaded image and every rendered PDF page to its dominant text orientation before creating field crops. Always keep the normalized full-page candidate. Add overlapping left/right candidates only when the normalized page is wide and OCR geometry indicates a possible two-page spread; never replace the full-page candidate with a blind split.

For scanned PDFs, do not use a single Drive OCR text blob as the authoritative source for certificate fields. Render or submit each PDF page to Cloud Vision as page-level OCR, create the same page/region candidates as image uploads, then classify and extract from those regions. A clear scanned PDF must be treated as page images, not as unstructured full-document text.
When repairing A4 review fields after the review page loads, first try the stored full OCR text for land-certificate files. If the asset has no directly linked files, fall back to OCR results whose text/name clearly contains land-certificate markers. Only then run field-specific image crops.
Certificate serials and registry numbers used for review/contract generation must be stored without internal spaces, for example `AA02378604` and `CN5429`, so generated contracts do not wrap the code across lines. Clean OCR punctuation spacing in land addresses and certificate text values: remove spaces before commas/semicolons/periods/colons, but keep a single space after those punctuation marks when text follows.

Crop/OCR policy:

- Extract `gcn_qsdd` land fields only from `gcn_qsdd_land`.
- Extract `gcn_qsdd_qsh_nha_o_va_tsk` land fields only from `gcn_qsdd_qsh_nha_o_va_tsk_land`.
- Extract `gcn_qsdd_qsh_tsglvd` land fields only from `gcn_qsdd_qsh_tsglvd_page_1`.
- For a single-page A4 `gcn_qsdd_qsh_tsglvd_page_1`, prefer its full-page OCR region over left/right partial regions. Labels such as `c. Loai dat` and `d. Thoi han su dung` may begin on the left while their values continue across the page.
- Extract post-issue changes only from `gcn_qsdd_change`, `gcn_qsdd_qsh_nha_o_va_tsk_change`, or `gcn_qsdd_qsh_tsglvd_page_2`.
- Extract registry number only from the region around `So vao so cap GCN/Giay chung nhan`; never infer it from the printed certificate serial.
- If no trusted page/region is available, leave the affected field blank and add a manual-review warning instead of falling back to whole-image OCR.
- For every certificate case, run field-specific enlarged crops for certificate issue date and registry number, whether the current value is blank, printed, or handwritten. Full-page OCR may locate the field but must not be the final authority for these two fields.
- Locate the issue-date crop from the full printed line containing `ngay ... thang ... nam ...`. Locate the registry crop from the complete `So vao so cap GCN/Giay chung nhan` label and extend through the remaining fill line. A code token is not required before creating the registry crop.
- Treat certificate serial, registry number, and issue date as three independent critical-field pipelines. Locate each field from its own visual anchor on every candidate page; never use the current stored value's length or characters to reject a complete anchored crop result.
- Render every critical-field crop at enlarged resolution in multiple general forms: original color, grayscale, adaptive black/white, and color-chroma ink separation. Do not assume blue ink; the handwriting may be black, blue, red, or another color. Accept a value only when at least two renderings agree. A vision-model fallback may transcribe the focused crop only and must not infer missing characters.

Review display policy:

- The review screen must preserve the printed certificate layout for the classified template.
- For `gcn_qsdd_qsh_tsglvd`, display page 1 as `1. Nguoi su dung dat, chu so huu tai san gan lien voi dat`, `2. Thong tin thua dat`, `3. Thong tin tai san gan lien voi dat`; display page 2 as `4. So do thua dat, tai san gan lien voi dat`, `5. Ghi chu`, `6. Nhung thay doi sau khi cap Giay chung nhan`.
- Do not render the old `I/II/1/a-g/2-6/IV` layout for `gcn_qsdd_qsh_tsglvd`.
- Do not create an owner/user address when the printed `1. Nguoi su dung...` section has only name and ID number. The `e. Dia chi` item under `2. Thong tin thua dat` is land address only.
- For new A4 certificates, display `c. Loai dat` as `Loai dat`; do not rename it to `Muc dich su dung` in the certificate-layout review.
- Keep every printed A4 land item `a/b/c/d/d/e` under section `2. Thong tin thua dat` visible in review even when OCR did not read its value. A missing OCR value must appear as a blank printed field, not disappear with its heading.
- Preserve owner/user lines as printed, including prefixes such as `Ong:`, `Ba:`, `Va vo:` and the exact identity-document label. If the certificate prints `CCCD`, keep `CCCD`; if it prints `CC`, keep `CC`. Do not expand an abbreviation or infer a document type from the number length.
- Prefer trusted raw owner-section lines for certificate review. Structured owner fields may support contract generation, but must not rewrite or infer relationship prefixes in the certificate view. Preserve forms such as `Va chong:` and `Va vo:` only when printed.
- For new A4 section `3. Thong tin tai san gan lien voi dat`, first classify the section as `absent`, `detailed`, or `unknown`. When the certificate prints `-/-`, display only the section heading and `-/-`; do not invent child labels. When child labels are printed, preserve and display them separately: `a. Ten tai san`, `b. Dien tich su dung`, `c. Hinh thuc so huu`, `d. Thoi han so huu`. Extract by label meaning rather than OCR line order.
- When the phrase `Nguoi su dung dat` appears in post-issue-change text, do not treat it as the owner section. Select a section that begins with the printed `I.` or `1.` owner heading and ends before `II.`/`2. Thong tin thua dat` or the certificate warning text.
- Old certificates may print the owner name on one line and `Nam sinh, CMND/CCCD so` on the next. Join those adjacent lines inside the selected owner section; do not turn `Nam sinh` into an owner name.
- A blank new-A4 changes table remains blank in review. Do not invent `Khong co`.

## Field Extraction

- Use section/index boundaries such as `II`, `1`, `2`, `a)`, `b)`, `c)`, `d)`, `đ)`, `e)`, `g)`.
- A field continues until the next section/index boundary.
- Section/index markers such as `a)`, `b)`, `c)`, `d)`, `đ)`, `e)`, and `g)` are boundaries only. They do not define field meaning by themselves.
- If OCR attaches the next section/index marker to the end of the previous value, for example `Sử dụng riêng đ`, remove that trailing marker from the previous field value.
- Field meaning must come from the actual label printed/read on the certificate, for example `Hình thức sử dụng`, `Mục đích sử dụng`, `Thời hạn sử dụng`, `Diện tích`, or `Nguồn gốc sử dụng`.
- If another certificate uses a different printed label such as `Loại đất`, preserve that label in the certificate text/review and do not force it into `Mục đích sử dụng` unless a mapping rule has been explicitly agreed.
- Do not take only the last wrapped line.
- Multi-line certificate fields must be collected by field boundary, not by visual line count. `Dia chi`, `Dien tich`, `Muc dich su dung`/`Loai dat`, `Thoi han su dung`, and `Nguon goc su dung` may continue across 2 or more OCR lines until the next printed label/section starts.
- `Hinh thuc su dung` should preserve the certificate/OCR presentation as one value, whether OCR returns one line or multiple lines; do not split or invent subfields.
- If OCR dislocates a continuation fragment within the same land block, append it only when the fragment semantically belongs to that same field and is not another printed label/section. For `Nguon goc su dung`, valid continuation fragments are general origin phrases such as state allocation/recognition, transfer, collection/non-collection of land-use fee, or `QSDD` wording; do not add house, area, address, or ownership lines.
- Do not move content between fields.
- Apply a broad rule only when it is genuinely layout-wide, such as section boundary handling or wrapped-line handling.
- Keep field-specific repairs scoped to that field. Do not put a fix for one field in a shared cleanup helper if it can change other certificate fields.
- When repairing review data from stored OCR, include a text block as land-certificate asset OCR if its content contains certificate/land markers. Do not rely only on file group, filename prefix, or even filename presence, because lab/prod uploads may lose metadata.
- In the OCR Bia dat lab form, uploaded certificate files must be routed as asset files. If an installed trigger calls the wrong lab handler, resolve the lab type again from the actual Google Form ID, form title, or submitted upload-question title before creating the case.
- After OCR, if the OCR text itself clearly matches a land/property certificate, classify that OCR result as asset even if the original upload group was wrong. Do not apply the reverse rule to identity-card OCR.
- Optional item `Ghi chú` must stop at later certificate boundaries such as `Số vào sổ cấp GCN/Giấy chứng nhận`, section `IV`, or the next numbered section. Do not let registry/date/map text become note content.
- Treat OCR variants such as `Số vào số cấp GCN` as the same registry boundary as `Số vào sổ cấp GCN`.

## New A4 Certificate Fields

For new A4 certificates, the land fields may be under `2. Thong tin thua dat` instead of old `II. Thua dat`.

Recognize at least these labels:

- `a. Thua dat so`, `to ban do so`
- `b. Dien tich`
- `c. Loai dat`
- `d. Thoi han su dung`
- `d/đ. Hinh thuc su dung`
- `e. Dia chi`
- `3. Thong tin tai san gan lien voi dat`

When the schema does not have a separate `land_type` field, map `Loai dat` into the existing land-use purpose/description field without inventing wording. Preserve compound values such as `Dat o tai nong thon: 400,0 m2; Dat trong cay lau nam: 1041,9 m2`.
Quantities written after land types are areas. Within `Loai dat` only, normalize OCR forms such as `344,6m`, `344,6m2`, or `344,6m²` to `344,6 m²`. Do not apply this unit repair to unrelated fields.
For the A4 land section, reconstruct visual lines from OCR word coordinates after cropping and zooming. Sort words by line position and then from left to right; extract each field as ordinary printed text from its label to the next printed label. Do not move dates or phrases between `Thoi han su dung` and `Hinh thuc su dung` using semantic repair rules.
When reconstructing a visual line, tolerate normal vertical drift between words caused by perspective, handwriting, or OCR boxes. Words whose vertical centers still overlap the same text row must remain on that row; this is especially important for a trailing date in `Thoi han su dung`.
Keep automated OCR persistence distinct from a user edit. An override row whose editor is exactly `AUTO_OCR` remains replaceable AI data (`ai_value`), while a real user edit remains `manual_value`, confirmed, and must never be overwritten by automatic crops.
For land fields that now persist through their dedicated extracted-data pipeline, ignore stale legacy `AUTO_OCR` override rows when rebuilding review data; they must not overwrite a newer focused-crop result.

## Registry Number

Scope: `So vao so cap GCN` / `So vao so cap Giay chung nhan`.

Rules:

- Extract by the registry-label context, not by scanning the whole certificate for code-like text.
- Accept labels with or without `:` because OCR may drop punctuation.
- Treat `So vao so cap GCN` as including OCR variants of Vietnamese diacritics, including cases where `so` is read for `so/so`.
- Take the short text region on the same line or immediately after the registry label.
- Remove the printed dotted fill line only when OCR reads it as a run of dots, for example `........`.
- Ignore dots only when the OCR line after the registry label contains a long consecutive printed fill line such as `........`. When that fill line crosses/interleaves a handwritten value like `C.N.5.4.2.9`, store `CN5429`.
- If the value has only one or a few isolated dots and there is no long printed fill line, preserve those dots because they may be real registry-code punctuation. Examples: `CN.5429` stays `CN.5429`; `C.N.5.4.2.9` stays unchanged when no dotted fill line is present.
- Preserve a single punctuation mark such as `.`, `/`, or `-` when OCR reads it inside the candidate value; it may be handwritten.
- Remove internal spaces only. Do not invent punctuation. Examples: `CS 03027` -> `CS03027`; `CL 2017` -> `CL2017`; `CL.2017` -> `CL.2017`.
- Reject partial numeric-only values such as `027`; leave blank or warn for manual review.
- Do not use certificate serial numbers such as `CO402507` as registry numbers.
- If the full value is handwritten over a dotted line and OCR reads only the tail, add a warning or use a dedicated crop/OCR pass for this registry region; do not infer the missing prefix.
- The crop/OCR pass for registry number must remain field-specific: find the registry label region, crop around that line, OCR only that crop, and write only `assets[].real_estate.registry_number`.
- A registry value that looks structurally valid is not automatically verified. Run focused registry OCR unless the field already records a focused-crop verification source.
- Replace an existing valid-looking registry value only when at least two focused crop candidates independently return the same complete registry code and no competing code has the same vote count.
- For multi-page PDFs, render and inspect every PDF page; a Drive thumbnail of page 1 is not evidence for a registry number printed on a later page.
- Repeated OCR regions derived from the same page annotation are not independent votes. Count a high-resolution focused field crop only when separate color and grayscale passes on that same tight crop agree, or when genuinely different pages/files agree.
- Use general color-chroma separation rather than a blue-only rule so handwritten values in different ink colors remain detectable.
- Prefer tight edge crops around the registry line for rotated certificate spreads. Broad page strips may locate the field but must not outvote a tight crop that contains the handwritten code.
- Evaluate all focused crops for the page before accepting a registry value. Never stop at the first color/grayscale agreement when a tighter crop of the handwritten line is still available.
- Persist focused registry OCR as automated extracted data with an `AUTO_OCR` source. Do not store it as a manual override.
- Never hard-code a corrected registry code for one case or learn a direct character substitution such as `4 -> 1` from a single example.

## Usage Form

- Extract from item `d)` on the certificate.
- Do not hard-code `Riêng` or `Chung`; take the real text after `d)` until the next indexed item.
- If OCR/indexed extraction reads the `d)` value as one field, display it as one review line.
- If the certificate/OCR truly has multiple lines inside the same `d)` value, preserve the field content, but do not split because of parser artifacts.

## Usage Term

- Extract from item `e)` on the certificate.
- Do not force a fixed value such as `lâu dài`.
- Keep real phrases such as `Đến ngày ...`, `Sử dụng đến ...`, or other certificate wording.
- Correct only obvious OCR typos inside this field, for example `Lâu đài` to `Lâu dài`, preserving case as much as possible.

## Contract Generation

- The Word template is only a presentation frame.
- Asset description must match the certificate data.
- If a field exists on the certificate, include it.
- If a field is absent on the certificate, do not add sample/template text.
- Usage origin, attached assets, and post-issue changes appear only when there is real content.
- Table headings, signature text, blank values, `-/-`, or `Chưa chứng nhận quyền sở hữu` are not real descriptive content.

## Output Contract

Every extracted field should carry:

- value
- source file
- source type, for example `GOOGLE_OCR`, `OPENAI_TEXT`, `MANUAL`
- confidence or status
- evidence text when available

For unclear certificate fields, leave blank or mark manual review instead of inventing content.

## Field Boundary Repairs

- `Dia chi` must stop before area text, `Bang chu`, or the next indexed land-field label. Write the cleanup only to the land-address field.
- `Nguon goc su dung` may join wrapped OCR fragments only when the same asset OCR contains the missing words and the assembled sentence follows the field label. Do not borrow text from another field or certificate.
- In post-issue changes, remove repeated `IV. Nhung thay doi...` and table-column headings from the field value because the review layout renders the heading itself.
- If handwritten post-issue content is too garbled to preserve faithfully, store `Khong ro, de nghi kiem tra` instead of presenting guessed names, numbers, or addresses.
