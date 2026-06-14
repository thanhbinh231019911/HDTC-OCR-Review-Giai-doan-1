# Core Rules: OCR CCCD/Can cuoc

## Scope

This skill owns only Vietnamese CCCD/Can cuoc extraction:

- full name
- date of birth
- document type
- ID number
- issue date
- issue place
- permanent address
- front/back pairing
- MRZ parsing for matching

It must not contain land-certificate rules.

## Matching Front And Back

- Pair front and back sides by matching CCCD/Can cuoc number.
- Do not pair by upload order, nearest file, role, or visual position.
- Apply the same rule to obligors and secured parties.
- For MRZ beginning with `IDVNM`, strip letters and `<`.
- If 22 digits follow `IDVNM`, the first 10 digits are other data and the next 12 digits are the ID number.
- Example: `IDVNM0760027248001076002724<9` maps to ID number `001076002724`.

## Issue Date

Accepted labels:

- Old CCCD back: `Ngay, thang, nam / Date, month, year`
- New Can cuoc: `Ngay, thang, nam cap / Date of issue`

Accepted date formats near the label:

- `dd/MM/yyyy`
- `dd-MM-yyyy`
- `dd.MM.yyyy`
- `ddMMyyyy` only when all 8 characters are digits

Forbidden behavior:

- Do not infer `Oro712021`, `Or0712021`, or similar corrupted text into a date.
- Do not choose a date from MRZ.
- Do not choose date of birth or expiry date.
- Do not trust model confidence alone.
- Do not write a date when OCR tools disagree without evidence.

Required behavior:

- If date evidence is clear near the issue-date label, normalize to `dd/MM/yyyy`.
- For old CCCD, scan after `Date, month, year` or after the word `year`, then scan up to the next two OCR lines.
- For new Can cuoc, scan after `Date of issue`, then prioritize the line directly below that label.
- Use the document type only to choose the first crop/search strategy. The final decision must still be based on the issue-date label and date position.
- If the input is explicitly a crop of the issue-date region, accept the single valid date in that crop even when the OCR text only contains a suffix such as `year10/07/2021`.
- If evidence is not clear, leave blank or mark manual review.
- If the full image is clear to a human but OCR fails, implement a CCCD-specific crop/preprocess path for the issue-date region.

## Tool Strategy

- Google Vision OCR is useful for full-image text and MRZ.
- OpenAI Vision may be used only as field-level assistance, preferably on a cropped issue-date region.
- Tesseract/OpenCV or equivalent preprocessing may be added for deterministic crop, deskew, contrast, and enlarged-region OCR.
- No tool is allowed to be the sole authority for a legal date without visible/traceable evidence.

## Output Contract

Every extracted field should carry:

- value
- source file
- source type, for example `GOOGLE_OCR`, `OPENAI_VISION_CROP`, `MANUAL`
- confidence or status
- evidence text or crop reference when available

For unclear issue date, output must not contain a guessed date.
