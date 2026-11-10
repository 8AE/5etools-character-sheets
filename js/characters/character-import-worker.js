import {readMpmbPdf} from "./character-import-pdf.js";

self.onmessage = async event => {
	try { self.postMessage({result: await readMpmbPdf(event.data)}); }
	catch (error) { self.postMessage({error: error.message || "The PDF could not be read."}); }
};
