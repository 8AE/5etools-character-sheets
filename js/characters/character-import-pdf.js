import {PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup} from "../../lib/pdf-lib.esm.min.js";

export const MPMB_MAX_BYTES = 50 * 1024 * 1024;
const MAX_FIELDS = 20000;
const MAX_TEXT = 8 * 1024 * 1024;

/** AcroForm data only: neither PDF JavaScript nor embedded files are executed. */
export async function readMpmbPdf (bytes) {
	if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
	if (!bytes.length || bytes.length > MPMB_MAX_BYTES) throw new Error("Choose an MPMB PDF smaller than 50 MiB.");
	if (!new TextDecoder("ascii").decode(bytes.subarray(0, 1024)).includes("%PDF-")) throw new Error("The selected file is not a PDF.");
	let pdf, pageCount, form, allFields;
	try {
		pdf = await PDFDocument.load(bytes, {updateMetadata: false, throwOnInvalidObject: true});
		pageCount = pdf.getPageCount();
		form = pdf.getForm();
		allFields = form.getFields();
	}
	catch (error) {
		if (/encrypt/i.test(error.message)) throw new Error("This PDF is encrypted. Import an unencrypted copy of the original fillable MPMB sheet.");
		throw new Error("The PDF could not be read. Save a fresh copy of the original fillable MPMB sheet and try again.");
	}
	if (pageCount > 300) throw new Error("This PDF has too many pages for a character-sheet import (maximum 300).");
	if (form.hasXFA()) throw new Error("XFA forms are not supported. Use the original fillable MPMB AcroForm PDF.");
	if (!allFields.length) throw new Error("This PDF has no saved form fields. Upload the original fillable MPMB sheet, not a scan or a printed/flattened PDF.");
	if (allFields.length > MAX_FIELDS) throw new Error("This PDF contains too many form fields.");
	const fields = Object.create(null);
	const warnings = [];
	let textSize = 0;
	for (const field of allFields) {
		const name = field.getName();
		if (["__proto__", "prototype", "constructor"].includes(name) || name.length > 500) continue;
		let value;
		try {
			if (field instanceof PDFTextField) value = field.getText() || "";
			else if (field instanceof PDFCheckBox) value = field.isChecked();
			else if (field instanceof PDFDropdown || field instanceof PDFOptionList) value = field.getSelected();
			else if (field instanceof PDFRadioGroup) value = field.getSelected() || "";
			else continue;
		} catch { warnings.push(`Could not read the form field ${name}.`); continue; }
		const size = JSON.stringify(value).length;
		if (size > 1024 * 1024 || (textSize += size) > MAX_TEXT) throw new Error("This PDF contains more form text than the importer supports.");
		fields[name] = value;
	}
	return {fields, warnings, metadata: {title: pdf.getTitle() || "", creator: pdf.getCreator() || "", pages: pageCount}};
}
