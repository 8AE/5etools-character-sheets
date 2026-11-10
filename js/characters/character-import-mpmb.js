import JSON5 from "../../lib/json5.min.mjs";
import {ABILITIES, SKILLS, createCharacter, createClass, createCustomOption, newId, uid, subclassUid, exportCharacters, importCharacters, clamp} from "./character-model.js";
import {CharacterEngine} from "./character-engine.js";

const normalize = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[’‘]/g, "'").toLowerCase().replace(/[^a-z0-9+]+/g, " ").trim().replace(/\s+/g, " ");
const text = value => (Array.isArray(value) ? value.join(", ") : typeof value === "string" || typeof value === "number" ? String(value) : "").replace(/\r\n?/g, "\n").trim();
const integer = value => /^[-+]?\d+$/.test(text(value).replaceAll(",", "")) ? Number(text(value).replaceAll(",", "")) : null;
const checked = value => value === true || /^(yes|on|true|checked|1)$/i.test(text(value));
const safeKey = key => !["__proto__", "constructor", "prototype"].includes(key);
const abbreviations = ["Acr", "Ani", "Arc", "Ath", "Dec", "His", "Ins", "Inti", "Inv", "Med", "Nat", "Perc", "Perf", "Pers", "Rel", "Sle", "Ste", "Sur"];
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** MPMB uses toSource() literals. Accept data, not calls, functions, or expressions. */
export function parseMpmbLiteral (source) {
	if (typeof source !== "string" || source.length > 1024 * 1024) throw new Error("Saved data is too large.");
	let value = source.trim();
	if (value.startsWith("(") && value.endsWith(")")) value = value.slice(1, -1);
	const parsed = JSON5.parse(value);
	let count = 0;
	const check = (entry, depth = 0) => {
		if (depth > 20 || ++count > 20000) throw new Error("Saved data is too deeply nested or too large.");
		if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error("Invalid numeric data.");
		if (!entry || typeof entry !== "object") return;
		for (const [key, child] of Object.entries(entry)) {
			if (!safeKey(key)) throw new Error("Unsafe property in saved data.");
			check(child, depth + 1);
		}
	};
	check(parsed);
	return parsed;
}

function itemKey (name) {
	let key = normalize(name).replace(/\barmou?r\b/g, "").replace(/\s*\+\s*/g, " +").replace(/\s+/g, " ").trim();
	key = ({"thieve tools": "thieves tools", "thieves tools": "thieves tools", "thieves s tools": "thieves tools", "poison kit": "poisoners kit", "poisoner s kit": "poisoners kit"})[key] || key;
	return key.replace(/\bthieves s\b/g, "thieves").split(" ").filter(Boolean).sort().join(" ");
}

const raceKey = name => normalize(name).replace(/\bdark elf\b/g, "drow elf").split(" ").sort().join(" ");

function makeMatcher (catalog, rules, warnings, mappings) {
	const preferred = rules === "2024" ? "XPHB" : "PHB";
	return (kind, raw, {filter = () => true, source = ""} = {}) => {
		if (!text(raw)) return null;
		const name = text(raw).replace(/\s*\[(?:Origin|General|Epic Boon|Fighting Style)\]\s*$/i, "");
		const key = kind === "item" ? itemKey : kind === "race" ? raceKey : normalize;
		let matches = catalog.list(kind).filter(it => !it._isBaseRace && filter(it) && [it.name, ...(it.alias || []), ...(kind === "subclass" ? [it.shortName] : [])].filter(Boolean).some(alias => key(alias) === key(name)));
		const rank = entity => entity.source === source ? 100 : entity.source === preferred ? 80 : entity.source === (rules === "2024" ? "XDMG" : "DMG") ? 70 : ["PHB", "DMG", "XPHB", "XDMG"].includes(entity.source) ? 50 : entity.isReprinted ? 0 : 20;
		matches = matches.sort((a, b) => rank(b) - rank(a) || a.source.localeCompare(b.source));
		if (!matches.length) return null;
		if (matches.length > 1 && rank(matches[0]) === rank(matches[1])) warnings.push(`Several ${kind} entries match “${name}”; review the selected source ${matches[0].source}.`);
		mappings.push({kind, from: text(raw), to: `${matches[0].name} · ${matches[0].source}`});
		return matches[0];
	};
}

function readClasses (fields, catalog) {
	const description = text(fields["Class and Levels"]);
	const headers = [...text(fields["Class Features"]).matchAll(/^([^\n:]+?),\s*level\s+(\d+)\s*:/gim)].map(match => ({name: match[1], level: Number(match[2])}));
	const names = [...new Set([...catalog.list("class").map(it => it.name), ...headers.map(it => it.name.replace(/\s*\([^)]*\)/g, "").trim())])].sort((a, b) => b.length - a.length);
	const regex = new RegExp(`\\b(${names.map(escapeRegex).join("|")})\\b`, "gi");
	const outsideParens = description.replace(/\([^)]*\)/g, part => " ".repeat(part.length));
	const total = integer(fields["Character Level"]);
	if (!description && !headers.length) throw new Error("No class and character level could be read. Use a saved, filled-in MPMB character sheet.");
	const boundaries = [-1, ...[...outsideParens.matchAll(/[,/;\n]/g)].map(it => it.index), description.length];
	const parts = boundaries.slice(1).map((end, index) => description.slice(boundaries[index] + 1, end).trim()).filter(Boolean);
	const fragments = parts.flatMap(part => {
		const found = [...part.replace(/\([^)]*\)/g, value => " ".repeat(value.length)).matchAll(regex)];
		return found.length > 1 ? found.map((match, index) => part.slice(index ? match.index : 0, found[index + 1]?.index ?? part.length).trim()) : [part];
	});
	if (!fragments.length) fragments.push(...headers.map(it => `${it.name} ${it.level}`));
	return fragments.map(fragment => {
		const base = fragment.replace(/\([^)]*\)/g, "").trim();
		const name = base.replace(/^\d+\s+/, "").replace(/\s+(?:level\s*)?\d+$/i, "").trim();
		const header = headers.find(it => normalize(it.name.replace(/\([^)]*\)/g, "")) === normalize(name));
		const explicit = base.match(/(?:^|\s)(\d+)(?:\s|$)/);
		const level = explicit ? Number(explicit[1]) : header?.level || (fragments.length === 1 ? total : null);
		if (!name || !level || level < 1 || level > 20) throw new Error(`The class and level of “${fragment}” could not be determined from this sheet.`);
		return {name, level, subclass: fragment.match(/\(([^)]+)\)/)?.[1] || header?.name.match(/\(([^)]+)\)/)?.[1] || ""};
	});
}

/** Convert a read-only extraction to a draft; the page commits it only after review. */
export function convertMpmbFields ({fields, metadata = {}, warnings: extractionWarnings = []}, catalog, {fileName = "MPMB character.pdf", rules = "auto"} = {}) {
	if (!fields || typeof fields !== "object") throw new Error("No PDF form data was provided.");
	const isMpmb = /morepurplemorebetter|mpmb/i.test(`${metadata.title} ${metadata.creator} ${text(fields.SpellSheetInformation)}`) || (Object.hasOwn(fields, "Class and Levels") && Object.hasOwn(fields, "CurrentStats.Stringified"));
	if (!isMpmb) throw new Error("This does not appear to be an MPMB character sheet. Use the original filled-in MPMB PDF.");
	const get = (...names) => names.map(name => text(fields[name])).find(Boolean) || "";
	const warnings = [...extractionWarnings];
	const mappings = [];
	const unmatched = [];
	const preserve = (kind, name, description = "") => unmatched.push({kind, name: text(name).slice(0, 200), description: text(description).slice(0, 10000)});
	const saved = name => {
		if (!get(name)) return {};
		try { const result = parseMpmbLiteral(get(name).split("##########")[0]); return result && typeof result === "object" && !Array.isArray(result) ? result : {}; }
		catch { warnings.push(`The saved ${name.replace(".Stringified", "")} data was not a plain data object. Printed form values were used instead.`); return {}; }
	};
	const sourceText = [get("Class Features"), get("Racial Traits"), ...Object.keys(fields).filter(key => /^Feat Note \d+$/.test(key)).map(key => get(key))].join("\n");
	if (rules === "auto") rules = /\b(?:P24|XPHB|2024)\b/.test(sourceText) ? "2024" : "2014";
	if (!["2014", "2024"].includes(rules)) throw new Error("Choose 2014 or 2024 source matching.");
	const match = makeMatcher(catalog, rules, warnings, mappings);
	const name = get("PC Name", "Character Name");
	if (!name) throw new Error("This sheet has no saved character name. Fill and save it in your PDF editor before importing.");
	const c = createCharacter({name: name.slice(0, 200), rules});
	const engine = new CharacterEngine(catalog);
	const records = readClasses(fields, catalog);
	if (records.reduce((n, row) => n + row.level, 0) > 20) throw new Error("The imported class levels exceed 20.");
	const usedClasses = new Set();
	for (const record of records) {
		const entity = match("class", record.name);
		if (usedClasses.has(normalize(record.name))) throw new Error(`The class ${record.name} appears more than once. Check the PDF's class field.`);
		usedClasses.add(normalize(record.name));
		const row = createClass(entity || {name: record.name, source: "MPMB"});
		row.level = record.level;
		c.classes.push(row);
		if (!entity) { preserve("class", record.name, `Level ${record.level}${record.subclass ? `; subclass: ${record.subclass}` : ""}`); continue; }
		if (record.subclass) {
			const subclass = match("subclass", record.subclass, {filter: it => normalize(it.className) === normalize(entity.name) && it.classSource === entity.source});
			if (subclass) row.subclass = subclassUid(subclass);
			else preserve("subclass", record.subclass, `${entity.name} ${row.level}`);
		}
	}
	const totalLevel = c.classes.reduce((n, row) => n + row.level, 0);
	if (integer(fields["Character Level"]) && integer(fields["Character Level"]) !== totalLevel) warnings.push(`The class levels total ${totalLevel}, but the PDF's character-level field shows ${get("Character Level")}. Review the class levels.`);
	for (const [kind, field] of [["race", "Race"], ["background", "Background"]]) {
		const raw = get(field);
		const entity = (kind === "race" && get("Race Remember") ? match(kind, get("Race Remember").replaceAll("-", " ")) : null) || match(kind, raw);
		if (entity) c[kind] = uid(entity);
		else if (raw) { c[kind] = `${raw.slice(0, 190)}|MPMB`; preserve(kind, raw, get(kind === "race" ? "Racial Traits" : "Background Feature Description")); }
	}
	c.player = get("Player Name");
	c.experience = clamp(integer(fields["Total Experience"]), 0, 1000000000);
	const alignment = normalize(get("Alignment"));
	c.alignment = ({"lawful good": "LG", "neutral good": "NG", "chaotic good": "CG", "lawful neutral": "LN", "neutral": "N", "true neutral": "N", "chaotic neutral": "CN", "lawful evil": "LE", "neutral evil": "NE", "chaotic evil": "CE", "unaligned": "U"})[alignment] || (["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE", "U"].includes(alignment.toUpperCase()) ? alignment.toUpperCase() : "N");
	c.personality = get("Personality Trait", "Personality Traits"); c.ideals = get("Ideal", "Ideals"); c.bonds = get("Bond", "Bonds"); c.flaws = get("Flaw", "Flaws");
	c.appearance = ["Sex", "Age", "Height", "Weight", "Hair colour", "Eyes colour", "Skin colour"].filter(key => get(key)).map(key => `${key}: ${get(key)}`).join("\n");
	c.abilityMethod = "manual";
	for (const ability of ABILITIES) {
		const label = ability[0].toUpperCase() + ability.slice(1);
		const score = integer(fields[label]);
		if (score == null || score < 1 || score > 30) throw new Error(`The saved ${label} score is missing or outside 1–30.`);
		c.abilities[ability] = score;
		if (Object.hasOwn(fields, `${label} ST Prof`)) c.saves[ability] = checked(fields[`${label} ST Prof`]);
	}
	for (const [ix, skill] of Object.keys(SKILLS).entries()) {
		if (Object.hasOwn(fields, `${abbreviations[ix]} Prof`)) c.skills[skill] = checked(fields[`${abbreviations[ix]} Exp`]) ? 2 : checked(fields[`${abbreviations[ix]} Prof`]) ? 1 : 0;
	}
	for (const [kind, field] of [["light", "Proficiency Armor Light"], ["medium", "Proficiency Armor Medium"], ["heavy", "Proficiency Armor Heavy"], ["shield", "Proficiency Shields"]]) if (Object.hasOwn(fields, field)) c.armorTraining[kind] = checked(fields[field]);
	c.languages = [...new Set(Object.keys(fields).filter(key => /^Language \d+$/.test(key)).map(key => get(key).toLowerCase()).filter(Boolean))].join(", ");
	for (const key of Object.keys(fields).filter(key => /^Tool \d+$/.test(key))) {
		const tool = get(key).replace(/\s*\(expertise\)\s*$/i, "").toLowerCase();
		if (tool && safeKey(tool)) c.toolTraining[tool.slice(0, 200)] = /expertise/i.test(get(key)) ? 2 : 1;
	}
	c.tools = get("MoreProficiencies");
	for (const key of Object.keys(fields).filter(key => /^Feat Name \d+$/.test(key))) {
		if (!get(key)) continue;
		const index = key.match(/\d+$/)[0];
		const description = get(`Feat Description ${index}`);
		const entity = match("feat", get(key), {source: /\bP24\b/.test(get(`Feat Note ${index}`)) ? "XPHB" : ""});
		if (entity) { if (!c.feats.includes(uid(entity))) c.feats.push(uid(entity)); }
		else {
			const option = createCustomOption({kind: "feat", name: get(key).slice(0, 200), description: description.slice(0, 10000)});
			c.customOptions.push(option); c.feats.push(`custom:${option.id}`); preserve("feat", get(key), description);
		}
	}
	const featureChoices = saved("CurrentFeatureChoices.Stringified");
	const selectedFeatures = [];
	const collectFeatures = value => { if (typeof value === "string") selectedFeatures.push(value); else if (value && typeof value === "object") Object.values(value).forEach(collectFeatures); };
	collectFeatures(featureChoices);
	for (const name of new Set(selectedFeatures)) {
		const entity = match("optionalfeature", name);
		if (entity && !c.optionalFeatures.includes(uid(entity))) c.optionalFeatures.push(uid(entity));
		else if (!entity && name.trim()) preserve("feature choice", name);
	}
	// The form often stores edited final scores while its hidden base-score dialog is stale.
	// Preserve the authoritative visible scores and explicitly mark old bonuses as included.
	for (const origin of engine.getOrigins(c)) if (origin.entity.ability?.length) c.abilityChoices[origin.key] = {index: 0, bonuses: {}, included: true};
	for (const meta of engine.getClasses(c)) for (const feature of engine.getImprovements(meta)) meta.row.improvements[feature.level] = {mode: "included"};
	warnings.push("Imported scores include existing origin and level-up increases. Past ASI/feat acquisition levels were not inferred; review these before changing origins or reducing existing levels. Future level-ups work normally.");
	const itemRecords = [];
	for (const key of Object.keys(fields)) {
		const row = key.match(/^(Adventuring Gear|Extra\.Gear) Row (\d+)$/);
		if (row && get(key)) itemRecords.push({name: get(key), quantity: integer(fields[`${row[1]} Amount ${row[2]}`]) ?? 1, weight: Number(get(`${row[1]} Weight ${row[2]}`)) || 0, description: get(`${row[1]} Location.Row ${row[2]}`), equipped: false});
	}
	const addItem = record => {
		const entity = match("item", record.name);
		const existing = c.inventory.find(row => entity ? row.uid === uid(entity) : row.custom && itemKey(row.custom.name) === itemKey(record.name));
		if (existing) {
			if (!record.equipped) existing.quantity = clamp(existing.quantity + record.quantity, 0, 9999);
			if (record.equipped) existing.equipped = true;
			if (record.attuned) existing.attuned = true;
			if (existing.custom && record.attack) existing.custom.attack = record.attack;
			if (existing.custom && record.description && !existing.custom.description.includes(record.description)) existing.custom.description = [existing.custom.description, record.description].filter(Boolean).join("\n").slice(0, 10000);
			return existing;
		}
		const id = newId();
		const row = {id, uid: entity ? uid(entity) : `custom:${id}`, quantity: clamp(record.quantity, 0, 9999), equipped: !!record.equipped, attuned: !!record.attuned};
		if (!entity) { row.custom = {name: record.name.slice(0, 200), description: record.description.slice(0, 10000), weight: clamp(record.weight, 0, 100000), ...(record.attack ? {attack: record.attack} : {})}; preserve("item", record.name, record.description); }
		c.inventory.push(row);
		return row;
	};
	itemRecords.forEach(addItem);
	for (const [descriptionField, weightField] of [["AC Armor Description", "AC Armor Weight"], ["AC Shield Description", "AC Shield Weight"]]) if (get(descriptionField)) addItem({name: get(descriptionField), quantity: 1, weight: Number(get(weightField)) || 0, description: "Equipped in the imported sheet.", equipped: true});
	for (const key of Object.keys(fields).filter(key => /^(?:Extra\.)?Magic Item(?: Name)? \d+$/.test(key))) if (get(key)) {
		const index = key.match(/\d+$/)[0];
		const prefix = key.startsWith("Extra.") ? "Extra." : "";
		addItem({name: get(key), quantity: 1, weight: Number(get(`${prefix}Magic Item Weight ${index}`)) || 0, description: get(`${prefix}Magic Item Description ${index}`), equipped: true, attuned: checked(fields[`${prefix}Magic Item Attuned ${index}`])});
	}
	const attackNotes = [];
	for (const key of Object.keys(fields).filter(key => /^Attack\.\d+\.Weapon Selection$/.test(key))) {
		if (!get(key)) continue;
		const prefix = key.replace("Weapon Selection", "");
		const damage = get(`${prefix}Damage`);
		const toHit = integer(fields[`${prefix}To Hit`]);
		const rawRange = get(`${prefix}Range`);
		const description = [get(`${prefix}Description`), `Attack ${get(`${prefix}To Hit`)}; damage ${damage} ${get(`${prefix}Damage Type`)}; ${rawRange}`].filter(Boolean).join("\n");
		const isRanged = /ranged/i.test(rawRange) && !/melee/i.test(rawRange);
		const range = rawRange.match(/\d+\s*\/\s*\d+/)?.[0]?.replace(/\s/g, "") || rawRange.match(/\d+\s*ft\.?/i)?.[0] || "5 ft.";
		const attack = toHit != null && Math.abs(toHit) <= 100 && /^[0-9d+\- ]{1,100}$/.test(damage) ? {toHit, damage, damageType: get(`${prefix}Damage Type`).replace(/[<>{}]/g, "").slice(0, 200), range, reach: "5 ft.", isRanged, thrown: /melee/i.test(rawRange) && range.includes("/")} : null;
		const row = addItem({name: get(key), quantity: 1, weight: Number(get(`BlueText.${prefix}Weight`)) || 0, description, equipped: true, attack});
		if (Object.hasOwn(fields, `${prefix}Proficiency`)) row.proficient = checked(fields[`${prefix}Proficiency`]);
		const ability = get(`${prefix}Mod`).split(" ")[0].toLowerCase();
		if (ABILITIES.includes(ability)) row.ability = ability;
		attackNotes.push(`${get(key)}: ${description}`);
	}
	if (c.inventory.some(row => row.custom?.attack)) warnings.push("Unmatched weapons retain their printed attack and damage values. Match them to a library item to enable automatic scaling, or review them after leveling up.");
	c.equipmentApplied = c.inventory.length > 0;
	for (const [coin, field] of [["cp", "Copper Pieces"], ["sp", "Silver Pieces"], ["ep", "Electrum Pieces"], ["gp", "Gold Pieces"], ["pp", "Platinum Pieces"]]) c.currency[coin] = clamp(integer(fields[field]), 0, 1000000000);
	const spellState = saved("CurrentSpells.Stringified");
	for (const source of engine.derive(c).spellSources) {
		const sourceRecord = Object.entries(spellState).find(([key, value]) => normalize(key) === normalize(source.entity.name) || normalize(value?.name).includes(normalize(source.entity.name)))?.[1];
		const hint = `${get("Race Remember")} ${get("Racial Traits")} ${sourceRecord?.name || ""}`.toLowerCase();
		const named = source.groups.map((group, index) => ({group, index})).filter(({group}) => group.name && hint.includes(group.name.toLowerCase().replace(/\s+lineage$/, "")));
		const index = source.groups.length === 1 ? 0 : named.length === 1 ? named[0].index : -1;
		const ability = ABILITIES[Number(sourceRecord?.ability) - 1] || "";
		if (index >= 0) c.spellChoices[source.key] = {index, ability, chosen: {}};
	}
	let d = engine.derive(c);
	const granted = engine.getSpells(c, d);
	const spellRequests = [];
	for (const [owner, record] of Object.entries(spellState)) {
		if (!record || typeof record !== "object") continue;
		const classRow = c.classes.find(row => normalize(row.uid.split("|")[0]) === normalize(owner));
		for (const key of ["selectCa", "selectSp", "selectSpSB", "selectBo", "selectPrep"]) if (Array.isArray(record[key])) for (const name of record[key]) if (typeof name === "string" && name.trim()) spellRequests.push({name, classId: classRow?.id, prepared: key === "selectCa" || !Array.isArray(record.selectPrep) || record.selectPrep.some(prepared => normalize(prepared) === normalize(name))});
		for (const bonus of Object.values(record.bonus || {}).flat()) if (Array.isArray(bonus?.selection)) for (const name of bonus.selection) if (typeof name === "string") spellRequests.push({name, classId: classRow?.id, prepared: true});
	}
	for (const key of Object.keys(fields).filter(key => /(?:^|\.)spells\.name\.\d+$/.test(key))) {
		const value = get(key);
		if (!value || /^(spell|cantrips?|level\s+\d.*|\d.*level)$/i.test(value)) continue;
		const remember = get(key.replace(".name.", ".remember.")).split("##");
		const classRow = c.classes.find(row => normalize(row.uid.split("|")[0]) === normalize(remember[2]));
		const checkKey = key.replace(".name.", ".checkbox.");
		spellRequests.push({name: value, classId: classRow?.id, prepared: Object.hasOwn(fields, checkKey) ? checked(fields[checkKey]) : true, hasPrintedPreparation: Object.hasOwn(fields, checkKey)});
	}
	const unresolvedSpells = new Set();
	for (const request of spellRequests) {
		const entity = match("spell", request.name);
		if (!entity) { if (!unresolvedSpells.has(normalize(request.name))) preserve("spell", request.name); unresolvedSpells.add(normalize(request.name)); continue; }
		if (granted.some(it => normalize(it.entity.name) === normalize(entity.name) && (!request.classId || it.row.classId === request.classId))) continue;
		const owners = d.casting.casters.filter(caster => entity.level <= caster.maxSpellLevel && engine.spellAvailable(entity, caster));
		const classId = request.classId || (owners.length === 1 ? owners[0].row.id : d.casting.casters.length === 1 ? d.casting.casters[0].row.id : "");
		if (!classId) { if (!unresolvedSpells.has(normalize(request.name))) preserve("spell", request.name, "Spellcasting class or origin could not be determined."); unresolvedSpells.add(normalize(request.name)); continue; }
		const existing = c.spells.find(row => row.uid === uid(entity) && row.classId === classId);
		if (!existing) c.spells.push({uid: uid(entity), classId, prepared: request.prepared});
		else if (request.hasPrintedPreparation) existing.prepared = request.prepared;
	}
	// Allocate skill choices where the saved checkboxes identify them unambiguously.
	for (const group of d.proficiencies.groups.filter(it => !it.isExpertise && it.options.every(option => option.kind === "skill"))) {
		const choices = group.options.filter(option => option.isEligible && c.skills[option.key] > 0).map(option => option.id);
		if (choices.length === group.count) c.proficiencyChoices[group.key] = choices;
	}
	// Keep overrides only where the saved sheet differs from automatic training.
	const automatic = engine.derive({...c, skills: {}, saves: {}, armorTraining: {}});
	for (const [key, rank] of Object.entries(c.skills)) if (automatic.skills[key] === rank) delete c.skills[key];
	for (const [key, trained] of Object.entries(c.saves)) if ((automatic.saves[key] > automatic.mods[key]) === trained) delete c.saves[key];
	for (const [key, trained] of Object.entries(c.armorTraining)) if (automatic.proficiencies.armor.includes(key) === trained) delete c.armorTraining[key];
	d = engine.derive(c);
	for (const [key, field, current] of [["hp", "HP Max", d.hp], ["ac", "AC", d.ac], ["initiative", "Initiative bonus", d.initiative], ["speed", "Speed", d.speed.walk]]) {
		const wanted = key === "speed" ? integer(get(field).match(/^\d+/)?.[0]) : integer(fields[field]);
		if (wanted != null) c.adjustments[key] = clamp(wanted - current, -1000, 1000);
	}
	d = engine.derive(c);
	c.state.damage = clamp(d.hp - (integer(fields["HP Current"]) ?? d.hp), 0, d.hp);
	c.state.tempHp = clamp(integer(fields["HP Temp"]), 0, 100000);
	c.state.inspiration = checked(fields.Inspiration);
	c.state.deathSuccess = [1, 2, 3].filter(index => checked(fields[`Death Save Success${index}`])).length;
	c.state.deathFailure = [1, 2, 3].filter(index => checked(fields[`Death Save Fail${index}`])).length;
	c.state.exhaustion = clamp(integer(get("Extra.Exhaustion Level", "Exhaustion Level")), 0, 6);
	for (const key of Object.keys(fields).filter(key => /^Extra\.Condition[ .]/.test(key))) if (checked(fields[key])) c.state.conditions.push(key.replace(/^Extra\.Condition[ .]/, ""));
	for (const key of Object.keys(fields).filter(key => /^Limited Feature \d+$/.test(key))) {
		if (!get(key)) continue;
		const index = key.match(/\d+$/)[0];
		const max = integer(fields[`Limited Feature Max Usages ${index}`]);
		const used = integer(fields[`Limited Feature Used ${index}`]) || 0;
		const name = get(key);
		const resource = d.resources.find(it => normalize(it.name.replace(/\s*\([^)]*\)$/, "")) === normalize(name));
		if (resource) c.state.resources[resource.id] = clamp(used, 0, resource.max);
		else if (max > 0 && max <= 10000) {
			const id = newId(); const recoveryText = get(`Limited Feature Recovery ${index}`).toLowerCase();
			c.resources.push({id, name: name.slice(0, 200), max, recovery: /short|^sr$/.test(recoveryText) ? "short" : /long|^lr$/.test(recoveryText) ? "long" : "manual"}); c.state.resources[id] = clamp(used, 0, max);
		} else preserve("resource", name, `Maximum ${get(`Limited Feature Max Usages ${index}`)}; used ${used}; recovery ${get(`Limited Feature Recovery ${index}`)}`);
	}
	for (let index = 1; index <= 3; ++index) {
		const faces = integer(fields[`HD${index} Die`]); let used = integer(fields[`HD${index} Used`]) || 0;
		for (const [id, die] of Object.entries(d.hitDice).filter(([, die]) => die.faces === faces)) { c.state.hitDice[id] = Math.min(used, die.max); used -= c.state.hitDice[id]; }
	}
	for (let level = 1; level <= 9; ++level) {
		const sets = Object.keys(fields).filter(key => key.endsWith(`SpellSlots.CheckboxesSet.lvl${level}`));
		const used = Math.max(0, ...sets.map(key => {
			const count = integer(fields[key]) || 0;
			const suffixes = count === 1 ? ["mid"] : count === 2 ? ["top1", "bottom1"] : count === 3 ? ["top2.1", "top2.2", "bottom1"] : ["top2.1", "top2.2", "bottom2.1", "bottom2.2"];
			const prefix = key.replace(`CheckboxesSet.lvl${level}`, `Checkboxes.lvl${level}.`);
			return count ? suffixes.filter(suffix => checked(fields[prefix + suffix])).length : 0;
		}));
		const pact = d.casting.casters.find(it => it.pact?.level === level);
		if (pact && d.casting.slots[level - 1] && used) warnings.push(`Level ${level} slot usage cannot be split between Pact Magic and regular slots; set those used slots after import.`);
		else if (pact) c.state.pact[pact.row.id] = clamp(used, 0, pact.pact.max);
		else c.state.slots[level] = clamp(used, 0, d.casting.slots[level - 1] || 0);
	}
	if (unmatched.length) warnings.push(`${unmatched.length} entries need a library match or manual review. Custom feats, items, and source notes have been retained.`);
	const adjustments = Object.entries(c.adjustments).filter(([, value]) => value);
	if (adjustments.length) warnings.push(`Adjustments preserve the PDF's current totals: ${adjustments.map(([key, value]) => `${key} ${value > 0 ? "+" : ""}${value}`).join(", ")}. Review these when changing equipment or effects.`);
	const notes = Object.keys(fields).filter(key => /^(Notes\.(Left|Right)|Extra\.Notes|Character History|Background_History|Background Feature Description|Allies|Organizations|Treasure|Valuables)/.test(key)).filter(key => get(key)).map(key => `${key}\n${get(key)}`);
	c.notes = [...notes, `Imported from ${fileName}.`, `Original class entry: ${get("Class and Levels")}`, get("Racial Traits") ? `Original species traits\n${get("Racial Traits")}` : "", get("Class Features") ? `Original class features\n${get("Class Features")}` : "", itemRecords.some(it => it.description) ? `Equipment locations / notes\n${itemRecords.filter(it => it.description).map(it => `${it.name}: ${it.description}`).join("\n")}` : "", attackNotes.length ? `Original attacks\n${attackNotes.join("\n\n")}` : "", unmatched.length ? `Entries to review\n${unmatched.map(it => `${it.kind}: ${it.name}${it.description ? `\n${it.description}` : ""}`).join("\n\n")}` : ""].filter(Boolean).join("\n\n");
	if (c.notes.length > 100000) throw new Error("The character has more notes than can be imported (100,000 characters). Split the extra notes into a separate file first.");
	c.importedMpmb = {fileName: fileName.slice(0, 255), title: String(metadata.title || "").slice(0, 500), warnings: [...new Set(warnings)].slice(0, 500), unmatched: unmatched.slice(0, 500), importedAt: Date.now()};
	const character = importCharacters(exportCharacters([c]), {keepIds: true})[0];
	return {character, warnings: character.importedMpmb.warnings, mappings, summary: {level: totalLevel, classes: character.classes.map(row => `${row.uid.split("|")[0]} ${row.level}`), items: c.inventory.length, customItems: c.inventory.filter(row => row.custom).length, feats: c.feats.length, spells: engine.getSpells(c, engine.derive(c)).length, unmatched: unmatched.length}};
}
