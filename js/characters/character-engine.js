import {ABILITIES, SKILLS, uid, subclassUid, modifier, signed, clamp, plain, rendererText, rollDice, getCustomOptions, getCharacterOption} from "./character-model.js";
import {getProficiencyOrigins, deriveProficiencies, isWeaponProficient} from "./character-proficiencies.js";

const lower = value => String(value || "").toLowerCase();
const sum = values => values.reduce((a, b) => a + b, 0);
const strings = value => typeof value === "string" ? value : JSON.stringify(value ?? "");
const progressionAt = (progression, level) => Array.isArray(progression)
	? progression[level - 1] || 0
	: Object.entries(progression || {}).filter(([key]) => Number(key) <= level).sort((a, b) => Number(b[0]) - Number(a[0]))[0]?.[1] || 0;

export class CharacterCatalog {
	constructor (data) {
		this.data = data;
		this.maps = {};
		for (const [prop, entries] of Object.entries(data)) {
			if (!Array.isArray(entries)) continue;
			this.maps[prop] = new Map(entries.map(ent => [lower(prop === "subclass" ? subclassUid(ent) : uid(ent)), ent]));
		}
		this.featureMaps = {};
		for (const prop of ["classFeature", "subclassFeature"]) {
			this.featureMaps[prop] = new Map((data[prop] || []).map(ent => [this.featureKey(ent, prop), ent]));
		}
	}

	get (prop, ref) { return this.maps[prop]?.get(lower(ref)); }
	list (prop) { return this.data[prop] || []; }

	featureKey (ent, prop) {
		return lower([ent.name, ent.className, ent.classSource || "PHB", ...(prop === "subclassFeature" ? [ent.subclassShortName, ent.subclassSource || "PHB"] : []), ent.level, ent.source || ent.classSource || "PHB"].join("|"));
	}

	feature (ref, prop = "classFeature") {
		if (!ref) return null;
		if (typeof ref !== "string") ref = ref[prop];
		if (!ref) return null;
		const parts = ref.split("|");
		const [name, className, classSource] = parts;
		const ent = prop === "classFeature"
			? {name, className, classSource: classSource || "PHB", level: Number(parts[3]), source: parts[4] || classSource || "PHB"}
			: {name, className, classSource: classSource || "PHB", subclassShortName: parts[3], subclassSource: parts[4] || "PHB", level: Number(parts[5]), source: parts[6] || parts[4] || "PHB"};
		return this.featureMaps[prop]?.get(this.featureKey(ent, prop));
	}

	resolveEntries (entries, seen = new Set()) {
		return (entries || []).map(entry => {
			if (typeof entry === "string") return entry;
			if (!entry || typeof entry !== "object") return entry;
			const refProp = {refClassFeature: "classFeature", refSubclassFeature: "subclassFeature", refOptionalfeature: "optionalfeature"}[entry.type];
			if (refProp) {
				const ref = entry[refProp];
				const target = refProp === "optionalfeature" ? this.get(refProp, ref.includes("|") ? ref : `${ref}|PHB`) : this.feature(ref, refProp);
				if (!target || seen.has(ref)) return `${plain(ref).split("|")[0]} (see the linked class or feature).`;
				return {type: "entries", name: target.name, entries: this.resolveEntries(target.entries, new Set([...seen, ref]))};
			}
			const out = {...entry};
			if (entry.entries) out.entries = this.resolveEntries(entry.entries, seen);
			if (entry.items) out.items = this.resolveEntries(entry.items, seen);
			return out;
		});
	}
}

export class CharacterEngine {
	constructor (catalog) { this.catalog = catalog; }

	getOption (character, kind, ref) { return getCharacterOption(character, this.catalog, kind, ref); }

	getItem (row) {
		return row.custom ? {name: row.custom.name, source: "CSH", weight: row.custom.weight, entries: [rendererText(row.custom.description)], _customId: row.id} : this.catalog.get("item", row.uid);
	}

	getClasses (character) {
		return character.classes.map(row => {
			const entity = this.catalog.get("class", row.uid);
			const candidate = this.catalog.get("subclass", row.subclass);
			const subclassLevel = entity ? this.getSubclassLevel(entity) : 99;
			const subclass = candidate && lower(candidate.className) === lower(entity?.name) && lower(candidate.classSource) === lower(entity?.source) && row.level >= subclassLevel ? candidate : null;
			return {row, entity, subclass, subclassLevel};
		}).filter(it => it.entity);
	}

	getSubclassLevel (entity) {
		const feature = (entity.classFeatures || []).find(it => typeof it === "object" && it.gainSubclassFeature);
		return this.catalog.feature(feature)?.level || 3;
	}

	getClassFeatures ({entity, row, subclass}, {includeFuture = false} = {}) {
		return [
			...(entity.classFeatures || []).map(ref => this.catalog.feature(ref)),
			...(subclass?.subclassFeatures || []).map(ref => this.catalog.feature(ref, "subclassFeature")),
		].filter(feature => feature && (includeFuture || feature.level <= row.level)).sort((a, b) => a.level - b.level);
	}

	getImprovements (meta) {
		return this.getClassFeatures(meta).filter(it => /^(Ability Score Improvement|Epic Boon)$/.test(it.name));
	}

	isOptionLevelAvailable (entity, character) {
		return !entity.prerequisite?.length || entity.prerequisite.some(rule => {
			if (!rule.level) return true;
			if (typeof rule.level === "number") return sum(character.classes.map(it => it.level)) >= rule.level;
			const {level, class: cls, subclass} = rule.level;
			if (!cls) return sum(character.classes.map(it => it.level)) >= level;
			return character.classes.some(row => lower(row.uid.split("|")[0]) === lower(cls.name) && row.level >= level && (!subclass || lower(row.subclass.split("|")[0]) === lower(subclass.name)));
		});
	}

	getProgressionChoices (meta, character) {
		const groups = [];
		for (const [ownerType, owner] of [["class", meta.entity], ["subclass", meta.subclass]]) {
			if (!owner) continue;
			for (const [field, prop] of [["optionalfeatureProgression", "optionalfeature"], ["featProgression", "feat"]]) {
				for (const [ix, progression] of (owner[field] || []).entries()) {
					const count = Number(progressionAt(progression.progression, meta.row.level));
					if (!count) continue;
					// Epic Boon is already selected in the level's improvement slot.
					if (prop === "feat" && progression.category?.includes("EB") && this.getImprovements(meta).some(it => it.name === "Epic Boon")) continue;
					const key = `${ownerType}:${uid(owner)}:${field}:${ix}`;
					const required = Object.entries(progression.required || {}).filter(([level]) => Number(level) <= meta.row.level).flatMap(([, refs]) => refs);
					const selected = meta.row.options?.[key] || [];
					const matches = entity => prop === "feat" ? progression.category?.includes(entity.category) : entity.featureType?.some(type => progression.featureType.includes(type));
					const available = [...this.catalog.list(prop).filter(entity => matches(entity) && this.isOptionLevelAvailable(entity, character)), ...getCustomOptions(character, prop)];
					const active = [...new Set([...required, ...selected.slice(0, Math.max(0, count - required.length))].map(lower))].filter(ref => available.some(entity => lower(uid(entity)) === ref)).slice(0, count);
					groups.push({key, name: progression.name, prop, count, required, selected, active, available, ownerType});
				}
			}
		}
		return groups;
	}

	getProgression (classes) {
		return classes.flatMap(meta => [...meta.entity.classTableGroups || [], ...meta.subclass?.subclassTableGroups || []].flatMap(table => (table.rows?.[meta.row.level - 1] || []).map((value, ix) => {
			const dice = value?.type === "dice" ? value.toRoll.map(it => `${it.number}d${it.faces}`).join("+") : null;
			return {classId: meta.row.id, className: meta.entity.name, label: plain(table.colLabels[ix]), dice, value: dice ? `{@dice ${dice}}` : value?.type === "bonus" ? signed(value.value) : value?.type === "bonusSpeed" ? `${value.value} ft.` : typeof value === "object" ? "" : String(value)};
		})).filter(it => it.value && it.value !== "0"));
	}

	getFeatureChoiceGroups (meta) {
		const groups = [];
		const walk = (entries, key, title, seen = new Set()) => (entries || []).forEach((entry, ix) => {
			if (!entry || typeof entry !== "object") return;
			const path = `${key}:${ix}`;
			if (entry.type === "options" && entry.count) {
				const options = (entry.entries || []).map((option, j) => {
					const prop = option.classFeature ? "classFeature" : option.subclassFeature ? "subclassFeature" : option.optionalfeature ? "optionalfeature" : "inline";
					const ref = prop === "inline" ? String(j) : option[prop];
					const entity = prop === "inline" ? option : prop === "optionalfeature" ? this.catalog.get(prop, ref.includes("|") ? ref : `${ref}|PHB`) : this.catalog.feature(ref, prop);
					return {id: ref, prop, entity};
				}).filter(it => it.entity);
				if (options.length) groups.push({key: path, title, count: entry.count, options});
				return;
			}
			const refProp = entry.classFeature ? "classFeature" : entry.subclassFeature ? "subclassFeature" : null;
			if (refProp && !seen.has(entry[refProp])) {
				const target = this.catalog.feature(entry[refProp], refProp);
				if (target) walk(target.entries, path, target.name, new Set([...seen, entry[refProp]]));
			}
			walk(entry.entries || entry.items, path, title, seen);
		});
		for (const feature of this.getClassFeatures(meta)) walk(feature.entries, `${meta.row.id}:${this.catalog.featureKey(feature, feature.subclassShortName ? "subclassFeature" : "classFeature")}`, feature.name);
		return groups;
	}

	getOrigins (character, classes = this.getClasses(character)) {
		const origins = [];
		const add = (key, prop, ref) => { const entity = this.getOption(character, prop, ref); if (entity) origins.push({key, entity, prop}); };
		add("race", "race", character.race);
		add("background", "background", character.background);
		const featRefs = [...character.feats];
		const optionRefs = [...character.optionalFeatures];
		for (const meta of classes) {
			for (const group of this.getProgressionChoices(meta, character)) (group.prop === "feat" ? featRefs : optionRefs).push(...group.active);
			for (const feature of this.getImprovements(meta)) {
				const choice = meta.row.improvements[feature.level];
				if (choice?.mode === "feat" && choice.feat) featRefs.push(choice.feat);
			}
		}
		for (const origin of [...origins]) {
			for (const grant of origin.entity.feats || []) {
				for (const key of Object.keys(grant)) if (key.includes("|") && grant[key]) featRefs.push(key);
			}
		}
		for (const ref of [...new Set(featRefs.map(lower))]) add(`feat:${ref}`, "feat", ref);
		for (const ref of [...new Set(optionRefs.map(lower))]) add(`optional:${ref}`, "optionalfeature", ref);
		for (const meta of classes) {
			for (const group of this.getFeatureChoiceGroups(meta)) {
				const selected = character.featureChoices[group.key] || [];
				if (selected.length !== group.count) continue;
				for (const option of group.options.filter(it => selected.includes(it.id))) origins.push({key: `choice:${group.key}:${option.id}`, entity: option.entity, prop: option.prop});
			}
		}
		return origins;
	}

	getAbilityBonuses (character, origin, warnings) {
		if (character.abilityChoices[origin.key]?.included) return Object.fromEntries(ABILITIES.map(key => [key, 0]));
		const choices = origin.entity.ability || [];
		const saved = character.abilityChoices[origin.key] || {index: 0, bonuses: {}};
		const rule = choices[saved.index] || choices[0];
		const out = Object.fromEntries(ABILITIES.map(key => [key, Number(rule?.[key]) || 0]));
		if (!rule?.choose) return out;
		const choose = rule.choose;
		const allowed = choose.from || choose.weighted?.from || ABILITIES;
		const bonuses = Object.entries(saved.bonuses || {}).filter(([key, val]) => allowed.includes(key) && val > 0);
		const weights = choose.weighted?.weights || Array(choose.count || 1).fill(choose.amount || 1);
		const valid = bonuses.length === weights.length && bonuses.map(([, val]) => val).sort().join() === [...weights].sort().join();
		if (!valid) warnings.push(`Choose ${weights.map(it => `+${it}`).join(" / ")} ability increases for ${origin.entity.name}.`);
		else for (const [key, value] of bonuses) out[key] += value;
		return out;
	}

	derive (character) {
		const warnings = [];
		const classes = this.getClasses(character);
		const level = sum(character.classes.map(it => it.level));
		const pb = 2 + Math.floor((Math.max(1, level) - 1) / 4);
		const origins = this.getOrigins(character, classes);
		const race = origins.find(it => it.prop === "race")?.entity;
		const abilities = {...character.abilities};
		if (!classes.length) warnings.push("Choose a class to begin your character.");
		if (!race) warnings.push("Choose a species.");
		if (!character.background) warnings.push("Choose a background.");
		for (const row of character.classes) if (!this.catalog.get("class", row.uid)) warnings.push(`Missing class data: ${row.uid}. Restore its source to calculate this class.`);
		for (const [prop, ref] of [["race", character.race], ["background", character.background], ...character.feats.map(ref => ["feat", ref]), ...character.optionalFeatures.map(ref => ["optionalfeature", ref]), ...character.inventory.filter(it => !it.custom).map(it => ["item", it.uid]), ...character.spells.map(it => ["spell", it.uid])]) {
			if (ref && !this.getOption(character, prop, ref)) warnings.push(`Missing ${prop} data: ${ref}. The reference is preserved.`);
		}
		for (const origin of origins) {
			const bonus = this.getAbilityBonuses(character, origin, warnings);
			for (const key of ABILITIES) abilities[key] += bonus[key];
		}
		for (const meta of classes) {
			for (const group of this.getFeatureChoiceGroups(meta)) {
				if ((character.featureChoices[group.key] || []).filter(id => group.options.some(it => it.id === id)).length !== group.count) warnings.push(`${meta.entity.name}: choose ${group.count} option${group.count === 1 ? "" : "s"} for ${group.title}.`);
			}
			if (meta.row.level >= meta.subclassLevel && !meta.subclass) warnings.push(`Choose ${meta.entity.subclassTitle || "a subclass"} for ${meta.entity.name}.`);
			for (const feature of this.getImprovements(meta)) {
				const choice = meta.row.improvements[feature.level];
				if (!choice || (choice.mode === "feat" && !choice.feat)) warnings.push(`${meta.entity.name} ${feature.level}: choose an ability improvement or feat.`);
				if (choice?.mode === "asi") {
					const values = ABILITIES.map(key => Number(choice.abilities?.[key]) || 0);
					if (sum(values) !== 2 || values.some(it => it < 0 || it > 2)) warnings.push(`${meta.entity.name} ${feature.level}: assign exactly two ability points.`);
					else for (const key of ABILITIES) abilities[key] = Math.max(abilities[key], Math.min(20, abilities[key] + (choice.abilities[key] || 0)));
				}
			}
		}
		for (const key of ABILITIES) abilities[key] = clamp(abilities[key], 1, 30);
		const mods = Object.fromEntries(ABILITIES.map(key => [key, modifier(abilities[key])]));
		if (classes.length > 1) for (const meta of classes) {
			const requirements = meta.entity.multiclassing?.requirements;
			if (!requirements) continue;
			const meets = requirement => Object.entries(requirement).every(([key, value]) => key === "or" ? value.some(meets) : !ABILITIES.includes(key) || abilities[key] >= value);
			if (!meets(requirements)) warnings.push(`${meta.entity.name}: multiclass ability prerequisites are not met.`);
		}
		const features = classes.flatMap(meta => this.getClassFeatures(meta).map(entity => ({entity, classId: meta.row.id, className: meta.entity.name})));
		const hasFeature = name => features.some(it => lower(it.entity.name) === lower(name));
		const originNames = origins.filter(it => !it.entity._customId).map(it => lower(it.entity.name));
		const hasOrigin = name => originNames.includes(lower(name));
		const proficiencyOrigins = getProficiencyOrigins({character, classes, origins, features});
		const proficiencies = deriveProficiencies(character, {catalog: this.catalog, origins: proficiencyOrigins, features});
		const skills = proficiencies.skills;
		warnings.push(...proficiencies.warnings);
		const skillBonuses = Object.fromEntries(Object.entries(SKILLS).map(([key, ability]) => [key, mods[ability] + (skills[key] ? pb * skills[key] : hasFeature("Jack of All Trades") ? Math.floor(pb / 2) : 0)]));
		const saves = Object.fromEntries(ABILITIES.map(key => [key, mods[key] + ((character.saves[key] ?? classes[0]?.entity.proficiency?.includes(key)) ? pb : 0)]));
		let hp = 0;
		const hitDice = {};
		classes.forEach((meta, ix) => {
			const faces = meta.entity.hd?.faces || 8;
			hitDice[meta.row.id] = {faces, max: meta.row.level, used: clamp(character.state.hitDice[meta.row.id], 0, meta.row.level)};
			for (let i = 1; i <= meta.row.level; ++i) hp += Math.max(1, (!ix && i === 1 ? faces : clamp(meta.row.hpRolls[i] || faces / 2 + 1, 1, faces)) + mods.con);
		});
		if (hasOrigin("Tough")) hp += 2 * level;
		if (origins.some(it => !it.entity._customId && strings(it.entity.entries).includes('"Dwarven Toughness"'))) hp += level;
		hp = Math.max(1, hp + character.adjustments.hp);
		const activeItems = character.inventory.map(row => ({row, entity: this.getItem(row)})).filter(it => it.entity && it.row.quantity > 0);
		const equipped = activeItems.filter(it => it.row.equipped && (!it.entity.reqAttune || it.row.attuned));
		const armors = equipped.filter(it => ["LA", "MA", "HA"].includes(it.entity.type?.split("|")[0]));
		const shields = equipped.filter(it => it.entity.type?.split("|")[0] === "S");
		const armorIsProficient = [...armors, ...shields].every(it => proficiencies.armor.includes(({LA: "light", MA: "medium", HA: "heavy", S: "shield"})[it.entity.type.split("|")[0]]));
		if (!armorIsProficient) warnings.push("Equipped armor or shield lacks training: spellcasting is unavailable. Check the source's other armor penalties.");
		if (armors.length > 1) warnings.push("More than one suit of armor is equipped; only the highest AC is used.");
		if (shields.length > 1) warnings.push("Only one shield contributes to AC.");
		if (activeItems.filter(it => it.row.attuned).length > 3) warnings.push("More than three items are attuned; check your attunement limit.");
		let ac = 10 + mods.dex;
		let acFrom = "Unarmored";
		const monk = classes.find(it => it.entity.name === "Monk");
		const barbarian = classes.find(it => it.entity.name === "Barbarian");
		if (!armors.length) {
			if (monk && !shields.length && ac < 10 + mods.dex + mods.wis) { ac = 10 + mods.dex + mods.wis; acFrom = "Unarmored Defense"; }
			if (barbarian && ac < 10 + mods.dex + mods.con) { ac = 10 + mods.dex + mods.con; acFrom = "Unarmored Defense"; }
			if (race?.name.startsWith("Tortle") && ac < 17) { ac = 17; acFrom = "Natural Armor"; }
			if (race?.name.startsWith("Lizardfolk") && ac < 13 + mods.dex) { ac = 13 + mods.dex; acFrom = "Natural Armor"; }
		} else {
			const options = armors.map(it => ({...it, ac: (it.entity.ac || 10) + Number(it.entity.bonusAc || 0) + (it.entity.type.startsWith("HA") ? 0 : it.entity.type.startsWith("MA") ? Math.min(2, mods.dex) : mods.dex)})).sort((a, b) => b.ac - a.ac);
			ac = options[0].ac;
			acFrom = options[0].entity.name;
		}
		if (shields.length) { ac += Math.max(...shields.map(it => (it.entity.ac || 2) + Number(it.entity.bonusAc || 0))); acFrom += ", shield"; }
		for (const it of equipped.filter(it => !armors.includes(it) && !shields.includes(it))) {
			if (it.entity.name === "Bracers of Defense" && (armors.length || shields.length)) continue;
			ac += Number(it.entity.bonusAc) || 0;
		}
		if (hasOrigin("Defense") && armors.length) ac += 1;
		ac += character.adjustments.ac;
		const speed = typeof race?.speed === "number" ? {walk: race.speed} : {...race?.speed || {walk: 30}};
		for (const key of Object.keys(speed)) if (speed[key] === true) speed[key] = speed.walk || 30;
		speed.walk = (speed.walk || 0) + character.adjustments.speed;
		if (monk && !armors.length && !shields.length && monk.row.level >= 2) speed.walk += 10 + Math.floor((monk.row.level - 2) / 4) * 5;
		if (barbarian?.row.level >= 5 && !armors.some(it => it.entity.type.startsWith("HA"))) speed.walk += 10;
		if (hasOrigin("Mobile") || hasOrigin("Speedy")) speed.walk += 10;
		if (armors.some(it => it.entity.strength && abilities.str < it.entity.strength) && !race?.name.startsWith("Dwarf")) { speed.walk = Math.max(0, speed.walk - 10); warnings.push("Armor Strength requirement is not met; walking speed is reduced by 10 feet."); }
		const weight = sum(activeItems.map(it => (it.entity.weight || 0) * it.row.quantity)) + sum(Object.values(character.currency)) / 50;
		const capacity = abilities.str * 15 * (race?.size?.[0] === "T" ? 0.5 : race?.size?.[0] === "L" || race?.traitTags?.includes("Powerful Build") ? 2 : 1);
		if (weight > capacity) warnings.push(`Carried weight exceeds carrying capacity (${capacity} lb.).`);
		if (character.state.exhaustion) warnings.push(`Exhaustion ${character.state.exhaustion}: apply the ${character.rules} exhaustion penalties when rolling.`);
		if (character.state.conditions.length) warnings.push(`Active conditions: ${character.state.conditions.join(", ")}. Apply their situational effects when rolling.`);
		for (const meta of classes) for (const group of this.getProgressionChoices(meta, character)) {
			if (group.active.length !== group.count) warnings.push(`${meta.entity.name}: choose ${group.count} ${group.name} (${group.active.length} active).`);
			if (group.selected.filter(Boolean).some(ref => !group.available.some(entity => lower(uid(entity)) === lower(ref)))) warnings.push(`${meta.entity.name}: a saved ${group.name} choice is unavailable at this level or has missing source data.`);
		}
		const initiative = mods.dex + character.adjustments.initiative + (hasOrigin("Alert") ? (origins.some(it => it.entity.name === "Alert" && it.entity.source === "XPHB") ? pb : 5) : 0) + (features.some(it => it.entity.name === "Jack of All Trades" && it.entity.source === "PHB") ? Math.floor(pb / 2) : 0);
		const result = {classes, origins, proficiencyOrigins, proficiencies, features, level, pb, abilities, mods, skills, skillBonuses, saves, hp, currentHp: Math.max(0, hp - character.state.damage), hitDice, ac, acFrom, armorIsProficient, speed, weight, capacity, initiative, passive: 10 + skillBonuses.perception, warnings, race};
		result.defenses = {};
		for (const prop of ["resist", "immune", "vulnerable", "conditionImmune"]) {
			result.defenses[prop] = origins.flatMap(origin => (origin.entity[prop] || []).flatMap((entry, ix) => {
				if (typeof entry === "string") return [entry];
				if (!entry.choose?.from) return [];
				const selected = [...new Set(character.defenseChoices[`${origin.key}:${prop}:${ix}`] || [])].filter(it => entry.choose.from.includes(it));
				if (selected.length !== (entry.choose.count || 1)) { warnings.push(`${origin.entity.name}: choose ${entry.choose.count || 1} ${prop === "resist" ? "resistance" : prop} option.`); return []; }
				return selected;
			}));
		}
		result.progression = this.getProgression(classes);
		result.attacks = this.getAttacks(character, result, equipped);
		result.casting = this.getCasting(character, result);
		result.spellSources = this.getAdditionalSpellSources(character, result);
		for (const source of result.spellSources) {
			if (!source.group) warnings.push(`Choose a spellcasting option for ${source.entity.name}.`);
			if (source.abilityOptions.length && !source.saved.ability) warnings.push(`Choose a spellcasting ability for ${source.entity.name}.`);
		}
		for (const choice of this.getGrantedSpellData(character, result).choices) if (new Set(choice.selected.filter(Boolean)).size !== choice.count) warnings.push(`${choice.source.entity.name}: choose ${choice.count} different granted spell${choice.count === 1 ? "" : "s"}.`);
		result.resources = this.getResources(character, result);
		for (const caster of result.casting.casters) {
			const owned = this.getSpells(character, result).filter(it => it.row.classId === caster.row.id && !it.row.granted);
			if (owned.filter(it => !it.entity.level).length > caster.cantrips) warnings.push(`${caster.entity.name}: too many chosen cantrips (${caster.cantrips} allowed).`);
			if (caster.prepared && owned.filter(it => it.entity.level && it.row.prepared).length > caster.prepared) warnings.push(`${caster.entity.name}: more than ${caster.prepared} spells are prepared.`);
			if (caster.known && owned.filter(it => it.entity.level).length > caster.known) warnings.push(`${caster.entity.name}: more than ${caster.known} spells are known.`);
			if (owned.some(it => it.entity.level > caster.maxSpellLevel)) warnings.push(`${caster.entity.name}: a selected spell is above this class's spell level limit.`);
		}
		return result;
	}

	getAttacks (character, derived, equipped) {
		const weaponProf = derived.proficiencies.weapons;
		const styles = derived.origins.filter(it => !it.entity._customId).map(it => lower(it.entity.name));
		const weapons = equipped.filter(it => it.entity.dmg1);
		const monk = derived.classes.find(it => it.entity.name === "Monk");
		const martialArts = monk && !equipped.some(it => ["LA", "MA", "HA", "S"].includes(it.entity.type?.split("|")[0]));
		const monkDie = monk ? (monk.entity.edition === "one" ? [6, 8, 10, 12] : [4, 6, 8, 10])[monk.row.level >= 17 ? 3 : monk.row.level >= 11 ? 2 : monk.row.level >= 5 ? 1 : 0] : 0;
		const unarmedAbility = martialArts && derived.mods.dex > derived.mods.str ? "dex" : "str";
		return [
			...equipped.filter(it => it.row.custom?.attack).map(({row, entity}) => ({...row.custom.attack, id: row.id, name: entity.name, ability: row.ability || "str", proficient: row.proficient ?? true, entity, isImported: true})),
			...weapons.map(({row, entity}) => {
				const props = (entity.property || []).map(it => (typeof it === "string" ? it : it.uid || "").split("|")[0]);
				const isRanged = entity.type?.split("|")[0] === "R";
				const ability = ABILITIES.includes(row.ability) ? row.ability : props.includes("F") ? (derived.mods.dex > derived.mods.str ? "dex" : "str") : isRanged ? "dex" : "str";
				const mod = derived.mods[ability];
				const proficient = row.proficient ?? isWeaponProficient(entity, weaponProf);
				const magicAttack = Number(entity.bonusWeapon ?? entity.bonusWeaponAttack ?? 0);
				const magicDamage = Number(entity.bonusWeapon ?? entity.bonusWeaponDamage ?? 0);
				const styleAttack = isRanged && styles.includes("archery") ? 2 : 0;
				const styleDamage = !isRanged && !props.includes("2H") && !row.twoHanded && weapons.length === 1 && styles.includes("dueling") ? 2 : 0;
				const damageBonus = mod + magicDamage + styleDamage + character.adjustments.damage;
				const dice = row.twoHanded && entity.dmg2 ? entity.dmg2 : entity.dmg1;
				return {id: row.id, name: entity.name, ability, proficient, toHit: mod + (proficient ? derived.pb : 0) + magicAttack + styleAttack + character.adjustments.attack, damage: `${dice}${signed(damageBonus)}`, damageType: entity.dmgType || "", range: entity.range || (props.includes("R") ? "10 ft." : "5 ft."), reach: props.includes("R") ? "10 ft." : "5 ft.", isRanged, thrown: props.includes("T"), entity};
			}),
			{id: "unarmed", name: "Unarmed Strike", ability: unarmedAbility, proficient: true, toHit: derived.mods[unarmedAbility] + derived.pb + character.adjustments.attack, damage: martialArts ? `1d${monkDie}${signed(derived.mods[unarmedAbility] + character.adjustments.damage)}` : String(Math.max(1, 1 + derived.mods.str + character.adjustments.damage)), damageType: "B", range: "5 ft."},
		];
	}

	getCasting (character, derived) {
		const casters = derived.classes.map(meta => {
			const progression = meta.subclass?.casterProgression || meta.entity.casterProgression;
			if (!progression) return null;
			const ability = meta.subclass?.spellcastingAbility || meta.entity.spellcastingAbility || "int";
			const tables = [...meta.entity.classTableGroups || [], ...meta.subclass?.subclassTableGroups || []];
			const slotTable = tables.find(it => it.rowsSpellProgression);
			const slots = slotTable?.rowsSpellProgression?.[meta.row.level - 1] || [];
			let pact = null;
			if (progression === "pact") {
				const table = tables.find(it => it.colLabels?.includes("Spell Slots"));
				const row = table?.rows?.[meta.row.level - 1];
				pact = {max: Number(row?.[table.colLabels.indexOf("Spell Slots")]) || 0, level: Number(plain(row?.[table.colLabels.indexOf("Slot Level")]).match(/\d+/)?.[0]) || 1, used: character.state.pact[meta.row.id] || 0};
			}
			const cantrips = progressionAt(meta.subclass?.cantripProgression || meta.entity.cantripProgression, meta.row.level);
			const known = progressionAt(meta.subclass?.spellsKnownProgression || meta.entity.spellsKnownProgression, meta.row.level);
			let prepared = progressionAt(meta.subclass?.preparedSpellsProgression || meta.entity.preparedSpellsProgression, meta.row.level);
			if (meta.entity.preparedSpells) prepared = Math.max(1, Math.floor(meta.row.level / (meta.entity.preparedSpells.includes("/ 2") ? 2 : 1)) + derived.mods[ability]);
			return {...meta, progression, ability, slots, pact, cantrips, known, prepared, maxSpellLevel: pact?.level || slots.reduce((max, val, ix) => val ? ix + 1 : max, 0), attack: derived.pb + derived.mods[ability] + character.adjustments.spellAttack, dc: 8 + derived.pb + derived.mods[ability] + character.adjustments.spellDc};
		}).filter(Boolean);
		const standard = casters.filter(it => it.progression !== "pact");
		let slots = standard[0]?.slots || [];
		if (standard.length > 1) {
			const casterLevel = sum(standard.map(meta => {
				if (meta.progression === "full") return meta.row.level;
				if (meta.progression === "artificer") return Math.ceil(meta.row.level / 2);
				if (meta.progression === "1/2" && meta.entity.edition === "one") return Math.ceil(meta.row.level / 2);
				return Math.floor(meta.row.level / (meta.progression === "1/3" ? 3 : 2));
			}));
			// The full-caster table is the same multiclass slot table; read it from local data.
			const wizard = this.catalog.list("class").find(it => it.name === "Wizard" && it.source === (character.rules === "2024" ? "XPHB" : "PHB"));
			slots = wizard?.classTableGroups?.find(it => it.rowsSpellProgression)?.rowsSpellProgression?.[casterLevel - 1] || [];
		}
		return {casters, slots};
	}

	spellAvailable (spell, caster) {
		if (!caster) return false;
		return [...spell.classes?.fromClassList || [], ...spell.classes?.fromClassListVariant || []].some(it => lower(it.name) === lower(caster.entity.name) && lower(it.source) === lower(caster.entity.source))
			|| (spell.classes?.fromSubclass || []).some(it => lower(it.class.name) === lower(caster.entity.name) && lower(it.class.source) === lower(caster.entity.source) && [caster.subclass?.name, caster.subclass?.shortName].some(name => name && lower(name) === lower(it.subclass.name)));
	}

	matchesSpellFilter (spell, filter) {
		if (!filter) return true;
		return filter.split("|").every(part => {
			const [key, raw] = part.toLowerCase().split("=");
			if (!raw) return true;
			const values = raw.split(";").map(lower);
			if (key === "level") return values.includes(String(spell.level));
			if (key === "school") return values.includes(lower(spell.school));
			if (key === "source") return values.includes(lower(spell.source));
			if (key === "class") return (spell.classes?.fromClassList || []).some(it => values.includes(lower(it.name)));
			if (key === "components & miscellaneous") return values.every(value => value === "ritual" ? !!spell.meta?.ritual : value === "concentration" ? !!spell.duration?.some(it => it.concentration) : true);
			return true;
		});
	}

	getAdditionalSpellSources (character, derived) {
		const sources = [
			...derived.origins.map(it => ({...it, level: derived.level})),
			...derived.classes.flatMap(meta => [
				{key: `class:${meta.row.id}`, entity: meta.entity, level: meta.row.level, caster: derived.casting.casters.find(it => it.row.id === meta.row.id)},
				...(meta.subclass ? [{key: `subclass:${meta.row.id}:${uid(meta.subclass)}`, entity: meta.subclass, level: meta.row.level, caster: derived.casting.casters.find(it => it.row.id === meta.row.id)}] : []),
			]),
		];
		return sources.filter(it => it.entity.additionalSpells?.length).map(source => {
			const groups = source.entity.additionalSpells;
			const saved = character.spellChoices[source.key] || {index: groups.length > 1 ? -1 : 0, ability: "", chosen: {}};
			const group = groups[saved.index];
			const abilityOptions = group?.ability?.choose || (group?.ability === "inherit" && !source.caster ? ["int", "wis", "cha"] : []);
			const featAbility = source.entity.name === "Ritual Caster" && source.entity.source === "XPHB"
				? Object.entries(this.getAbilityBonuses(character, source, [])).find(([, bonus]) => bonus > 0)?.[0] : null;
			const ability = featAbility || saved.ability || (typeof group?.ability === "string" && ABILITIES.includes(group.ability) ? group.ability : source.caster?.ability || "int");
			return {...source, groups, saved, group, ability, abilityOptions};
		});
	}

	getGrantedSpellData (character, derived) {
		const spells = [];
		const choices = [];
		for (const source of derived.spellSources || []) {
			if (!source.group) continue;
			const caster = source.caster || {entity: {name: source.entity.name}, row: {id: source.key}, ability: source.ability, attack: derived.pb + derived.mods[source.ability] + character.adjustments.spellAttack, dc: 8 + derived.pb + derived.mods[source.ability] + character.adjustments.spellDc};
			const walk = (value, path, context = {}) => {
				if (Array.isArray(value)) return value.forEach((it, ix) => walk(it, `${path}:${ix}`, context));
				if (typeof value === "string") {
					const [ref, castLevel] = value.split("#");
					const entity = this.catalog.get("spell", ref.includes("|") ? ref : `${ref}|PHB`);
					if (!entity) return;
					const isRitualCaster = source.entity.name === "Ritual Caster" && ["PHB", "XPHB"].includes(source.entity.source);
					const ritualOnly = context.ritualOnly || (isRitualCaster && source.entity.source === "PHB");
					const innate = context.recovery && !ritualOnly ? {id: `${source.key}:${context.pool}${context.each ? `:${uid(entity)}` : ""}`, max: context.max, recovery: context.recovery, level: Number(castLevel) || entity.level} : null;
					spells.push({entity, caster, row: {uid: uid(entity), classId: caster.row.id, prepared: true, granted: true, origin: source.key, innate, atWill: context.atWill || !entity.level, ritualOnly, ritualAllowed: isRitualCaster || ritualOnly, grantName: source.entity.name}});
					return;
				}
				if (!value || typeof value !== "object") return;
				if (value.choose) {
					const count = value.count || value.choose.count || 1;
					const filter = typeof value.choose === "string" ? value.choose : null;
					const from = value.choose.from;
					const selected = source.saved.chosen[path] || [];
					choices.push({source, path, count, filter, from, selected});
					for (const ref of selected.slice(0, count)) {
						const entity = this.catalog.get("spell", ref);
						if (entity && (!from || from.some(it => lower(it.includes("|") ? it : `${it}|PHB`) === lower(ref))) && this.matchesSpellFilter(entity, filter)) walk(ref, path, context);
					}
					return;
				}
				for (const [key, child] of Object.entries(value)) {
					if (["daily", "rest", "resource"].includes(key)) {
						for (const [uses, list] of Object.entries(child)) walk(list, `${path}:${key}:${uses}`, {...context, recovery: key === "rest" ? "short" : "long", max: parseInt(uses) || 1, each: uses.endsWith("e"), pool: `${path}:${key}:${uses}`});
					} else walk(child, `${path}:${key}`, {...context, atWill: context.atWill || key === "will", ritualOnly: context.ritualOnly || key === "ritual"});
				}
			};
			for (const type of ["prepared", "known", "innate"]) {
				for (const [unlock, value] of Object.entries(source.group[type] || {})) {
					const isUnlocked = unlock === "_" || (unlock.startsWith("s") ? Number(unlock.slice(1)) <= (source.caster?.maxSpellLevel || 0) : Number(unlock) <= source.level);
					if (isUnlocked) walk(value, `${type}:${unlock}`);
				}
			}
		}
		return {spells, choices};
	}

	getResources (character, derived) {
		const resources = [];
		const add = (meta, name, max, recovery) => resources.push({id: `${meta.row.id}:${name}`, name, max: Math.max(1, max), recovery, shortRecovery: meta.entity.edition === "one" && ["Second Wind", "Channel Divinity", "Wild Shape", "Rage"].includes(name) ? 1 : 0, ...(name === "Second Wind" ? {healing: `1d10+${meta.row.level}`} : {})});
		for (const meta of derived.classes) {
			const level = meta.row.level;
			const modern = meta.entity.edition === "one";
			const names = this.getClassFeatures(meta).map(it => lower(it.name));
			const has = name => names.includes(lower(name));
			if (has("Second Wind")) add(meta, "Second Wind", modern ? level >= 10 ? 4 : level >= 4 ? 3 : 2 : 1, modern ? "long" : "short");
			if (has("Action Surge")) add(meta, "Action Surge", level >= 17 ? 2 : 1, "short");
			if (has("Bardic Inspiration")) add(meta, "Bardic Inspiration", derived.mods.cha, level >= 5 ? "short" : "long");
			if (has("Ki") || has("Monk's Focus")) add(meta, modern ? "Focus Points" : "Ki Points", level, "short");
			if (has("Font of Magic")) add(meta, "Sorcery Points", level, "long");
			if (has("Lay on Hands")) add(meta, "Lay on Hands", level * 5, "long");
			if (has("Rage")) add(meta, "Rage", level >= 17 ? 6 : level >= 12 ? 5 : level >= 6 ? 4 : level >= 3 ? 3 : 2, "long");
			if (has("Channel Divinity")) add(meta, "Channel Divinity", modern ? level >= 11 ? 3 : 2 : level >= 18 ? 3 : level >= 6 ? 2 : 1, modern ? "long" : "short");
			if (has("Wild Shape")) add(meta, "Wild Shape", modern && level >= 17 ? 4 : modern && level >= 6 ? 3 : 2, modern ? "long" : "short");
			if (has("Indomitable")) add(meta, "Indomitable", level >= 17 ? 3 : level >= 13 ? 2 : 1, "long");
		}
		for (const grant of this.getGrantedSpellData(character, derived).spells) if (grant.row.innate && !resources.some(it => it.id === grant.row.innate.id)) resources.push({...grant.row.innate, name: `${grant.entity.name} (${grant.row.grantName})`});
		return [...resources, ...character.resources].map(resource => ({...resource, used: clamp(character.state.resources[resource.id], 0, resource.max)}));
	}

	getSpells (character, derived) {
		const granted = this.getGrantedSpellData(character, derived).spells;
		const picked = character.spells.map(row => ({row, entity: this.catalog.get("spell", row.uid), caster: derived.casting.casters.find(it => it.row.id === row.classId)})).filter(entry => entry.entity && !granted.some(it => lower(it.row.uid) === lower(entry.row.uid) && it.row.classId === entry.row.classId));
		return [...picked, ...granted];
	}

	getSpellRolls (spell, characterLevel, slotLevel = spell.level, spellMod = 0) {
		const scaling = Array.isArray(spell.scalingLevelDice) ? spell.scalingLevelDice : spell.scalingLevelDice ? [spell.scalingLevelDice] : [];
		if (!spell.level && scaling.length) return scaling.map(it => ({label: it.label || "Damage", dice: Object.entries(it.scaling).filter(([level]) => Number(level) <= Math.max(1, characterLevel)).sort((a, b) => Number(b[0]) - Number(a[0]))[0]?.[1]})).filter(it => it.dice);
		const text = strings(spell.entries);
		const scaled = [...`${text} ${strings(spell.entriesHigherLevel)}`.matchAll(/\{@scale(?:damage|dice) ([^|}]+)\|([^|}]+)\|([^|}]+)/g)];
		if (scaled.length) return scaled.map(match => {
			const extra = Math.max(0, Number(slotLevel) - (Number(match[2].match(/\d+/)?.[0]) || spell.level));
			return {label: "Damage / healing", dice: match[1] + (/\{@(?:dice|damage) [^}]+} plus your spellcasting ability modifier/i.test(text) ? signed(spellMod) : "") + Array(extra).fill(`+${match[3]}`).join("")};
		});
		const dice = [...new Set([...text.matchAll(/\{@(?:damage|dice) ([^|}]+)/g)].map(it => it[1]))].filter(it => /^[\dd+\- ]+$/.test(it));
		// Many spells express upcasting in entriesHigherLevel instead of scaledamage tags.
		const higher = strings(spell.entriesHigherLevel);
		const increase = higher.match(/(?:increases? by|extra) \{@(?:damage|dice) ([^|}]+)}.*?(?:for each|per) spell.*?level/i);
		return dice.map((expression, ix) => ({label: "Damage / healing", dice: expression + (!ix && /\{@(?:dice|damage) [^}]+} plus your spellcasting ability modifier/i.test(text) ? signed(spellMod) : "") + (!ix && increase && slotLevel > spell.level ? Array(Number(slotLevel) - spell.level).fill(`+${increase[1]}`).join("") : "")}));
	}

	canRitualCast (character, spellRow, derived = this.derive(character)) {
		if (!this.catalog.get("spell", spellRow.uid)?.meta?.ritual || !derived.armorIsProficient) return false;
		if (spellRow.ritualOnly || spellRow.ritualAllowed === true) return true;
		const caster = derived.casting.casters.find(it => it.row.id === spellRow.classId);
		// 2024 PHB chapter 7: prepared ritual spells can be cast as rituals.
		if (spellRow.prepared && (caster?.entity.edition === "one" || derived.classes[0]?.entity.edition === "one")) return true;
		if (!caster) return false;
		if (caster.entity.name === "Wizard" && ["PHB", "XPHB"].includes(caster.entity.source)) return true;
		if (caster.entity.name === "Bard" && caster.entity.source === "PHB") return true;
		if (caster.entity.name === "Warlock" && derived.origins.some(it => it.entity.name === "Book of Ancient Secrets" && it.entity.source === "PHB")) return true;
		return !!spellRow.prepared && ((["Cleric", "Druid"].includes(caster.entity.name) && caster.entity.source === "PHB") || (caster.entity.name === "Artificer" && caster.entity.source === "TCE"));
	}

	cast (character, spellRow, slot = "", {ritual = false} = {}) {
		const derived = this.derive(character);
		const spell = this.catalog.get("spell", spellRow.uid);
		if (!spell) throw new Error("Spell data is missing.");
		if (!derived.armorIsProficient) throw new Error("Spellcasting requires training with your equipped armor and shield.");
		const owner = derived.casting.casters.find(it => it.row.id === spellRow.classId);
		if (!spellRow.granted && (!owner || spell.level > owner.maxSpellLevel)) throw new Error("This spell is not available at this class's current level.");
		let castLevel = spell.level;
		if (!spellRow.prepared && spell.level && !ritual) throw new Error("Prepare this spell before casting it.");
		if (spellRow.ritualOnly && !ritual) throw new Error("This feature grants ritual casting only; use Ritual to add 10 minutes and cast without a slot.");
		if (ritual) {
			if (!spell.meta?.ritual) throw new Error("This spell cannot be cast as a ritual.");
			if (!this.canRitualCast(character, spellRow, derived)) throw new Error("Your class or feature does not allow this spell to be cast as a ritual in its current prepared state.");
		} else if (slot === "innate") {
			const pool = spellRow.innate;
			if (!pool || (character.state.resources[pool.id] || 0) >= pool.max) throw new Error("No free uses of this spell remain.");
			character.state.resources[pool.id] = (character.state.resources[pool.id] || 0) + 1;
			castLevel = pool.level;
		} else if (spell.level && !spellRow.atWill) {
			if (String(slot).startsWith("pact:")) {
				const caster = derived.casting.casters.find(it => `pact:${it.row.id}` === slot);
				if (!caster?.pact || caster.pact.level < spell.level || caster.pact.used >= caster.pact.max) throw new Error("No suitable pact slot remains.");
				character.state.pact[caster.row.id] = caster.pact.used + 1;
				castLevel = caster.pact.level;
			} else {
				const level = Number(slot);
				const max = derived.casting.slots[level - 1] || 0;
				if (!Number.isInteger(level) || level < spell.level || max <= (character.state.slots[level] || 0)) throw new Error("Choose an available spell slot of the spell's level or higher.");
				character.state.slots[level] = (character.state.slots[level] || 0) + 1;
				castLevel = level;
			}
		}
		if (spell.duration?.some(it => it.concentration)) character.state.concentration = spell.name;
		character.state.lastSpellLevels[`${spellRow.classId}:${uid(spell)}`] = castLevel;
		return `${spell.name}${ritual ? " (ritual; no slot spent)" : slot === "innate" ? " (granted use)" : spellRow.atWill ? " (at will)" : spell.level ? ` (${String(slot).startsWith("pact:") ? "pact slot" : `level ${slot} slot`})` : " (cantrip)"}`;
	}

	changeHp (character, amount) {
		character.state.damage = Math.min(character.state.damage, this.derive(character).hp);
		if (amount > 0) {
			const absorbed = Math.min(character.state.tempHp, amount);
			character.state.tempHp -= absorbed;
			character.state.damage = Math.min(this.derive(character).hp, character.state.damage + amount - absorbed);
			if (!this.derive(character).currentHp) character.state.concentration = "";
		} else {
			character.state.damage = Math.max(0, character.state.damage + amount);
			if (this.derive(character).currentHp > 0) { character.state.deathSuccess = 0; character.state.deathFailure = 0; }
		}
	}

	spendHitDie (character, classId, random = Math.random) {
		const derived = this.derive(character);
		const die = derived.hitDice[classId];
		if (!die || die.used >= die.max) throw new Error("No hit dice remain for this class.");
		const roll = rollDice(`1d${die.faces}${signed(derived.mods.con)}`, random);
		character.state.hitDice[classId] = die.used + 1;
		this.changeHp(character, -Math.max(0, roll.total));
		return Math.max(0, roll.total);
	}

	rest (character, type) {
		const derived = this.derive(character);
		character.state.pact = {};
		for (const resource of derived.resources) {
			if (resource.recovery === "short" || (type === "long" && resource.recovery === "long")) character.state.resources[resource.id] = 0;
			else if (type === "short" && resource.shortRecovery) character.state.resources[resource.id] = Math.max(0, resource.used - resource.shortRecovery);
		}
		if (type !== "long") return;
		character.state.damage = 0;
		character.state.tempHp = 0;
		character.state.slots = {};
		character.state.concentration = "";
		character.state.deathSuccess = 0;
		character.state.deathFailure = 0;
		character.state.exhaustion = Math.max(0, character.state.exhaustion - 1);
		if (character.rules === "2024") character.state.hitDice = {};
		else {
			let recovery = Math.max(1, Math.floor(derived.level / 2));
			for (const [id, die] of Object.entries(derived.hitDice).sort((a, b) => b[1].faces - a[1].faces)) {
				const recovered = Math.min(recovery, die.used);
				character.state.hitDice[id] = die.used - recovered;
				recovery -= recovered;
			}
		}
	}

	toCreature (character, derived = this.derive(character)) {
		const languages = derived.proficiencies.languages.map(rendererText);
		if (character.languages) languages.push(...character.languages.split(",").map(it => rendererText(it.trim())));
		const trait = [
			{name: "Character", entries: [derived.classes.map(it => `${it.entity.name} ${it.row.level}${it.subclass ? ` (${it.subclass.name})` : ""}`).join(" / ") || "Choose a class to begin."]},
			...(derived.progression.length ? [{name: "Class Progression", entries: derived.classes.map(meta => `${meta.entity.name}: ${derived.progression.filter(it => it.classId === meta.row.id).map(it => `${it.label} ${it.value}`).join("; ")}.`)}] : []),
			...(character.tools ? [{name: "Additional Proficiencies", entries: [rendererText(character.tools)]}] : []),
			...(Object.keys(derived.proficiencies.tools).length || derived.proficiencies.armor.length || derived.proficiencies.weapons.length ? [{name: "Proficiencies", entries: [
				...(Object.keys(derived.proficiencies.tools).length ? [`Tools: ${Object.entries(derived.proficiencies.tools).map(([name, rank]) => `${rendererText(name)}${rank === 2 ? " (expertise)" : ""}`).join(", ")}.`] : []),
				...(derived.proficiencies.armor.length ? [`Armor: ${derived.proficiencies.armor.join(", ")}.`] : []),
				...(derived.proficiencies.weapons.length ? [`Weapons: ${derived.proficiencies.weapons.join(", ")}.`] : []),
			]}] : []),
			...(character.inventory.length ? [{name: "Equipment", entries: [character.inventory.filter(it => it.quantity > 0).map(it => { const item = this.getItem(it); return item ? `${it.quantity} × ${it.custom ? rendererText(item.name) : `{@item ${item.name}|${item.source}}`}${it.equipped ? " (equipped)" : ""}` : `${it.quantity} × ${rendererText(it.uid)}`; }).join(", ")]}] : []),
			...derived.origins.map(it => ({name: it.entity._customId ? `${rendererText(it.entity.name)} (Custom)` : `${it.entity.name} (${it.entity.source})`, entries: this.catalog.resolveEntries(it.entity.entries)})),
			...derived.features.map(it => ({name: `${it.entity.name} (${it.className} ${it.entity.level})`, entries: this.catalog.resolveEntries(it.entity.entries)})),
		];
		const creature = {
			name: rendererText(character.name), source: "CSH", level: derived.level || 1,
			size: [character.size || derived.race?.size?.[0] || "M"], type: derived.race?.creatureTypes?.find(it => typeof it === "string") || "humanoid",
			alignment: ({LG: ["L", "G"], NG: ["N", "G"], CG: ["C", "G"], LN: ["L", "N"], N: ["N"], CN: ["C", "N"], LE: ["L", "E"], NE: ["N", "E"], CE: ["C", "E"], U: ["U"]})[character.alignment] || ["N"],
			ac: [{ac: derived.ac, from: [derived.acFrom]}], hp: {average: derived.hp, formula: `${Object.values(derived.hitDice).map(it => `${it.max}d${it.faces}`).join(" + ") || "1"}${signed(derived.mods.con * derived.level + character.adjustments.hp)}`}, speed: derived.speed,
			...derived.abilities, save: Object.fromEntries(ABILITIES.map(key => [key, signed(derived.saves[key])])),
			skill: Object.fromEntries(Object.entries(derived.skillBonuses).filter(([key]) => derived.skills[key]).map(([key, value]) => [key, signed(value)])),
			passive: derived.passive, pbNote: signed(derived.pb), initiative: derived.initiative,
			languages: [...new Set(languages)], trait,
			action: derived.attacks.map(attack => ({name: attack.isImported ? rendererText(attack.name) : attack.name, entries: [`{@atk ${attack.isRanged ? "rw" : attack.thrown ? "mw,rw" : "mw"}} {@hit ${attack.toHit}} to hit, ${attack.isRanged ? "range" : attack.thrown ? `reach ${attack.reach} or range` : "reach"} ${attack.range}${String(attack.range).includes("ft") ? "" : " ft."}, one target. {@h}{@damage ${attack.damage}} ${({B: "bludgeoning", P: "piercing", S: "slashing"})[attack.damageType] || attack.damageType} damage.`]})),
		};
		if (!Object.keys(creature.skill).length) delete creature.skill;
		const senses = [...(derived.race?.darkvision ? [`darkvision ${derived.race.darkvision} ft.`] : []), ...derived.origins.flatMap(it => (it.entity.senses || []).flatMap(sense => Object.entries(sense).filter(([, value]) => typeof value === "number").map(([name, value]) => `${name} ${value} ft.`)))];
		if (senses.length) creature.senses = [...new Set(senses)];
		for (const prop of ["resist", "immune", "vulnerable", "conditionImmune"]) {
			const values = derived.defenses[prop];
			if (values.length) creature[prop] = [...new Set(values)];
		}
		const spells = this.getSpells(character, derived).filter(it => it.row.prepared || !it.entity.level);
		creature.spellcasting = derived.casting.casters.map(caster => {
			const byLevel = {};
			for (const spell of spells.filter(it => it.caster === caster || it.row.classId === caster.row.id)) {
				(byLevel[spell.entity.level] ||= {spells: [], ...(spell.entity.level ? {slots: derived.casting.slots[spell.entity.level - 1] || caster.pact?.max || 0} : {})}).spells.push(`{@spell ${spell.entity.name}|${spell.entity.source}}`);
			}
			return {name: `${caster.entity.name} Spellcasting`, headerEntries: [`The spellcasting ability is ${caster.ability.toUpperCase()} (spell save {@dc ${caster.dc}}, {@hit ${caster.attack}} to hit with spell attacks).`], ability: caster.ability, spells: byLevel};
		});
		const innateCasters = new Map(spells.filter(it => it.row.granted && !derived.casting.casters.some(caster => caster.row.id === it.row.classId)).map(it => [it.row.classId, it.caster]));
		for (const [classId, caster] of innateCasters) {
			const entry = {name: `${caster.entity.name} Spellcasting`, headerEntries: [`The spellcasting ability is ${caster.ability.toUpperCase()} (spell save {@dc ${caster.dc}}, {@hit ${caster.attack}} to hit with spell attacks).`], ability: caster.ability};
			for (const spell of spells.filter(it => it.row.classId === classId)) {
				const tag = `{@spell ${spell.entity.name}|${spell.entity.source}}${spell.row.ritualOnly ? " (ritual only)" : ""}`;
				if (spell.row.innate) ((entry.daily ||= {})[`${spell.row.innate.max}e`] ||= []).push(tag);
				else (entry.will ||= []).push(tag);
			}
			creature.spellcasting.push(entry);
		}
		return creature;
	}
}
