import {convertMpmbFields} from "./character-import-mpmb.js";
import {escapeHtml as e, exportCharacters, importCharacters} from "./character-model.js";

const MAX_BYTES = 50 * 1024 * 1024;

async function readWithWorker (file, signal) {
	if (!file.size || file.size > MAX_BYTES) throw new Error("Choose an MPMB PDF smaller than 50 MiB.");
	const buffer = await file.arrayBuffer();
	if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL("./character-import-worker.js", import.meta.url), {type: "module"});
		let timer;
		const finish = (error, result) => { clearTimeout(timer); signal.removeEventListener("abort", abort); worker.terminate(); error ? reject(error) : resolve(result); };
		const abort = () => finish(new DOMException("Cancelled", "AbortError"));
		signal.addEventListener("abort", abort, {once: true});
		timer = setTimeout(() => finish(new Error("Reading this PDF took too long. Save a smaller copy of the fillable sheet and retry.")), 30000);
		worker.onmessage = event => finish(event.data.error ? new Error(event.data.error) : null, event.data.result);
		worker.onerror = () => finish(new Error("The PDF reader could not run. Keep the local server running and reload the page."));
		worker.postMessage(buffer, [buffer]);
	});
}

export function renderMpmbReview (draft) {
	const {character: c, summary, warnings, mappings} = draft;
	return `<div class="chars-summary"><span><strong>${e(c.name)}</strong> · ${e(summary.classes.join(" / "))}</span><span>${summary.items} items (${summary.customItems} custom)</span><span>${summary.feats} feats</span><span>${summary.spells} spells</span></div><p class="chars-muted">Species: ${e(c.race.split("|")[0] || "Not found")} · Background: ${e(c.background.split("|")[0] || "Not found")} · ${Object.entries(c.abilities).map(([key, value]) => `${key.toUpperCase()} ${value}`).join(" · ")}</p><p>A new character will be added. Your existing characters stay unchanged. Review the matches below; original feature text and unmatched details are retained in Journal.</p>${warnings.length ? `<details open class="chars-banner"><summary>${warnings.length} import notes</summary><ul>${warnings.map(warning => `<li>${e(warning)}</li>`).join("")}</ul></details>` : ""}<details><summary>Library matches (${mappings.length})</summary><div class="chars-table-scroll"><table class="chars-table"><thead><tr><th>Type</th><th>PDF entry</th><th>5etools match</th></tr></thead><tbody>${mappings.map(row => `<tr><td>${e(row.kind)}</td><td>${e(row.from)}</td><td>${e(row.to)}</td></tr>`).join("")}</tbody></table></div></details>${c.importedMpmb.unmatched.length ? `<details><summary>Entries to review (${c.importedMpmb.unmatched.length})</summary><ul>${c.importedMpmb.unmatched.map(row => `<li><strong>${e(row.kind)}:</strong> ${e(row.name)}</li>`).join("")}</ul></details>` : ""}`;
}

export async function importMpmbFile (app, file) {
	if (app.characters.length >= 200) throw new Error("A library can contain at most 200 characters.");
	if (app.pdfImportPending) throw new Error("Finish or cancel the current PDF import first.");
	app.pdfImportPending = true;
	const controller = new AbortController();
	const loading = app.dialog("Read MPMB sheet", '<p role="status">Reading the saved character fields…</p><p class="chars-muted">The PDF stays on this device. Its scripts are not run.</p>');
	loading.addEventListener("close", () => controller.abort(), {once: true});
	try {
		const extraction = await readWithWorker(file, controller.signal);
		if (controller.signal.aborted) { app.pdfImportPending = false; return; }
		loading.close();
		let draft = convertMpmbFields(extraction, app.catalog, {fileName: file.name});
		const review = app.dialog("Review MPMB import", `<label class="chars-field"><span>Match library sources</span><select name="mpmb-rules" class="ve-form-control ve-input-xs"><option value="2014" ${draft.character.rules === "2014" ? "selected" : ""}>2014</option><option value="2024" ${draft.character.rules === "2024" ? "selected" : ""}>2024</option></select></label><div data-mpmb-review>${renderMpmbReview(draft)}</div>`, {confirm: "Import character", onConfirm: () => {
			if (app.characters.length >= 200) throw new Error("A library can contain at most 200 characters.");
			const character = importCharacters(exportCharacters([draft.character]))[0];
			app.characters.push(character);
			app.selectedId = character.id;
			app.tab = "build";
			app.changed();
			app.updateHash();
			app.notify(`Imported ${character.name}. Review the import notes in Journal.`);
		}});
		review.addEventListener("close", () => { app.pdfImportPending = false; }, {once: true});
		review.querySelector('[name="mpmb-rules"]').addEventListener("change", event => {
			try {
				draft = convertMpmbFields(extraction, app.catalog, {fileName: file.name, rules: event.target.value});
				review.querySelector("[data-mpmb-review]").innerHTML = renderMpmbReview(draft);
				review.querySelector(".chars-dialog-error").textContent = "";
				review.querySelector("[data-confirm]").disabled = false;
			} catch (error) { review.querySelector(".chars-dialog-error").textContent = error.message; review.querySelector("[data-confirm]").disabled = true; }
		});
	} catch (error) {
		app.pdfImportPending = false;
		loading.close();
		if (error.name !== "AbortError") throw error;
	}
}
