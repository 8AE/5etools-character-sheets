import fs from "node:fs";

// Browser imports stay local; these files are also used by the extraction tests.
for (const [source, target] of [
	["pdf-lib/dist/pdf-lib.esm.min.js", "pdf-lib.esm.min.js"],
	["pdf-lib/LICENSE.md", "pdf-lib-LICENSE.txt"],
	["json5/dist/index.min.mjs", "json5.min.mjs"],
	["json5/LICENSE.md", "json5-LICENSE.txt"],
]) {
	const content = `${fs.readFileSync(`node_modules/${source}`, "utf8").replace(/^\/\/# sourceMappingURL=.*$/gm, "").trimEnd()}\n`;
	fs.writeFileSync(`lib/${target}`, content);
}
