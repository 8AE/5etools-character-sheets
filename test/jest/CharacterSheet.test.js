import fs from "node:fs";
import Ajv from "ajv";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import "../../js/hist.js";
import {patchLoadJson, unpatchLoadJson} from "../../node/util.js";
import {CharacterCatalog, CharacterEngine} from "../../js/characters/character-engine.js";
import {createCharacter, createClass, uid, subclassUid, exportCharacters, importCharacters, rollDice, createCustomOption, getCustomOptions} from "../../js/characters/character-model.js";
import {renderBuild} from "../../js/characters/character-builder.js";

const read = file => JSON.parse(fs.readFileSync(`data/${file}`, "utf8"));
patchLoadJson();
const data = await DataUtil.class.loadRawJSON().finally(unpatchLoadJson);
Object.assign(data, read("races.json"), read("backgrounds.json"), read("feats.json"), read("optionalfeatures.json"), read("languages.json"));
data.item = [...read("items-base.json").baseitem, ...read("items.json").item];
data.spell = [...read("spells/spells-phb.json").spell, ...read("spells/spells-xphb.json").spell];
const spellSources = read("generated/gendata-spell-source-lookup.json");
for (const spell of data.spell) {
	const sources = spellSources[spell.source.toLowerCase()]?.[spell.name.toLowerCase()]?.class || {};
	spell.classes = {fromClassList: Object.entries(sources).flatMap(([source, names]) => Object.keys(names).map(name => ({source, name})))};
}
const catalog = new CharacterCatalog(data);
const engine = new CharacterEngine(catalog);
const make = (name, level = 1, source = "PHB") => {
	const c = createCharacter({rules: source === "PHB" ? "2014" : "2024"});
	c.classes.push(createClass(catalog.get("class", `${name}|${source}`)));
	c.classes[0].level = level;
	return c;
};
const equip = (c, name, source = "PHB", extra = {}) => c.inventory.push({id: name, uid: `${name}|${source}`, quantity: 1, equipped: true, attuned: false, ...extra});
const chooseProficiency = (c, match, selected) => {
	const group = engine.derive(c).proficiencies.groups.find(match);
	expect(group).toBeDefined();
	c.proficiencyChoices[group.key] = selected;
};
const custom = (c, kind, name, description = "") => {
	const option = createCustomOption({kind, name, description});
	c.customOptions.push(option);
	return `custom:${option.id}`;
};

describe("Custom character choices", () => {
	it("renders the custom proficiency controls and selected level-up feat in the builder", () => {
		const c = make("Bard", 4, "XPHB");
		const ref = custom(c, "feat", "Skywatcher's Gift", "Know the stars.");
		c.classes[0].improvements[4] = {mode: "feat", feat: ref};
		// The real renderer needs the page's theme setting; no browser is used here.
		const previousConfig = globalThis.VetoolsConfig;
		globalThis.VetoolsConfig = {get: () => "classic"};
		let html;
		try { html = renderBuild({character: c, derived: engine.derive(c), catalog, engine}); }
		finally { if (previousConfig) globalThis.VetoolsConfig = previousConfig; else delete globalThis.VetoolsConfig; }
		expect(html).toContain("+ Custom language");
		expect(html).toContain("+ Custom tool");
		expect(html).toContain("Skywatcher&#39;s Gift · Custom");
		expect(html).toContain(`data-ref="${ref}"`);
		expect(html).not.toContain("undefined");
	});

	it("uses custom languages in level-gated proficiency slots and restores them after leveling back up", () => {
		const c = make("Ranger", 2, "XPHB");
		const ref = custom(c, "language", "Mooncant");
		chooseProficiency(c, it => it.title === "Deft Explorer: Languages", [ref, "language:elvish"]);
		let d = engine.derive(c);
		expect(d.proficiencies.languages).toContain("mooncant");
		expect(d.proficiencies.groups.find(it => it.title === "Deft Explorer: Languages").valid).toBe(true);
		c.classes[0].level = 1;
		expect(engine.derive(c).proficiencies.languages).not.toContain("mooncant");
		c.classes[0].level = 2;
		expect(engine.toCreature(c).languages).toContain("mooncant");
	});

	it("grants custom tool proficiency, enforces distinct choices, and updates renamed tools", () => {
		const c = make("Bard");
		const ref = custom(c, "tool", "Crystal Harp");
		const group = engine.derive(c).proficiencies.groups.find(it => it.title === "Bard: Tools");
		expect(group.customKinds).toContain("tool");
		c.proficiencyChoices[group.key] = [ref, "tool:lute", "tool:flute"];
		expect(engine.derive(c).proficiencies.tools["crystal harp"]).toBe(1);
		c.customOptions[0].name = "Silver Harp";
		expect(engine.derive(c).proficiencies.tools["silver harp"]).toBe(1);
		expect(engine.derive(c).proficiencies.tools["crystal harp"]).toBeUndefined();
		c.customOptions[0].name = "Lute";
		expect(engine.derive(c).proficiencies.groups.find(it => it.key === group.key).valid).toBe(false);
		c.proficiencyChoices[group.key] = [ref, "tool:lute", "tool:flute", "tool:horn"];
		expect(engine.derive(c).proficiencies.groups.find(it => it.key === group.key).valid).toBe(false);
	});

	it("records custom level-up feats without guessing rules from their names", () => {
		const c = make("Fighter", 4);
		const before = engine.derive(c).hp;
		const ref = custom(c, "feat", "Tough", "Dwarven Toughness");
		c.classes[0].improvements[4] = {mode: "feat", feat: ref};
		expect(engine.derive(c).hp).toBe(before);
		expect(engine.derive(c).origins.some(it => uid(it.entity) === ref)).toBe(true);
		expect(engine.toCreature(c).trait.some(it => it.name === "Tough (Custom)")).toBe(true);
		c.classes[0].level = 3;
		expect(engine.derive(c).origins.some(it => uid(it.entity) === ref)).toBe(false);
		c.classes[0].level = 4;
		expect(engine.derive(c).origins.some(it => uid(it.entity) === ref)).toBe(true);
		expect(engine.derive(make("Fighter", 4)).origins.some(it => uid(it.entity) === ref)).toBe(false);
	});

	it("uses custom features in class progression without exceeding its choice count", () => {
		const c = make("Sorcerer", 2, "XPHB");
		const ref = custom(c, "optionalfeature", "Echoed Spell", "A campaign metamagic option.");
		const group = engine.getProgressionChoices(engine.getClasses(c)[0], c).find(it => it.name === "Metamagic");
		c.classes[0].options[group.key] = [ref, "Subtle Spell|XPHB"];
		expect(engine.getProgressionChoices(engine.getClasses(c)[0], c).find(it => it.key === group.key).active).toHaveLength(2);
		expect(engine.derive(c).origins.some(it => uid(it.entity) === ref)).toBe(true);
		c.classes[0].level = 1;
		expect(engine.derive(c).origins.some(it => uid(it.entity) === ref)).toBe(false);
		expect(c.classes[0].options[group.key]).toContain(ref);
	});

	it("round trips custom definitions and references and defaults older exports", () => {
		const c = make("Fighter", 4);
		const ref = custom(c, "feat", "Star Reader", "Read the sky.\nKeep a star chart.");
		custom(c, "tool", "Cartographer's Lens");
		custom(c, "language", "Sky Signs");
		c.classes[0].improvements[4] = {mode: "feat", feat: ref};
		const json = exportCharacters([c]);
		const validate = new Ajv().compile(JSON.parse(fs.readFileSync("schema/characters.schema.json", "utf8")));
		expect(validate(json)).toBe(true);
		const restored = importCharacters(JSON.parse(JSON.stringify(json)))[0];
		expect(restored.customOptions).toEqual(c.customOptions);
		expect(engine.toCreature(restored).trait.some(it => it.name === "Star Reader (Custom)")).toBe(true);
		delete json.character[0].customOptions;
		expect(importCharacters(json)[0].customOptions).toEqual([]);
	});

	it("validates custom definitions and renders entered markup as literal text", () => {
		const c = make("Bard");
		const ref = custom(c, "feat", '<img src=x> {@dice 99d99}', '<script>alert(1)</script>\n{@link unsafe|https://example.com}');
		c.feats.push(ref);
		const trait = engine.toCreature(c).trait.find(it => it.name.endsWith("(Custom)"));
		expect(trait.name).toContain("&lt;img");
		expect(trait.name).not.toContain("{@dice");
		expect(trait.entries.join()).not.toContain("<script>");
		expect(trait.entries.join()).not.toContain("{@link");
		expect(getCustomOptions(c, "language")).toEqual([]);
		for (const invalid of [{kind: "class", name: "x"}, {kind: "feat", name: " "}, {kind: "feat", name: "x".repeat(201)}, {kind: "tool", name: "x", description: 123}, {kind: "feat", name: "x", id: "../x"}]) expect(() => createCustomOption(invalid)).toThrow();
		const json = exportCharacters([c]);
		json.character[0].customOptions.push({...json.character[0].customOptions[0]});
		expect(() => importCharacters(json)).toThrow("Custom option IDs must be unique");
	});
});

describe("Character sheet calculations with the local 5etools dataset", () => {
	it("loads every class and resolves the core class progression at every level", () => {
		expect(catalog.list("class").length).toBeGreaterThan(25);
		for (const entity of catalog.list("class")) {
			for (const ref of entity.classFeatures) expect(catalog.feature(ref)).toBeDefined();
			for (let level = 1; level <= 20; ++level) {
				const c = make(entity.name, level, entity.source);
				const d = engine.derive(c);
				expect(d.level).toBe(level);
				expect(d.pb).toBe(2 + Math.floor((level - 1) / 4));
				expect(d.features.every(it => it.entity.level <= level)).toBe(true);
				expect(Number.isFinite(d.hp)).toBe(true);
			}
		}
	});

	it("derives a stat block for every local subclass, species, background, feat, and optional feature", () => {
		for (const subclass of catalog.list("subclass")) {
			const c = make(subclass.className, 20, subclass.classSource);
			c.classes[0].subclass = subclassUid(subclass);
			expect(engine.toCreature(c).level).toBe(20);
		}
		for (const [prop, field, isArray] of [["race", "race", false], ["background", "background", false], ["feat", "feats", true], ["optionalfeature", "optionalFeatures", true]]) {
			for (const entity of catalog.list(prop)) {
				const c = make("Wizard", 20, "XPHB");
				c[field] = isArray ? [uid(entity)] : uid(entity);
				const creature = engine.toCreature(c);
				expect(Number.isFinite(creature.ac[0].ac)).toBe(true);
				expect(Number.isFinite(creature.hp.average)).toBe(true);
			}
		}
	});

	it("keeps subclass features locked until the class's subclass level", () => {
		const c = make("Fighter", 2, "XPHB");
		c.classes[0].subclass = subclassUid(catalog.list("subclass").find(it => it.name === "Champion" && it.source === "XPHB"));
		expect(engine.derive(c).classes[0].subclass).toBeNull();
		c.classes[0].level = 3;
		expect(engine.derive(c).classes[0].subclass.name).toBe("Champion");
		expect(engine.derive(c).features.some(it => it.entity.subclassShortName === "Champion")).toBe(true);
	});

	it("uses maximum first-level HP, rolled or average later HP, and retroactive CON", () => {
		const c = make("Fighter", 3);
		expect(engine.derive(c).hp).toBe(25); // 10 + 6 + 6 + three CON modifiers
		c.classes[0].hpRolls[2] = 9;
		expect(engine.derive(c).hp).toBe(28);
		c.abilities.con = 16;
		expect(engine.derive(c).hp).toBe(34);
		c.classes.push(createClass(catalog.get("class", "Wizard|PHB")));
		expect(engine.derive(c).hp).toBe(41); // multiclass uses 4 + CON, not max d6
	});

	it("applies automatic background skills, class saves, expertise, and proficiency scaling", () => {
		const c = make("Rogue", 5);
		c.background = "Acolyte|PHB";
		c.skills.stealth = 2;
		const d = engine.derive(c);
		expect(d.skills.insight).toBe(1);
		expect(d.skillBonuses.stealth).toBe(8);
		expect(d.saves.dex).toBe(5);
		expect(d.saves.str).toBe(2);
	});

	it("applies background ability choices only when the chosen pattern is valid", () => {
		const c = make("Fighter", 1, "XPHB");
		c.background = "Soldier|XPHB";
		c.abilityChoices.background = {index: 0, bonuses: {str: 2, con: 1}};
		expect(engine.derive(c).abilities.str).toBe(17);
		expect(engine.derive(c).abilities.con).toBe(14);
		c.abilityChoices.background.bonuses = {str: 3};
		expect(engine.derive(c).abilities.str).toBe(15);
		expect(engine.derive(c).warnings.some(it => it.includes("ability increases"))).toBe(true);
	});

	it("removes level-gated ASIs and feats from derived stats when leveling down", () => {
		const c = make("Fighter", 6);
		c.classes[0].improvements[4] = {mode: "asi", abilities: {str: 2}};
		c.classes[0].improvements[6] = {mode: "feat", feat: "Tough|PHB"};
		expect(engine.derive(c).abilities.str).toBe(17);
		expect(engine.derive(c).hp).toBe(58);
		c.classes[0].level = 3;
		expect(engine.derive(c).abilities.str).toBe(15);
		expect(engine.derive(c).origins.some(it => it.entity.name === "Tough")).toBe(false);
	});

	it("calculates light, medium, heavy armor, shields, magic bonuses and finesse attacks", () => {
		const c = make("Fighter", 5);
		c.abilities.dex = 18;
		equip(c, "Studded Leather Armor");
		equip(c, "Shield");
		equip(c, "Rapier");
		let d = engine.derive(c);
		expect(d.ac).toBe(18);
		expect(d.attacks[0].toHit).toBe(7);
		expect(d.attacks[0].damage).toBe("1d8+4");
		c.inventory[0].uid = "Half Plate Armor|PHB";
		expect(engine.derive(c).ac).toBe(19);
		c.inventory[0].uid = "Plate Armor|PHB";
		expect(engine.derive(c).ac).toBe(20);
	});

	it("only applies attunement-dependent armor bonuses after attuning", () => {
		const c = make("Wizard");
		equip(c, "Bracers of Defense", "DMG");
		expect(engine.derive(c).ac).toBe(12);
		c.inventory[0].attuned = true;
		expect(engine.derive(c).ac).toBe(14);
		equip(c, "Leather Armor");
		expect(engine.derive(c).ac).toBe(13);
	});

	it("renders thrown reach separately from range and uses class table display labels", () => {
		const c = make("Fighter", 4, "XPHB");
		c.classes[0].subclass = subclassUid(catalog.list("subclass").find(it => it.name === "Eldritch Knight" && it.source === "XPHB"));
		equip(c, "Javelin", "XPHB");
		const block = engine.toCreature(c);
		expect(block.action.find(it => it.name === "Javelin").entries[0]).toContain("reach 5 ft. or range 30/120 ft.");
		const progression = block.trait.find(it => it.name === "Class Progression").entries.join();
		expect(progression).toContain("Spells Prepared 4");
		expect(progression).not.toContain("subclass=");
	});

	it("reads full, half, third and pact casting progression from class data", () => {
		expect(engine.derive(make("Wizard", 5)).casting.slots.slice(0, 3)).toEqual([4, 3, 2]);
		expect(engine.derive(make("Paladin", 1)).casting.slots.filter(Boolean)).toEqual([]);
		expect(engine.derive(make("Paladin", 1, "XPHB")).casting.slots[0]).toBe(2);
		const c = make("Fighter", 3, "XPHB");
		c.classes[0].subclass = subclassUid(catalog.list("subclass").find(it => it.name === "Eldritch Knight" && it.source === "XPHB"));
		expect(engine.derive(c).casting.slots[0]).toBe(2);
		expect(engine.derive(c).casting.casters[0].prepared).toBe(3);
		const pact = engine.derive(make("Warlock", 5)).casting.casters[0].pact;
		expect(pact).toMatchObject({max: 2, level: 3});
	});

	it("combines multiclass caster levels and keeps pact magic separate", () => {
		const c = make("Wizard", 3);
		const cleric = createClass(catalog.get("class", "Cleric|PHB")); cleric.level = 2;
		const warlock = createClass(catalog.get("class", "Warlock|PHB")); warlock.level = 3;
		c.classes.push(cleric, warlock);
		const d = engine.derive(c);
		expect(d.casting.slots.slice(0, 3)).toEqual([4, 3, 2]);
		expect(d.casting.casters[0].maxSpellLevel).toBe(2);
		expect(d.casting.casters[2].pact).toMatchObject({max: 2, level: 2});
	});

	it("rounds revised half-caster multiclass levels up while retaining 2014 rounding", () => {
		const c = make("Wizard", 1, "XPHB");
		c.classes.push(createClass(catalog.get("class", "Paladin|XPHB")));
		expect(engine.derive(c).casting.slots[0]).toBe(3);
		c.classes[1].uid = "Paladin|PHB";
		expect(engine.derive(c).casting.slots[0]).toBe(2);
	});

	it("spends slots, prevents overspending, preserves cantrips and tracks concentration", () => {
		const c = make("Wizard");
		const magic = {uid: "Magic Missile|PHB", classId: c.classes[0].id, prepared: true};
		engine.cast(c, magic, "1"); engine.cast(c, magic, "1");
		expect(c.state.slots[1]).toBe(2);
		expect(() => engine.cast(c, magic, "1")).toThrow("available spell slot");
		engine.cast(c, {uid: "Fire Bolt|PHB", classId: magic.classId, prepared: true});
		expect(c.state.slots[1]).toBe(2);
		engine.cast(c, {uid: "Detect Magic|PHB", classId: magic.classId, prepared: true}, "", {ritual: true});
		expect(c.state.concentration).toBe("Detect Magic");
	});

	it("checks ritual eligibility separately from preparation and ordinary spell slots", () => {
		for (const [name, source, prepared, allowed] of [
			["Wizard", "PHB", false, true], ["Wizard", "XPHB", false, true],
			["Bard", "PHB", false, true], ["Cleric", "PHB", false, false], ["Cleric", "PHB", true, true],
			["Druid", "PHB", true, true], ["Artificer", "TCE", true, true],
			["Sorcerer", "PHB", true, false], ["Sorcerer", "XPHB", false, false], ["Sorcerer", "XPHB", true, true],
		]) {
			const c = make(name, 3, source);
			const spell = {uid: `Detect Magic|${source === "XPHB" ? source : "PHB"}`, classId: c.classes[0].id, prepared};
			expect(engine.canRitualCast(c, spell)).toBe(allowed);
			if (allowed) {
				expect(engine.cast(c, spell, "", {ritual: true})).toContain("no slot spent");
				expect(c.state.slots).toEqual({});
			} else expect(() => engine.cast(c, spell, "", {ritual: true})).toThrow("does not allow");
		}
	});

	it("keeps Book of Ancient Secrets rituals distinct from at-will and daily spells", () => {
		const c = make("Warlock", 3);
		c.optionalFeatures.push("Book of Ancient Secrets|PHB");
		const group = engine.getGrantedSpellData(c, engine.derive(c)).choices[0];
		expect(engine.matchesSpellFilter(catalog.get("spell", "Detect Magic|PHB"), group.filter)).toBe(true);
		expect(engine.matchesSpellFilter(catalog.get("spell", "Magic Missile|PHB"), group.filter)).toBe(false);
		c.spellChoices[group.source.key] = {index: 0, ability: "cha", chosen: {[group.path]: ["Detect Magic|PHB", "Identify|PHB"]}};
		const d = engine.derive(c);
		const granted = engine.getSpells(c, d);
		expect(granted).toHaveLength(2);
		for (const {row} of granted) {
			expect(row.ritualOnly).toBe(true);
			expect(row.atWill).toBeFalsy();
			expect(row.innate).toBeNull();
			expect(() => engine.cast(c, row, `pact:${c.classes[0].id}`)).toThrow("ritual casting only");
			engine.cast(c, row, "", {ritual: true});
			engine.cast(c, row, "", {ritual: true});
		}
		expect(c.state.pact).toEqual({});
		expect(c.state.resources).toEqual({});
		const known = {uid: "Comprehend Languages|PHB", classId: c.classes[0].id, prepared: true};
		expect(engine.canRitualCast(c, known)).toBe(true);
		c.optionalFeatures = [];
		expect(engine.canRitualCast(c, known)).toBe(false);
	});

	it("applies the Ritual Caster feat's edition-specific casting and ability rules", () => {
		const c = make("Fighter", 5);
		c.feats.push("Ritual Caster|PHB");
		const key = "feat:ritual caster|phb";
		c.spellChoices[key] = {index: 5, ability: "", chosen: {}};
		const group = engine.getGrantedSpellData(c, engine.derive(c)).choices[0];
		c.spellChoices[key].chosen[group.path] = ["Detect Magic|PHB", "Identify|PHB"];
		const granted = engine.getSpells(c, engine.derive(c));
		expect(granted).toHaveLength(2);
		expect(granted[0].caster.ability).toBe("int");
		expect(granted[0].row).toMatchObject({ritualOnly: true, innate: null});
		expect(() => engine.cast(c, granted[0].row, "innate")).toThrow("ritual casting only");
		engine.cast(c, granted[0].row, "", {ritual: true});
		engine.cast(c, granted[0].row, "", {ritual: true});
		expect(c.state.resources).toEqual({});

		c.feats = ["Ritual Caster|XPHB"];
		const modernKey = "feat:ritual caster|xphb";
		c.abilityChoices[modernKey] = {index: 0, bonuses: {wis: 1}};
		const modernGroup = engine.getGrantedSpellData(c, engine.derive(c)).choices[0];
		c.spellChoices[modernKey] = {index: 0, ability: "", chosen: {[modernGroup.path]: ["Detect Magic|XPHB", "Identify|XPHB"]}};
		const modern = engine.getSpells(c, engine.derive(c));
		expect(modern[0].caster.ability).toBe("wis");
		expect(modern[0].row.ritualOnly).toBeFalsy();
		expect(engine.canRitualCast(c, modern[0].row)).toBe(true);
	});

	it("preserves explicit ritual permission through import without bypassing armor training", () => {
		const c = make("Sorcerer");
		c.spells.push({uid: "Detect Magic|PHB", classId: c.classes[0].id, prepared: true, ritualAllowed: true});
		const json = exportCharacters([c]);
		const restored = importCharacters(json)[0];
		expect(engine.canRitualCast(restored, restored.spells[0])).toBe(true);
		equip(restored, "Plate Armor");
		expect(engine.canRitualCast(restored, restored.spells[0])).toBe(false);
		expect(() => engine.cast(restored, restored.spells[0], "", {ritual: true})).toThrow("training");
		json.character[0].spells[0].ritualAllowed = "yes";
		expect(() => importCharacters(json)).toThrow("ritual casting override");
	});

	it("absorbs damage with temporary HP and clamps healing to max HP", () => {
		const c = make("Fighter");
		c.state.tempHp = 5;
		engine.changeHp(c, 8);
		expect(c.state.tempHp).toBe(0);
		expect(engine.derive(c).currentHp).toBe(8);
		engine.changeHp(c, -100);
		expect(engine.derive(c).currentHp).toBe(11);
		engine.changeHp(c, 100);
		expect(engine.derive(c).currentHp).toBe(0);
	});

	it("recovers pact and short-rest resources without restoring regular slots or HP", () => {
		const c = make("Warlock", 3);
		c.state.damage = 5;
		c.state.slots[1] = 1;
		c.state.pact[c.classes[0].id] = 2;
		engine.rest(c, "short");
		expect(c.state.pact).toEqual({});
		expect(c.state.damage).toBe(5);
		expect(c.state.slots[1]).toBe(1);
	});

	it("recovers half the total hit dice in 2014 and all in 2024", () => {
		const c = make("Fighter", 5);
		c.state.hitDice[c.classes[0].id] = 5;
		c.state.damage = 10;
		engine.rest(c, "long");
		expect(c.state.hitDice[c.classes[0].id]).toBe(3);
		expect(c.state.damage).toBe(0);
		c.rules = "2024";
		engine.rest(c, "long");
		expect(c.state.hitDice).toEqual({});
	});

	it("spending a hit die uses CON, heals, and cannot exceed the pool", () => {
		const c = make("Fighter");
		c.state.damage = 10;
		expect(engine.spendHitDie(c, c.classes[0].id, () => 0.5)).toBe(7);
		expect(c.state.damage).toBe(3);
		expect(() => engine.spendHitDie(c, c.classes[0].id)).toThrow("No hit dice");
	});

	it("creates a bestiary-compatible creature with literal user text", () => {
		const c = make("Fighter");
		c.name = '<img src=x onerror=alert(1)> {@b surprise}';
		const creature = engine.toCreature(c);
		expect(creature.name).not.toContain("<img");
		expect(creature.name).not.toContain("{@b");
		expect(creature.action[0].entries[0]).toContain("{@hit 4}");
		expect(creature.pbNote).toBe("+2");
		expect(creature.hp.formula).toBe("1d10+1");
	});

	it("loads embedded class feature choices and applies only a complete selection", () => {
		const c = make("Cleric", 1, "XPHB");
		const group = engine.getFeatureChoiceGroups(engine.getClasses(c)[0]).find(it => it.title === "Divine Order");
		expect(group.options.map(it => it.entity.name)).toEqual(["Protector", "Thaumaturge"]);
		expect(engine.derive(c).origins.some(it => it.entity.name === "Protector")).toBe(false);
		c.featureChoices[group.key] = [group.options[0].id];
		expect(engine.derive(c).origins.some(it => it.entity.name === "Protector")).toBe(true);
		c.featureChoices[group.key].push(group.options[1].id);
		expect(engine.derive(c).origins.some(it => it.entity.name === "Protector")).toBe(false);
	});

	it("automatically grants subclass spells at the correct class level", () => {
		const c = make("Cleric", 3, "XPHB");
		c.classes[0].subclass = subclassUid(catalog.list("subclass").find(it => it.name === "Life Domain" && it.source === "XPHB"));
		let d = engine.derive(c);
		expect(engine.getSpells(c, d).map(it => it.entity.name)).toEqual(["Aid", "Bless", "Cure Wounds", "Lesser Restoration"]);
		c.classes[0].level = 5;
		d = engine.derive(c);
		expect(engine.getSpells(c, d).some(it => it.entity.name === "Revivify")).toBe(true);
		c.classes[0].level = 2;
		d = engine.derive(c);
		expect(engine.getSpells(c, d)).toEqual([]);
	});

	it("tracks species spells and daily uses independently of class slots", () => {
		const c = make("Fighter", 3);
		c.race = "Tiefling|PHB";
		let d = engine.derive(c);
		const rebuke = engine.getSpells(c, d).find(it => it.entity.name === "Hellish Rebuke");
		expect(rebuke.row.innate.level).toBe(2);
		expect(rebuke.caster.ability).toBe("cha");
		engine.cast(c, rebuke.row, "innate");
		expect(() => engine.cast(c, rebuke.row, "innate")).toThrow("No free uses");
		engine.rest(c, "long");
		expect(c.state.resources[rebuke.row.innate.id]).toBe(0);
		d = engine.derive(c);
		expect(engine.toCreature(c, d).spellcasting[0].daily["1e"][0]).toContain("Hellish Rebuke");
	});

	it("requires a species spell variant and uses the selected casting ability", () => {
		const c = make("Fighter", 3, "XPHB");
		c.race = "Tiefling|XPHB";
		expect(engine.getSpells(c, engine.derive(c))).toEqual([]);
		c.spellChoices.race = {index: 2, ability: "wis", chosen: {}};
		const spells = engine.getSpells(c, engine.derive(c));
		expect(spells.map(it => it.entity.name)).toEqual(["Thaumaturgy", "Fire Bolt", "Hellish Rebuke"]);
		expect(spells[0].caster.dc).toBe(10);
	});

	it("keeps learned spells alongside species grants after a JSON round trip", () => {
		const c = make("Wizard", 3, "XPHB");
		c.race = "Tiefling|XPHB";
		c.spellChoices.race = {index: 2, ability: "cha", chosen: {}};
		c.spells.push({uid: "Magic Missile|XPHB", classId: c.classes[0].id, prepared: true});
		const restored = importCharacters(JSON.parse(JSON.stringify(exportCharacters([c]))))[0];
		const spells = engine.getSpells(restored, engine.derive(restored));
		expect(spells).toHaveLength(4);
		expect(spells[0].entity.name).toBe("Magic Missile");
	});

	it("scales cantrip damage and common spell upcasting without executing formulas", () => {
		expect(engine.getSpellRolls(catalog.get("spell", "Fire Bolt|PHB"), 11)[0].dice).toBe("3d10");
		const fireball = engine.getSpellRolls(catalog.get("spell", "Fireball|PHB"), 7, 4)[0];
		expect(rollDice(fireball.dice, () => 0).total).toBe(9);
		const cure = engine.getSpellRolls(catalog.get("spell", "Cure Wounds|XPHB"), 3, 2, 3)[0];
		expect(rollDice(cure.dice, () => 0).total).toBe(7);
	});

	it("uses different monk martial-arts dice for the two editions and correct speed thresholds", () => {
		const c = make("Monk", 4);
		c.abilities.dex = 18;
		let d = engine.derive(c);
		expect(d.attacks[0].damage).toBe("1d4+4");
		expect(d.speed.walk).toBe(40);
		c.classes[0].level = 6;
		expect(engine.derive(c).speed.walk).toBe(45);
		c.classes[0].uid = "Monk|XPHB";
		d = engine.derive(c);
		expect(d.attacks[0].damage).toBe("1d8+4");
		equip(c, "Shield");
		expect(engine.derive(c).attacks[0].damage).toBe("3");
	});

	it("warns about spell preparation limits, unavailable choices and missing sources", () => {
		const c = make("Wizard");
		c.spells = ["Magic Missile", "Shield", "Burning Hands"].map(name => ({uid: `${name}|PHB`, classId: c.classes[0].id, prepared: true}));
		c.inventory.push({id: "missing", uid: "Unknown Sword|UNKNOWN", quantity: 1, equipped: true, attuned: false});
		const d = engine.derive(c);
		expect(d.warnings.some(it => it.includes("more than 2 spells are prepared"))).toBe(true);
		expect(d.warnings.some(it => it.includes("Missing item"))).toBe(true);
	});

	it("preserves missing-source references across an export/import", () => {
		const c = make("Fighter");
		c.race = "Custom ancestry|MY_BREW";
		const json = exportCharacters([c]);
		expect(importCharacters(json)[0].race).toBe(c.race);
	});

	it("keeps missing-source class levels in the total and prevents casting after a level reduction", () => {
		const c = make("Wizard", 5);
		const spell = {uid: "Fireball|PHB", classId: c.classes[0].id, prepared: true};
		engine.cast(c, spell, "3");
		expect(c.state.lastSpellLevels[`${spell.classId}:Fireball|PHB`]).toBe(3);
		c.classes[0].level = 1;
		expect(() => engine.cast(c, spell, "3")).toThrow("current level");
		c.classes.push({...createClass({name: "Lost class", source: "CUSTOM"}), level: 5});
		expect(engine.derive(c).level).toBe(6);
	});

	it("scales class-table feature dice with level", () => {
		const c = make("Rogue", 5);
		expect(engine.derive(c).progression.find(it => it.label === "Sneak Attack").dice).toBe("3d6");
		c.classes[0].level = 11;
		expect(engine.derive(c).progression.find(it => it.label === "Sneak Attack").dice).toBe("6d6");
	});

	it("requires a valid origin resistance choice and includes it in the stat block", () => {
		const c = make("Fighter", 1, "XPHB");
		c.race = "Tiefling|XPHB";
		expect(engine.toCreature(c).resist).toBeUndefined();
		c.defenseChoices["race:resist:0"] = ["fire"];
		expect(engine.toCreature(c).resist).toEqual(["fire"]);
		c.defenseChoices["race:resist:0"] = ["fire", "poison"];
		expect(engine.toCreature(c).resist).toBeUndefined();
	});

	it("offers 2024 starting languages from the local language table", () => {
		const c = make("Fighter", 1, "XPHB");
		let d = engine.derive(c);
		expect(d.proficiencies.languages).toEqual(["common"]);
		const choices = d.proficiencies.groups.find(it => it.origin === "character-languages-2024");
		expect(choices.options.some(it => it.key === "elvish")).toBe(true);
		expect(choices.options.some(it => it.key === "infernal")).toBe(false);
		chooseProficiency(c, it => it.origin === "character-languages-2024", ["language:elvish", "language:dwarvish"]);
		d = engine.derive(c);
		expect(engine.toCreature(c, d).languages).toEqual(["common", "elvish", "dwarvish"]);
		expect(engine.derive(make("Fighter")).proficiencies.groups.some(it => it.origin === "character-languages-2024")).toBe(false);
	});

	it("grants bard instrument choices and uses multiclass proficiency counts", () => {
		const c = make("Bard", 3);
		c.background = "Charlatan|PHB";
		chooseProficiency(c, it => it.title === "Bard: Tools", ["tool:lute", "tool:flute", "tool:drum"]);
		const d = engine.derive(c);
		expect(d.proficiencies.tools).toMatchObject({lute: 1, flute: 1, drum: 1, "disguise kit": 1, "forgery kit": 1});
		const multi = make("Fighter");
		multi.classes.push(createClass(catalog.get("class", "Bard|PHB")));
		expect(engine.derive(multi).proficiencies.groups.find(it => it.title === "Bard: Tools").count).toBe(1);
	});

	it("automates rogue skill/tool expertise at the source's levels and deactivates lost grants", () => {
		const c = make("Rogue", 6);
		c.skillChoices[`class:${c.classes[0].id}`] = ["stealth", "perception", "acrobatics", "sleight of hand"];
		const groups = engine.derive(c).proficiencies.groups.filter(it => it.isExpertise);
		expect(groups).toHaveLength(2);
		c.proficiencyChoices[groups[0].key] = ["skill:stealth", "tool:thieves' tools"];
		c.proficiencyChoices[groups[1].key] = ["skill:perception", "skill:acrobatics"];
		let d = engine.derive(c);
		expect(d.proficiencies.tools["thieves' tools"]).toBe(2);
		expect(d.skillBonuses.stealth).toBe(8);
		expect(d.skillBonuses.perception).toBe(6);
		c.classes[0].level = 5;
		d = engine.derive(c);
		expect(d.skillBonuses.stealth).toBe(8);
		expect(d.skillBonuses.perception).toBe(3);
	});

	it("uses edition-specific expertise unlocks and excludes tools from 2024 rogue expertise", () => {
		expect(engine.derive(make("Bard", 2)).proficiencies.groups.some(it => it.isExpertise)).toBe(false);
		expect(engine.derive(make("Bard", 2, "XPHB")).proficiencies.groups.some(it => it.isExpertise)).toBe(true);
		const c = make("Rogue", 1, "XPHB");
		c.skillChoices[`class:${c.classes[0].id}`] = ["stealth", "perception", "acrobatics", "sleight of hand"];
		const group = engine.derive(c).proficiencies.groups.find(it => it.isExpertise);
		expect(group.options.every(it => it.kind === "skill")).toBe(true);
		expect(engine.derive(make("Ranger", 9, "XPHB")).proficiencies.groups.filter(it => it.isExpertise).map(it => it.count)).toEqual([1, 2]);
	});

	it("keeps legacy skill selections working with manual expertise overrides", () => {
		const c = make("Rogue", 3);
		c.skillChoices[`class:${c.classes[0].id}`] = ["stealth", "perception", "acrobatics", "sleight of hand"];
		c.skills.stealth = 2;
		expect(engine.derive(c).skills).toMatchObject({stealth: 2, perception: 1, acrobatics: 1, "sleight of hand": 1});
	});

	it("supports mixed skill/tool choices without granting duplicate or invalid selections", () => {
		const c = make("Wizard", 1, "XPHB");
		c.feats.push("Skilled|XPHB");
		chooseProficiency(c, it => it.title.startsWith("Skilled:"), ["skill:arcana", "tool:lute", "tool:dice set"]);
		let d = engine.derive(c);
		expect(d.skills.arcana).toBe(1);
		expect(d.proficiencies.tools).toMatchObject({lute: 1, "dice set": 1});
		chooseProficiency(c, it => it.title.startsWith("Skilled:"), ["skill:arcana", "skill:arcana", "tool:lute"]);
		d = engine.derive(c);
		expect(d.skills.arcana).toBe(0);
		expect(d.proficiencies.tools.lute).toBeUndefined();
	});

	it("offers Skill Expert expertise only after gaining a skill proficiency", () => {
		const c = make("Fighter", 4, "XPHB");
		c.feats.push("Skill Expert|XPHB");
		chooseProficiency(c, it => it.title === "Skill Expert: Skills", ["skill:arcana"]);
		chooseProficiency(c, it => it.title === "Skill Expert: Expertise", ["skill:arcana"]);
		expect(engine.derive(c).skillBonuses.arcana).toBe(5);
	});

	it("applies race weapon training and the structured 2024 finesse/light filters", () => {
		const c = make("Wizard");
		c.race = "Dwarf|PHB";
		equip(c, "Battleaxe");
		expect(engine.derive(c).attacks[0].proficient).toBe(true);
		const rogue = make("Rogue", 1, "XPHB");
		equip(rogue, "Rapier", "XPHB");
		equip(rogue, "Greatsword", "XPHB");
		expect(engine.derive(rogue).attacks.slice(0, 2).map(it => it.proficient)).toEqual([true, false]);
		const monk = make("Monk", 1, "XPHB");
		equip(monk, "Shortsword", "XPHB");
		expect(engine.derive(monk).attacks[0].proficient).toBe(true);
	});

	it("enforces armor training for casting and supports source-granted and manual training", () => {
		const c = make("Wizard");
		equip(c, "Chain Mail");
		const spell = {uid: "Magic Missile|PHB", classId: c.classes[0].id, prepared: true};
		expect(() => engine.cast(c, spell, "1")).toThrow("training");
		c.feats.push("Heavily Armored|PHB");
		expect(engine.derive(c).armorIsProficient).toBe(true);
		engine.cast(c, spell, "1");
		c.feats = [];
		c.armorTraining.heavy = true;
		expect(engine.derive(c).armorIsProficient).toBe(true);
	});

	it("round trips proficiency choices and rejects malformed patterns or training", () => {
		const c = make("Bard", 2, "XPHB");
		chooseProficiency(c, it => it.title === "Bard: Tools", ["tool:lute", "tool:flute", "tool:drum"]);
		const restored = importCharacters(exportCharacters([c]))[0];
		expect(engine.derive(restored).proficiencies.tools).toEqual(engine.derive(c).proficiencies.tools);
		const json = exportCharacters([c]);
		json.character[0].proficiencyPatterns.invalid = "1";
		expect(() => importCharacters(json)).toThrow("proficiency pattern");
		delete json.character[0].proficiencyPatterns.invalid;
		json.character[0].armorTraining.heavy = "yes";
		expect(() => importCharacters(json)).toThrow("armor training");
	});

	it("switches alternative proficiency sets instead of granting every alternative", () => {
		const c = make("Fighter");
		c.background = "Clan Crafter|SCAG";
		expect(engine.derive(c).proficiencies.languages).toContain("dwarvish");
		c.proficiencyPatterns["background:languageProficiencies"] = 1;
		chooseProficiency(c, it => it.title === "Clan Crafter: Languages", ["language:elvish"]);
		const languages = engine.derive(c).proficiencies.languages;
		expect(languages).toContain("elvish");
		expect(languages).not.toContain("dwarvish");
	});

	it("applies only the chosen Divine Order training", () => {
		const c = make("Cleric", 1, "XPHB");
		const group = engine.getFeatureChoiceGroups(engine.getClasses(c)[0]).find(it => it.title === "Divine Order");
		expect(engine.derive(c).proficiencies.armor).not.toContain("heavy");
		c.featureChoices[group.key] = [group.options.find(it => it.entity.name === "Protector").id];
		expect(engine.derive(c).proficiencies.armor).toContain("heavy");
		expect(engine.derive(c).proficiencies.weapons).toContain("martial");
		c.featureChoices[group.key] = [];
		expect(engine.derive(c).proficiencies.armor).not.toContain("heavy");
	});

	it("scales artificer tool expertise and accepts conditional item properties", () => {
		const c = make("Artificer", 6, "TCE");
		expect(engine.derive(c).proficiencies.tools["thieves' tools"]).toBe(2);
		c.classes[0].level = 5;
		expect(engine.derive(c).proficiencies.tools["thieves' tools"]).toBe(1);
		const fighter = make("Fighter", 3, "XPHB");
		equip(fighter, "Lance", "XPHB");
		expect(engine.derive(fighter).attacks[0].range).toBe("10 ft.");
	});

	it("uses source progression to unlock and limit metamagic choices", () => {
		const classic = make("Sorcerer", 2);
		expect(engine.getProgressionChoices(engine.getClasses(classic)[0], classic)).toEqual([]);
		const c = make("Sorcerer", 2, "XPHB");
		const group = engine.getProgressionChoices(engine.getClasses(c)[0], c)[0];
		expect(group.count).toBe(2);
		expect(group.available.every(it => it.featureType.includes("MM"))).toBe(true);
		c.classes[0].options[group.key] = ["Quickened Spell|XPHB", "Careful Spell|XPHB"];
		expect(engine.derive(c).origins.filter(it => it.prop === "optionalfeature")).toHaveLength(2);
		c.classes[0].level = 1;
		expect(engine.derive(c).origins.filter(it => it.prop === "optionalfeature")).toEqual([]);
		c.classes[0].level = 10;
		expect(engine.getProgressionChoices(engine.getClasses(c)[0], c)[0].count).toBe(4);
	});

	it("deactivates invocations above the class level without discarding their saved choices", () => {
		const c = make("Warlock", 9);
		const group = engine.getProgressionChoices(engine.getClasses(c)[0], c).find(it => it.name === "Eldritch Invocations");
		c.classes[0].options[group.key] = ["Ascendant Step|PHB", "Mask of Many Faces|PHB", "Misty Visions|PHB"];
		expect(engine.derive(c).origins.filter(it => it.prop === "optionalfeature")).toHaveLength(3);
		c.classes[0].level = 2;
		const lowered = engine.getProgressionChoices(engine.getClasses(c)[0], c).find(it => it.name === "Eldritch Invocations");
		expect(lowered.count).toBe(2);
		expect(lowered.available.some(it => it.name === "Ascendant Step")).toBe(false);
		expect(engine.derive(c).origins.filter(it => it.prop === "optionalfeature").map(it => it.entity.name)).toEqual(["Mask of Many Faces"]);
		expect(c.classes[0].options[group.key]).toHaveLength(3);
	});

	it("keeps class and subclass fighting-style slots separate and does not double-grant an Epic Boon", () => {
		const c = make("Fighter", 7, "XPHB");
		c.classes[0].subclass = subclassUid(catalog.list("subclass").find(it => it.name === "Champion" && it.source === "XPHB"));
		const groups = engine.getProgressionChoices(engine.getClasses(c)[0], c);
		expect(groups).toHaveLength(2);
		c.classes[0].options[groups[0].key] = ["Defense|XPHB"];
		c.classes[0].options[groups[1].key] = ["Archery|XPHB"];
		expect(engine.derive(c).origins.filter(it => it.prop === "feat").map(it => it.entity.name)).toEqual(["Defense", "Archery"]);
		c.classes[0].level = 6;
		expect(engine.derive(c).origins.filter(it => it.prop === "feat").map(it => it.entity.name)).toEqual(["Defense"]);
		c.classes[0].level = 19;
		expect(engine.getProgressionChoices(engine.getClasses(c)[0], c).some(it => it.name === "Epic Boon")).toBe(false);
		expect(engine.getImprovements(engine.getClasses(c)[0]).some(it => it.name === "Epic Boon")).toBe(true);
		c.classes[0].subclass = "";
		expect(engine.derive(c).origins.filter(it => it.prop === "feat").map(it => it.entity.name)).toEqual(["Defense"]);
	});

	it("applies required optional features and preserves progression choices in portable JSON", () => {
		const c = make("Monk", 3);
		c.classes[0].subclass = subclassUid(catalog.list("subclass").find(it => it.name === "Way of the Four Elements" && it.source === "PHB"));
		const group = engine.getProgressionChoices(engine.getClasses(c)[0], c)[0];
		expect(group.count).toBe(2);
		expect(group.required).toEqual(["Elemental Attunement|PHB"]);
		expect(engine.derive(c).origins.some(it => it.entity.name === "Elemental Attunement")).toBe(true);
		c.classes[0].options[group.key] = ["Fangs of the Fire Snake|PHB"];
		const restored = importCharacters(exportCharacters([c]))[0];
		expect(engine.derive(restored).origins.filter(it => it.prop === "optionalfeature")).toHaveLength(2);
		const invalid = exportCharacters([c]);
		invalid.character[0].classes[0].options[group.key] = [null];
		expect(() => importCharacters(invalid)).toThrow("class feature choices");
	});
});

describe("Character JSON and dice safety", () => {
	it("creates and reimports a character when the browser lacks crypto.randomUUID", () => {
		const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
		const browserCrypto = {getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto)};
		Object.defineProperty(globalThis, "crypto", {configurable: true, value: browserCrypto});
		globalThis.window = globalThis;
		try {
			const c = make("Rogue", 1, "XPHB");
			const [copy] = importCharacters(exportCharacters([c]));
			const ids = [c.id, c.classes[0].id, copy.id];
			for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
			expect(new Set(ids).size).toBe(ids.length);
			expect(copy.classes).toEqual(c.classes);
		} finally {
			delete globalThis.window;
			Object.defineProperty(globalThis, "crypto", cryptoDescriptor);
		}
	});

	it("validates generated exports against the published envelope schema", () => {
		const schema = JSON.parse(fs.readFileSync("schema/characters.schema.json", "utf8"));
		const validate = new Ajv().compile(schema);
		expect(validate(exportCharacters([make("Wizard"), make("Fighter", 4, "XPHB")]))).toBe(true);
	});
	it("round trips multiple characters without losing choices or play state", () => {
		const c = make("Fighter", 4);
		c.classes[0].improvements[4] = {mode: "asi", abilities: {str: 2}};
		c.state.damage = 9;
		c.notes = "A journal entry\nwith newlines.";
		const json = JSON.parse(JSON.stringify(exportCharacters([c, make("Wizard", 2)])));
		const imported = importCharacters(json, {keepIds: true});
		expect(imported).toEqual(json.character);
		expect(importCharacters(json)[0].id).not.toBe(c.id);
	});

	it("rejects incompatible files, over-level characters and malformed nested state", () => {
		const json = exportCharacters([make("Fighter")]);
		expect(() => importCharacters({monster: []})).toThrow("not a character");
		expect(() => importCharacters({...json, version: 999})).toThrow("Unsupported");
		json.character[0].classes[0].level = 21;
		expect(() => importCharacters(json)).toThrow("levels");
		json.character[0].classes[0].level = 1;
		json.character[0].state.slots = "invalid";
		expect(() => importCharacters(json)).toThrow("wrong type");
	});

	it("rejects prototype keys and an invalid later character atomically", () => {
		const json = exportCharacters([make("Fighter"), make("Wizard")]);
		json.character[1].abilities.str = -1;
		expect(() => importCharacters(json)).toThrow("Ability scores");
		expect(json.character[0].id).toBeTruthy();
		expect(() => importCharacters(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow("Unsafe property");
		expect({}.polluted).toBeUndefined();
	});

	it("evaluates dice arithmetic without evaluating code", () => {
		expect(rollDice("2d6+3", () => 0).total).toBe(5);
		expect(rollDice("1d20-2", () => 0.999).total).toBe(18);
		expect(() => rollDice("alert(1)")).toThrow();
		expect(() => rollDice("1000000d6")).toThrow();
		expect(() => rollDice("1d0")).toThrow();
	});
});
