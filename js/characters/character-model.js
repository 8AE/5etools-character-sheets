export const CHARACTER_VERSION = 1;
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
export const SKILLS = {
	"acrobatics": "dex", "animal handling": "wis", "arcana": "int", "athletics": "str",
	"deception": "cha", "history": "int", "insight": "wis", "intimidation": "cha",
	"investigation": "int", "medicine": "wis", "nature": "int", "perception": "wis",
	"performance": "cha", "persuasion": "cha", "religion": "int", "sleight of hand": "dex",
	"stealth": "dex", "survival": "wis",
};
export const uid = entity => entity ? entity._customId ? `custom:${entity._customId}` : `${entity.name}|${entity.source}` : "";
export const subclassUid = entity => entity ? `${uid(entity)}|${entity.className}|${entity.classSource}` : "";
export const newId = () => globalThis.crypto?.randomUUID?.() ?? CryptUtil.uid();
export const modifier = score => Math.floor((score - 10) / 2);
export const signed = value => `${value >= 0 ? "+" : ""}${value}`;
export const clamp = (n, min, max) => Math.max(min, Math.min(max, Number(n) || 0));
export const plain = value => String(value ?? "").replace(/\{@(\w+) ([^{}]+)}/g, (m, tag, s) => tag === "filter" ? s.split("|")[0] : s.split("|")[2] || s.split("|")[0]);
export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[ch]));
// User text is not 5etools renderer markup. Keep it literal even inside a stat block.
export const rendererText = value => escapeHtml(value).replaceAll("{", "&#123;").replaceAll("}", "&#125;");

export const CUSTOM_OPTION_KINDS = ["language", "tool", "feat", "optionalfeature"];
export const customOptionLabel = kind => ({language: "language", tool: "tool", feat: "feat", optionalfeature: "feature"})[kind];

export function createCustomOption ({kind, name, description = "", id = newId()}) {
	assert(CUSTOM_OPTION_KINDS.includes(kind), "Invalid custom option type.");
	assert(typeof id === "string" && /^[a-z0-9_-]{1,80}$/.test(id), "Invalid custom option ID.");
	assert(typeof name === "string" && name.trim().length > 0 && name.trim().length <= 200, "Custom names must contain 1–200 characters.");
	assert(typeof description === "string" && description.length <= 10000, "Custom descriptions must be shorter than 10,001 characters.");
	return {id, kind, name: name.trim(), description};
}

/** Keep custom text separate from library rules and never execute renderer tags from it. */
export function getCustomOptions (character, kind) {
	return (character.customOptions || []).filter(it => it.kind === kind).map(it => ({
		name: it.name, source: "CSH", _customId: it.id,
		entries: it.description.split(/\r?\n/).filter(Boolean).map(rendererText),
	}));
}

export function getCharacterOption (character, catalog, kind, ref) {
	return ref?.startsWith("custom:") ? getCustomOptions(character, kind).find(it => uid(it) === ref) : catalog.get(kind, ref);
}

export function createCharacter ({name = "New character", rules = "2024"} = {}) {
	return {
		id: newId(), name, source: "CSH", rules, player: "", alignment: "N", race: "", background: "", size: "", experience: 0,
		classes: [], abilities: {str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8},
		abilityMethod: "standard", abilityChoices: {}, skillChoices: {}, proficiencyChoices: {}, proficiencyPatterns: {}, defenseChoices: {}, featureChoices: {}, spellChoices: {}, skills: {}, saves: {}, armorTraining: {}, toolTraining: {},
		feats: [], optionalFeatures: [], customOptions: [], inventory: [], spells: [], resources: [],
		currency: {cp: 0, sp: 0, ep: 0, gp: 0, pp: 0},
		adjustments: {ac: 0, hp: 0, speed: 0, initiative: 0, spellAttack: 0, spellDc: 0, attack: 0, damage: 0},
		state: {damage: 0, tempHp: 0, slots: {}, pact: {}, hitDice: {}, resources: {}, lastSpellLevels: {}, deathSuccess: 0, deathFailure: 0, conditions: [], concentration: "", inspiration: false, exhaustion: 0},
		notes: "", appearance: "", personality: "", ideals: "", bonds: "", flaws: "", languages: "", tools: "", log: [],
		created: Date.now(), updated: Date.now(),
	};
}

export function createClass (entity) {
	return {id: newId(), uid: uid(entity), level: 1, subclass: "", hpRolls: {}, improvements: {}, options: {}};
}

export function exportCharacters (characters) {
	return {
		_meta: {sources: [{json: "CSH", abbreviation: "CSH", full: "Character Sheets", authors: [], version: String(CHARACTER_VERSION)}]},
		fileType: "5etools-characters", version: CHARACTER_VERSION,
		character: structuredClone(characters),
	};
}

function assert (condition, message) {
	if (!condition) throw new Error(message);
}

function checkTree (value, depth = 0) {
	assert(depth < 24, "Character data is nested too deeply.");
	if (value == null) return;
	if (typeof value === "string") assert(value.length <= 100000, "A text field is too long.");
	if (typeof value === "number") assert(Number.isFinite(value), "Numbers must be finite.");
	if (typeof value !== "object") return;
	assert(Object.keys(value).length <= 2000, "A collection contains too many entries.");
	for (const [key, child] of Object.entries(value)) {
		assert(!["__proto__", "prototype", "constructor"].includes(key), "Unsafe property in character data.");
		checkTree(child, depth + 1);
	}
}

function checkShape (value, example, path) {
	if (Array.isArray(example)) return assert(Array.isArray(value), `${path} must be an array.`);
	assert(typeof value === typeof example && value !== null, `${path} has the wrong type.`);
	if (typeof example !== "object") return;
	assert(!Array.isArray(value), `${path} must be an object.`);
	for (const [key, template] of Object.entries(example)) {
		if (value[key] == null) value[key] = structuredClone(template);
		else checkShape(value[key], template, `${path}.${key}`);
	}
}

function numberMap (map, min = 0, max = 10000) {
	for (const value of Object.values(map)) assert(typeof value === "number" && Number.isFinite(value) && value >= min && value <= max, "Invalid numeric value in character data.");
}

/** Validate the whole file before returning anything; imports are append-only and atomic. */
export function importCharacters (json, {keepIds = false} = {}) {
	checkTree(json);
	assert(json?.fileType === "5etools-characters", "This is not a character-sheet export (fileType: 5etools-characters).");
	assert(json.version === CHARACTER_VERSION, `Unsupported character file version: ${json.version}. Expected ${CHARACTER_VERSION}.`);
	assert(Array.isArray(json.character) && json.character.length > 0 && json.character.length <= 200, "The file must contain 1–200 characters.");
	const characters = structuredClone(json.character);
	const ids = new Set();
	for (const character of characters) {
		assert(character && typeof character === "object" && !Array.isArray(character), "Invalid character.");
		const defaults = createCharacter();
		for (const [key, template] of Object.entries(defaults)) {
			if (character[key] == null) character[key] = template;
			else checkShape(character[key], template, key);
		}
		assert(character.name.trim().length > 0 && character.name.length <= 200, "Character names must contain 1–200 characters.");
		assert(["2014", "2024"].includes(character.rules), "Rules must be 2014 or 2024.");
		assert(character.customOptions.length <= 200, "A character can contain at most 200 custom options.");
		const customIds = new Set();
		character.customOptions = character.customOptions.map(option => {
			assert(option && typeof option === "object" && !Array.isArray(option), "Invalid custom option.");
			assert(typeof option.id === "string", "Missing custom option ID.");
			const valid = createCustomOption(option);
			assert(!customIds.has(valid.id), "Custom option IDs must be unique.");
			customIds.add(valid.id);
			return valid;
		});
		assert(["", "T", "S", "M", "L", "H", "G"].includes(character.size), "Invalid character size.");
		assert(Number.isInteger(character.experience) && character.experience >= 0 && character.experience <= 1000000000, "Invalid experience points.");
		assert(character.classes.length <= 20, "Too many classes.");
		const classIds = new Set();
		let totalLevel = 0;
		for (const cls of character.classes) {
			checkShape(cls, {id: "", uid: "", level: 1, subclass: "", hpRolls: {}, improvements: {}, options: {}}, "class");
			assert(cls.id && !classIds.has(cls.id), "Class IDs must be unique.");
			classIds.add(cls.id);
			assert(Number.isInteger(cls.level) && cls.level >= 1 && cls.level <= 20, "Class levels must be integers from 1 to 20.");
			numberMap(cls.hpRolls, 1, 100);
			for (const choices of Object.values(cls.options)) assert(Array.isArray(choices) && choices.every(ref => typeof ref === "string"), "Invalid class feature choices.");
			for (const choice of Object.values(cls.improvements)) {
				assert(choice && ["asi", "feat", "included"].includes(choice.mode), "Invalid level-up choice.");
				if (choice.mode === "asi") { assert(choice.abilities && typeof choice.abilities === "object", "Missing ability increases."); numberMap(choice.abilities, 0, 2); }
				if (choice.mode === "feat") assert(typeof choice.feat === "string", "Invalid feat reference.");
			}
			totalLevel += cls.level;
		}
		assert(totalLevel <= 20, "Total character level cannot exceed 20.");
		for (const key of ABILITIES) assert(Number.isInteger(character.abilities[key]) && character.abilities[key] >= 1 && character.abilities[key] <= 30, "Ability scores must be integers from 1 to 30.");
		for (const value of Object.values(character.saves)) assert(typeof value === "boolean", "Invalid saving throw proficiency.");
		for (const [key, value] of Object.entries(character.armorTraining)) assert(["light", "medium", "heavy", "shield"].includes(key) && typeof value === "boolean", "Invalid armor training override.");
		for (const [key, value] of Object.entries(character.toolTraining)) assert(key.length > 0 && key.length <= 200 && [1, 2].includes(value), "Invalid additional tool training.");
		numberMap(character.skills, 0, 2);
		numberMap(character.adjustments, -1000, 1000);
		numberMap(character.currency, 0, 1000000000);
		for (const key of ["slots", "pact", "hitDice", "resources"]) numberMap(character.state[key]);
		numberMap(character.state.lastSpellLevels, 0, 9);
		for (const key of ["damage", "tempHp", "deathSuccess", "deathFailure", "exhaustion"]) assert(Number.isInteger(character.state[key]) && character.state[key] >= 0 && character.state[key] <= 100000, `Invalid ${key}.`);
		assert(character.state.conditions.every(it => typeof it === "string"), "Invalid conditions.");
		for (const key of ["feats", "optionalFeatures"]) assert(character[key].every(it => typeof it === "string"), `Invalid ${key} references.`);
		for (const entry of character.inventory) {
			checkShape(entry, {id: "", uid: "", quantity: 1, equipped: false, attuned: false}, "inventory entry");
			assert(Number.isInteger(entry.quantity) && entry.quantity >= 0 && entry.quantity <= 9999, "Item quantities must be integers from 0 to 9999.");
			if (entry.proficient != null) assert(typeof entry.proficient === "boolean", "Invalid weapon proficiency.");
			if (entry.custom != null) {
				checkShape(entry.custom, {name: "", description: "", weight: 0}, "custom item");
				assert(entry.custom.name.trim().length > 0 && entry.custom.name.length <= 200, "Invalid custom item name.");
				assert(entry.custom.description.length <= 10000 && Number.isFinite(entry.custom.weight) && entry.custom.weight >= 0 && entry.custom.weight <= 100000, "Invalid custom item details.");
				if (entry.custom.attack != null) {
					const attack = entry.custom.attack;
					checkShape(attack, {toHit: 0, damage: "", damageType: "", range: "5 ft.", reach: "5 ft.", isRanged: false, thrown: false}, "imported attack");
					assert(Number.isInteger(attack.toHit) && Math.abs(attack.toHit) <= 100 && /^[0-9d+\- ]{1,100}$/.test(attack.damage), "Invalid imported attack values.");
					assert([attack.damageType, attack.range, attack.reach].every(it => it.length <= 200 && !/[<>{}]/.test(it)), "Invalid imported attack text.");
				}
			}
		}
		for (const entry of character.spells) {
			checkShape(entry, {uid: "", classId: "", prepared: true}, "spell");
			if (entry.ritualAllowed != null) assert(typeof entry.ritualAllowed === "boolean", "Invalid ritual casting override.");
		}
		for (const entry of character.resources) {
			checkShape(entry, {id: "", name: "", max: 1, recovery: "long"}, "resource");
			assert(Number.isInteger(entry.max) && entry.max >= 1 && entry.max <= 10000 && ["short", "long", "manual"].includes(entry.recovery), "Invalid resource.");
		}
		for (const choice of Object.values(character.abilityChoices)) {
			checkShape(choice, {index: 0, bonuses: {}}, "ability choice");
			numberMap(choice.bonuses, 0, 3);
			if (choice.included != null) assert(typeof choice.included === "boolean", "Invalid imported ability state.");
		}
		for (const choices of [...Object.values(character.skillChoices), ...Object.values(character.proficiencyChoices), ...Object.values(character.featureChoices), ...Object.values(character.defenseChoices)]) assert(Array.isArray(choices) && choices.every(it => typeof it === "string"), "Invalid feature or proficiency choice.");
		for (const index of Object.values(character.proficiencyPatterns)) assert(Number.isInteger(index) && index >= 0 && index <= 100, "Invalid proficiency pattern.");
		for (const choice of Object.values(character.spellChoices)) {
			checkShape(choice, {index: 0, ability: "", chosen: {}}, "spell choice");
			assert(Number.isInteger(choice.index) && choice.index >= -1 && choice.index <= 100, "Invalid spell option index.");
			assert(!choice.ability || ABILITIES.includes(choice.ability), "Invalid spellcasting ability.");
			for (const refs of Object.values(choice.chosen)) assert(Array.isArray(refs) && refs.every(it => typeof it === "string"), "Invalid granted spell choices.");
		}
		if (character.importedMpmb != null) {
			checkShape(character.importedMpmb, {fileName: "", title: "", warnings: [], unmatched: [], importedAt: 0}, "MPMB import record");
			assert(character.importedMpmb.fileName.length <= 255 && character.importedMpmb.title.length <= 500 && character.importedMpmb.warnings.length <= 500 && character.importedMpmb.unmatched.length <= 500, "MPMB import record is too large.");
			assert(character.importedMpmb.warnings.every(it => typeof it === "string"), "Invalid MPMB import warnings.");
			for (const entry of character.importedMpmb.unmatched) {
				checkShape(entry, {kind: "", name: "", description: ""}, "MPMB unmatched entry");
				assert(entry.name.length <= 200 && entry.description.length <= 10000, "MPMB unmatched entry is too large.");
			}
		}
		assert(character.log.every(it => typeof it === "string"), "Invalid play log.");
		character.id = keepIds ? character.id : newId();
		assert(!ids.has(character.id), "Duplicate character ID.");
		ids.add(character.id);
	}
	return characters;
}

/** Small arithmetic dice grammar; never execute imported formulas. */
export function rollDice (expression, random = Math.random) {
	const text = String(expression).replace(/\s+/g, "").toLowerCase();
	assert(text.length <= 1000, "Dice expressions must be shorter than 1,000 characters.");
	assert(/^[+-]?(?:\d*d\d+|\d+)(?:[+-](?:\d*d\d+|\d+))*$/.test(text), "Use a dice expression such as 1d20+5 or 2d6+3.");
	let total = 0;
	const detail = [];
	for (const token of text.match(/[+-]?[^+-]+/g)) {
		const sign = token.startsWith("-") ? -1 : 1;
		const term = token.replace(/^[+-]/, "");
		if (!term.includes("d")) { total += sign * Number(term); detail.push(token); continue; }
		const [countRaw, facesRaw] = term.split("d");
		const count = Number(countRaw || 1);
		const faces = Number(facesRaw);
		assert(count >= 1 && count <= 100 && faces >= 2 && faces <= 1000, "Dice must have 2–1000 sides, with at most 100 dice per term.");
		const rolls = Array.from({length: count}, () => Math.floor(random() * faces) + 1);
		total += sign * rolls.reduce((a, b) => a + b, 0);
		detail.push(`${sign < 0 ? "−" : "+"}[${rolls.join(", ")}]`);
	}
	assert(Number.isSafeInteger(total), "Dice result is out of range.");
	return {total, detail: detail.join(" "), expression};
}
