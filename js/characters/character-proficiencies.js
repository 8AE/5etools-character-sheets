import {SKILLS, plain, getCustomOptions, uid} from "./character-model.js";

const lower = value => String(value || "").toLowerCase();
const title = value => value.replace(/\b\w/g, letter => letter.toUpperCase());
const PROPERTIES = {
	skillProficiencies: ["skill", "Skills"], toolProficiencies: ["tool", "Tools"],
	languageProficiencies: ["language", "Languages"], weaponProficiencies: ["weapon", "Weapons"],
	armorProficiencies: ["armor", "Armor"], skillToolLanguageProficiencies: ["mixed", "Skills, tools, or languages"],
	expertise: ["expertise", "Expertise"],
};
const itemType = item => item.type?.split("|")[0];
const isMundane = item => !item.bonusWeapon && !item.bonusWeaponAttack && (!item.rarity || ["none", "unknown"].includes(item.rarity));
const CATALOG_OPTIONS = new WeakMap();

/** The same structured weapon filters used by starting proficiencies and feats. */
export function matchesWeaponFilter (item, filter) {
	if (!item.dmg1) return false;
	return String(filter).toLowerCase().split("|").every(part => {
		const [key, raw] = part.split("=");
		const values = raw?.split(";") || [];
		if (key === "type") return values.some(value => value === `${item.weaponCategory} weapon` || (value === "mundane weapon" && isMundane(item)) || (value === "simple melee weapon" && item.weaponCategory === "simple" && itemType(item) === "M"));
		if (key === "property") return values.some(value => (item.property || []).some(prop => typeof prop === "string" && prop.split("|")[0] === ({finesse: "F", light: "L", thrown: "T", "two-handed": "2H"})[value]));
		if (key === "miscellaneous") return values.every(value => value === "mundane" && isMundane(item));
		return false;
	});
}

/** Explicit adapters for core features whose proficiency grants are only prose.
 * The entities and unlock levels still come from the local class JSON. These
 * checks deliberately include class/source; same-named homebrew is not guessed.
 */
function withCoreFeatureGrants (entity) {
	const out = {...entity};
	if (!["PHB", "XPHB", "TCE"].includes(entity.source)) return out;
	const {name, className, source} = entity;
	if (name === "Expertise" && ["Rogue", "Bard", "Ranger"].includes(className)) {
		out.expertise ||= className === "Rogue" && source === "PHB"
			? [{choose: {from: ["anyProficientSkill", "thieves' tools"], count: 2}}]
			: [{anyProficientSkill: 2}];
	}
	if (name === "Scholar" && className === "Wizard" && source === "XPHB") out.expertise ||= [{choose: {from: ["arcana", "history", "investigation", "medicine", "nature", "religion"]}}];
	if (name === "Deft Explorer" && className === "Ranger" && source === "XPHB") {
		out.expertise ||= [{anyProficientSkill: 1}];
		out.languageProficiencies ||= [{anyLanguage: 2}];
	}
	if (name === "Thieves' Cant" && className === "Rogue") out.languageProficiencies ||= [{"thieves' cant": true, ...(source === "XPHB" ? {anyLanguage: 1} : {})}];
	if (name === "Druidic" && className === "Druid") out.languageProficiencies ||= [{druidic: true}];
	if (name === "Warden" && className === "Druid" && source === "XPHB") { out.weaponProficiencies ||= [{martial: true}]; out.armorProficiencies ||= [{medium: true}]; }
	if (name === "Protector" && className === "Cleric" && source === "XPHB") { out.weaponProficiencies ||= [{martial: true}]; out.armorProficiencies ||= [{heavy: true}]; }
	if (name === "Bonus Proficiencies" && className === "Bard" && entity.subclassShortName === "Lore") out.skillProficiencies ||= [{any: 3}];
	if (name === "Bonus Proficiencies" && className === "Bard" && entity.subclassShortName === "Valor") { out.weaponProficiencies ||= [{martial: true}]; out.armorProficiencies ||= [{medium: true, shield: true}]; }
	if (name === "Bonus Proficiencies" && className === "Rogue" && entity.subclassShortName === "Assassin") out.toolProficiencies ||= [{"disguise kit": true, "poisoner's kit": true}];
	return out;
}

export function getProficiencyOrigins ({character, classes, origins, features}) {
	const out = origins.map(origin => ({...origin, entity: withCoreFeatureGrants(origin.entity)}));
	for (const [ix, meta] of classes.entries()) {
		const profs = (ix ? meta.entity.multiclassing?.proficienciesGained : meta.entity.startingProficiencies) || {};
		const weapons = Object.fromEntries((profs.weapons || []).filter(it => typeof it === "string" && !it.includes("{@filter")).map(it => [lower(plain(it)).replace(/s$/, ""), true]));
		// Category names are not plural; preserve "firearms" if explicitly granted.
		for (const it of (profs.weapons || []).filter(it => typeof it === "string" && ["simple", "martial", "firearms"].includes(it))) weapons[it] = true;
		out.push({key: `class:${meta.row.id}`, entity: {name: meta.entity.name, source: meta.entity.source, skillProficiencies: profs.skills, toolProficiencies: profs.toolProficiencies, armorProficiencies: profs.armorProficiencies, weaponProficiencies: profs.weaponProficiencies || [weapons]}});
	}
	for (const feature of features) {
		const entity = withCoreFeatureGrants(feature.entity);
		out.push({key: `feature:${feature.classId}:${entity.name}:${entity.source}:${entity.level}:${entity.subclassShortName || ""}`, entity});
	}
	// Player's Handbook (2024), chapter 2, "Choose Languages" (p37).
	if (classes[0]?.entity.edition === "one") out.unshift({key: "character-languages-2024", entity: {name: "Starting languages", source: "XPHB", languageProficiencies: [{common: true, anyStandardLanguage: 2}]}});
	return out;
}

export function deriveProficiencies (character, {catalog, origins, features}) {
	const learned = {skill: Object.fromEntries(Object.keys(SKILLS).map(key => [key, 0])), tool: Object.create(null), language: Object.create(null), weapon: {}, armor: {}};
	for (const [name, rank] of Object.entries(character.toolTraining || {})) learned.tool[lower(name)] = rank;
	const groups = [];
	const patterns = [];
	const warnings = [];
	const options = new Map();
	const option = (kind, name, entity) => {
		const key = lower(name.split("|")[0]);
		const id = `${kind}:${key}`;
		if (!options.has(id)) options.set(id, {id, kind, key, label: entity?.name || title(key), source: entity?.source || ""});
		return options.get(id);
	};
	for (const name of Object.keys(SKILLS)) option("skill", name);
	for (const entity of catalog.list("language")) option("language", entity.name, entity);
	if (!CATALOG_OPTIONS.has(catalog)) CATALOG_OPTIONS.set(catalog, {
		tools: catalog.list("item").filter(it => ["AT", "INS", "GS", "T"].includes(itemType(it)) && isMundane(it)),
		weapons: catalog.list("item").filter(it => it.dmg1 && isMundane(it)),
	});
	const {tools, weapons} = CATALOG_OPTIONS.get(catalog);
	const customOptions = ["tool", "language"].flatMap(kind => getCustomOptions(character, kind).map(entity => ({id: uid(entity), kind, key: lower(entity.name), label: entity.name, source: "CSH", isCustom: true})));
	for (const entity of tools) option("tool", entity.name, entity);
	for (const entity of weapons) option("weapon", entity.name, entity);
	const standardSource = origins.some(it => it.key === "character-languages-2024") ? "XPHB" : "PHB";
	const expand = (key, kind) => {
		if (["any", "anySkill", "anyProficientSkill"].includes(key) && ["skill", "mixed", "expertise"].includes(kind)) return Object.keys(SKILLS).map(name => option("skill", name));
		if (["anyTool", "anyArtisansTool", "anyMusicalInstrument", "anyGamingSet", "anyProficientTool"].includes(key) || (key === "any" && kind === "tool") || ["musical instrument", "gaming set", "artisan's tools"].includes(key)) {
			const type = {anyArtisansTool: "AT", anyMusicalInstrument: "INS", anyGamingSet: "GS", "musical instrument": "INS", "gaming set": "GS", "artisan's tools": "AT"}[key];
			return tools.filter(it => !type || itemType(it) === type).map(it => option("tool", it.name, it));
		}
		if (["anyLanguage", "anyStandard", "anyStandardLanguage", "anyExoticLanguage", "anyRareLanguage"].includes(key) || (key === "any" && kind === "language") || (key === "other" && kind === "language")) {
			const type = {anyStandardLanguage: "standard", anyExoticLanguage: "exotic", anyRareLanguage: "rare"}[key];
			return catalog.list("language").filter(it => !type || (it.type === type && it.source === standardSource)).filter(it => !["secret", "creature"].includes(it.type)).map(it => option("language", it.name, it));
		}
		const actualKind = kind === "mixed" || kind === "expertise" ? (key in SKILLS ? "skill" : options.has(`language:${key}`) ? "language" : "tool") : kind;
		return [option(actualKind, key)];
	};
	const add = (entry, rank = 1) => { learned[entry.kind][entry.key] = Math.max(learned[entry.kind][entry.key] || 0, rank); };
	for (const origin of origins) {
		for (const [prop, [kind, label]] of Object.entries(PROPERTIES)) {
			const rules = origin.entity[prop];
			if (!rules?.length) continue;
			const patternKey = `${origin.key}:${prop}`;
			const index = character.proficiencyPatterns?.[patternKey] || 0;
			const rule = rules[index] || rules[0];
			if (rules.length > 1) patterns.push({key: patternKey, title: `${origin.entity.name}: ${label}`, index, rules});
			const addGroup = (suffix, count, choices, {isExpertise = kind === "expertise", legacy = false} = {}) => {
				const key = `${patternKey}:${index}:${suffix}`;
				const selected = character.proficiencyChoices?.[key] ?? (legacy ? (character.skillChoices[origin.key] || []).map(it => `skill:${it}`) : []);
				const customKinds = ["tool", "language"].filter(type => kind === type || (kind === "mixed" && choices.some(it => it.kind === type)));
				const custom = customOptions.filter(it => customKinds.includes(it.kind) || (isExpertise && it.kind === "tool" && choices.some(choice => choice.kind === "tool" && choice.key === it.key)));
				groups.push({key, origin: origin.key, title: `${origin.entity.name}: ${label}`, count, options: [...new Map([...choices, ...custom].map(it => [it.id, it])).values()], selected, isExpertise, customKinds});
			};
			for (const [key, value] of Object.entries(rule)) {
				if (key === "choose") {
					for (const [ix, choose] of (Array.isArray(value) ? value : [value]).entries()) {
						const choices = choose.fromFilter ? weapons.filter(it => matchesWeaponFilter(it, choose.fromFilter)).map(it => option("weapon", it.name, it)) : (choose.from || []).flatMap(it => expand(it, kind));
						addGroup(`choose:${ix}`, choose.count || 1, choices, {legacy: prop === "skillProficiencies" && index === 0 && ix === 0});
					}
				} else if (key === "all" && value.fromFilter) {
					for (const item of weapons.filter(it => matchesWeaponFilter(it, value.fromFilter))) add(option("weapon", item.name, item));
				} else if (key.startsWith("any") || key === "other" || ["musical instrument", "gaming set", "artisan's tools"].includes(key)) {
					addGroup(key, Number(value) || 1, expand(key, kind), {legacy: prop === "skillProficiencies" && index === 0});
				} else if (value === true) add(expand(key, kind)[0], kind === "expertise" ? 2 : 1);
			}
		}
	}
	// Proficiency choices must resolve before expertise eligibility is evaluated.
	let isExpertisePass = false;
	for (const group of groups.sort((a, b) => Number(a.isExpertise) - Number(b.isExpertise))) {
		if (group.isExpertise && !isExpertisePass) {
			for (const [key, value] of Object.entries(character.skills)) if (key in learned.skill) learned.skill[key] = value;
			isExpertisePass = true;
		}
		group.options = group.options.filter(it => !group.isExpertise || learned[it.kind][it.key] === 1 || group.selected.includes(it.id)).map(it => ({...it, isEligible: group.isExpertise ? learned[it.kind][it.key] === 1 : !learned[it.kind][it.key]}));
		const unique = [...new Set(group.selected)];
		const chosen = unique.map(id => group.options.find(it => it.id === id)).filter(Boolean);
		const valid = unique.length === group.count && chosen.length === group.count && new Set(chosen.map(it => `${it.kind}:${it.key}`)).size === chosen.length && chosen.every(it => it.isEligible);
		group.valid = valid;
		if (!valid) warnings.push(`${group.title}: choose ${group.count} different ${group.isExpertise ? "proficiencies without expertise" : "new proficiencies"} (${chosen.length} selected).`);
		else chosen.forEach(it => add(it, group.isExpertise ? 2 : 1));
	}
	if (features.some(it => it.entity.name === "Tool Expertise" && it.entity.className === "Artificer" && it.entity.source === "TCE")) for (const key of Object.keys(learned.tool)) learned.tool[key] = 2;
	for (const [key, value] of Object.entries(character.skills)) if (key in learned.skill) learned.skill[key] = value;
	for (const [key, value] of Object.entries(character.armorTraining || {})) { if (value) learned.armor[key] = 1; else delete learned.armor[key]; }
	return {skills: learned.skill, tools: learned.tool, languages: Object.keys(learned.language), weapons: Object.keys(learned.weapon), armor: Object.keys(learned.armor), groups, patterns, warnings};
}

export function isWeaponProficient (item, proficiencies) {
	const names = [lower(item.name), lower(item.baseItem?.split("|")[0])];
	return proficiencies.includes(lower(item.weaponCategory)) || proficiencies.some(prof => names.includes(prof) || names.includes(prof.replace(/s$/, ""))) || !!(item.firearm && proficiencies.includes("firearms"));
}
