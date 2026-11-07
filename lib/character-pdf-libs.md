# Character PDF import libraries

The character-sheet importer uses locally bundled dependencies. No CDN is contacted.

- [pdf-lib](https://pdf-lib.js.org/docs/api/classes/pdfform) 1.17.1: reads saved AcroForm fields. MIT license in `pdf-lib-LICENSE.txt`.
- [JSON5](https://github.com/json5/json5) 2.2.3: parses MPMB's saved data literals without evaluating JavaScript. MIT license in `json5-LICENSE.txt`.

Versions are pinned in `package.json` and `package-lock.json`. Regenerate the browser modules with `node node/generate-character-pdf-libs.js`. Source-map comments are removed because the upstream maps are not shipped.
