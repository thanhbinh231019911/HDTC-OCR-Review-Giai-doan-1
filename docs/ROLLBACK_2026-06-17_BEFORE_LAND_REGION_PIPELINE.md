# Rollback checkpoint before land OCR region pipeline refactor

Date: 2026-06-17

Stable local/GitHub state before broad land OCR region/page-selection work:

- Git commit: `fd99e5917384fe70343691e2119415ca8fadceec`
- Git tag: `rollback-before-land-region-pipeline-20260617`
- Apps Script review deployment ID: `AKfycbyXkDTtk4PVPzjdCwy1duKEtbqJrNUHlbsF7TO_jTaMJ1JCCz8PJUf7vzerZijF1KyD`
- Apps Script review deployment version: `@102`
- Deployment description: `fix Vietnamese usage word rendering`

Rollback notes:

- To restore code locally: `git checkout rollback-before-land-region-pipeline-20260617`
- To restore the review web app deployment, redeploy the same deployment ID to version `102`.
- Do not create a new web app deployment for rollback unless explicitly required.
