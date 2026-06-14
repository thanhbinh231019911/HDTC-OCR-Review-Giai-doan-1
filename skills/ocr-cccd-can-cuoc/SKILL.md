---
name: ocr-cccd-can-cuoc
description: OCR and review workflow for Vietnamese CCCD/Can cuoc identity cards in the mortgage contract project. Use when fixing or analyzing ID-card extraction, front/back matching, MRZ parsing, issue date, issue place, date of birth, ID number, or any regression involving CCCD/Can cuoc OCR.
---

# OCR CCCD/Can cuoc

Use this skill before editing any code that reads Vietnamese CCCD/Can cuoc data.

## Required Workflow

1. Reproduce from real OCR text and image evidence first.
2. Keep CCCD/Can cuoc logic separate from land-certificate OCR logic.
3. Match front and back sides only by ID number or clear same-person evidence in the same upload group.
4. Treat MRZ as identity matching evidence only, not as issue-date evidence.
5. Do not guess legal dates from corrupted OCR.
6. Prefer blank/manual review over a confident but unsupported date.
7. Add tests with the exact failure pattern before changing extraction rules.

## When OCR Image Looks Clear But Date Fails

Do not patch only the final value. Diagnose the acquisition pipeline:

- Is the date region too small in the full image?
- Is the image sent whole instead of cropped near the issue-date label?
- Does OCR text contain a valid date near the issue-date label?
- Did the model use birth date, expiry date, MRZ date, or another date?
- Are Google OCR and Vision contradicting each other?

If the image is clear to a human but OCR fails, the fix belongs in a dedicated CCCD preprocessing/crop path, not in generic review merge code.

## References

Read `references/core-rules.md` before implementing or reviewing CCCD/Can cuoc OCR changes.
