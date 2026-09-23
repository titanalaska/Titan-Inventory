# Safety data sheets

The PDFs the app links to. They live here, same origin as the app, so the
service worker can keep them on the phone — the red building has no signal,
and a sheet that only opens with signal is not "readily accessible" under
OSHA HazCom (29 CFR 1910.1200(g)(8)).

## Adding a sheet

1. Get the **manufacturer's current SDS for that exact product** — from the
   maker's site or the supplier, never a lookalike product. Match the product
   name and the maker on the label in the building.
2. Save it here as `maker-product-YYYY-MM.pdf`, the month being the sheet's
   own revision date (Section 16, or the header).
3. Add an entry to `SDS_SHEETS` in `index.html`, keyed by the item's id in the
   inventory:
   ```js
   37: { file:'quikrete-vinyl-concrete-patcher-2024-05.pdf',
         product:'Vinyl Concrete Patcher', maker:'Quikrete',
         revised:'2024-05-01', checkedBy:'' },
   ```
4. **`checkedBy` stays blank until a person has compared the sheet to the
   product label** and puts their name there. Until then the app treats the
   sheet as missing and tells the crew to use the paper binder.
5. Bump `SHELL_VERSION` in `sw.js`, run `npm test`, push.

## Replacing a sheet

A revised sheet gets a **new filename** (new revision month). Never overwrite
a PDF in place: phones keep the old copy under the old name and would go on
showing it. The app drops sheets that are no longer listed from the phone's
cache on its own.

## What needs a sheet

Everything in the `CHEMICALS` category, whether or not it has an entry — that
is how a missing one shows up. Anything outside it (Quikrete in masonry, say)
opts in by having an entry. Plants, pavers, lumber, block and fabric are
OSHA "articles" and do not need one.

## The paper binder stays

OSHA accepts electronic access only with a backup for when the device fails.
Keep a printed copy of every sheet in the red building.
