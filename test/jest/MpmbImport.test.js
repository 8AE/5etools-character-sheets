import fs from "node:fs";
import {jest} from "@jest/globals";
import Ajv from "ajv";
import {PDFDocument} from "pdf-lib";
import "../../js/parser.js";
import "../../js/utils.js";
import "../../js/render.js";
import {CharacterCatalog, CharacterEngine} from "../../js/characters/character-engine.js";
import {createCharacter, exportCharacters, importCharacters} from "../../js/characters/character-model.js";
import {readMpmbPdf} from "../../js/characters/character-import-pdf.js";
import {convertMpmbFields, parseMpmbLiteral} from "../../js/characters/character-import-mpmb.js";
import {importMpmbFile, renderMpmbReview} from "../../js/characters/character-import-mpmb-ui.js";
import {renderBuild, renderInventory} from "../../js/characters/character-builder.js";

// Synthetic characters only. No personal PDF or extracted player data is committed.
const read = file => JSON.parse(fs.readFileSync(`data/${file}`, "utf8"));
const classes = Object.values(read("class/index.json")).map(file => read(`class/${file}`));
const data = Object.fromEntries(["class", "subclass", "classFeature", "subclassFeature"].map(prop => [prop, classes.flatMap(it => it[prop] || [])]));
Object.assign(data, read("races.json"), read("backgrounds.json"), read("feats.json"), read("optionalfeatures.json"), read("languages.json"));
data.race = DataUtil.race.getPostProcessedSiteJson(read("races.json"), {isAddBaseRaces: true}).race;
data.item = [...read("items-base.json").baseitem, ...read("items.json").item];
const variantData = read("magicvariants.json");
variantData.magicvariant = variantData.magicvariant.filter(it => it.inherits && ["+2 Armor", "+2 Weapon"].includes(it.name));
globalThis.VetoolsConfig = {get: () => "classic"};
const [variants, linkedLootTables] = Renderer.item._getAndProcGenericVariants(variantData);
data.item.push(...Renderer.item._createSpecificVariants(read("items-base.json").baseitem, variants, {linkedLootTables}));
delete globalThis.VetoolsConfig;
data.spell = [...read("spells/spells-phb.json").spell, ...read("spells/spells-xphb.json").spell];
const spellSources = read("generated/gendata-spell-source-lookup.json");
for (const spell of data.spell) {
	const sources = spellSources[spell.source.toLowerCase()]?.[spell.name.toLowerCase()]?.class || {};
	spell.classes = {fromClassList: Object.entries(sources).flatMap(([source, names]) => Object.keys(names).map(name => ({source, name})))};
}
const catalog = new CharacterCatalog(data);
const engine = new CharacterEngine(catalog);
const baseFields = () => ({
	"PC Name": "Test Wayfarer", "Class and Levels": "Wizard (Evocation) 4", "Character Level": "4",
	"Class Features": "Wizard (Evocation), level 4:", "CurrentStats.Stringified": "({cols:[{type:'base',scores:[8,8,8,8,8,8]}]})",
	Race: ["Human"], Background: ["Sage"], Alignment: ["Neutral Good"],
	Str: "10", Dex: "14", Con: "14", Int: "18", Wis: "12", Cha: "10",
	"HP Max": "37", "HP Current": "29", "HP Temp": "3", AC: "15", "Speed": "30", "Initiative bonus": "+3",
	"Language 1": "Common", "Language 2": "Deep Speech", "Tool 1": "Star Chart (expertise)",
	"Gold Pieces": "123", "Death Save Success1": true, "Death Save Fail2": true,
});
const extract = fields => ({fields: {...baseFields(), ...fields}, metadata: {title: "MPMB character sheet"}});
const convert = (fields = {}, options = {}) => convertMpmbFields(extract(fields), catalog, options);
async function makePdf (fields = baseFields(), {title = "MorePurpleMoreBetter's character sheet", script = ""} = {}) {
	const pdf = await PDFDocument.create();
	pdf.setTitle(title);
	const page = pdf.addPage();
	const form = pdf.getForm();
	for (const [name, value] of Object.entries(fields)) {
		if (typeof value === "boolean") {
			const field = form.createCheckBox(name); field.addToPage(page); if (value) field.check();
		} else if (Array.isArray(value)) {
			const field = form.createDropdown(name); field.addOptions(value); field.select(value); field.addToPage(page);
		} else { const field = form.createTextField(name); field.setText(String(value)); }
	}
	if (script) pdf.addJavaScript("test", script);
	return pdf.save({updateFieldAppearances: false});
}
const asFile = bytes => ({name: "synthetic-mpmb.pdf", size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});

describe("MPMB PDF extraction", () => {
	it("reads saved text, dropdowns and checkboxes without running embedded JavaScript", async () => {
		const bytes = await makePdf(baseFields(), {script: "globalThis.mpmbScriptExecuted = true;"});
		const result = await readMpmbPdf(bytes);
		expect(result.fields["PC Name"]).toBe("Test Wayfarer");
		expect(result.fields.Race).toEqual(["Human"]);
		expect(result.fields["Death Save Success1"]).toBe(true);
		expect(globalThis.mpmbScriptExecuted).toBeUndefined();
		const draft = convertMpmbFields(result, catalog);
		expect(draft.character.classes[0].subclass).toBe("School of Evocation|PHB|Wizard|PHB");
		expect(engine.derive(draft.character).currentHp).toBe(29);
	});
	it("rejects non-PDF, corrupt, empty and flattened uploads", async () => {
		await expect(readMpmbPdf(new TextEncoder().encode("not a PDF"))).rejects.toThrow("not a PDF");
		await expect(readMpmbPdf(new TextEncoder().encode("%PDF-1.7\ninvalid"))).rejects.toThrow("could not be read");
		await expect(readMpmbPdf(new Uint8Array())).rejects.toThrow("50 MiB");
		await expect(readMpmbPdf(await makePdf({}))).rejects.toThrow("no saved form fields");
	});
	it("rejects a different PDF form and an unsaved character without changing any state", () => {
		expect(() => convertMpmbFields({fields: {name: "Other form"}}, catalog)).toThrow("does not appear");
		expect(() => convert({"PC Name": ""})).toThrow("no saved character name");
		expect(() => convert({Dex: "99"})).toThrow("Dex score");
	});
	it("parses MPMB data literals but rejects functions, expressions and unsafe keys", () => {
		expect(parseMpmbLiteral("({wizard:{selectSp:['shield',],ability:4,},})")).toEqual({wizard: {selectSp: ["shield"], ability: 4}});
		for (const literal of ["({x:(globalThis.mpmbScriptExecuted=true)})", "({x:function(){}})", "({__proto__:{x:1}})", "({x:{constructor:1}})", "({x:NaN})"]) expect(() => parseMpmbLiteral(literal)).toThrow();
		expect(globalThis.mpmbScriptExecuted).toBeUndefined();
		const draft = convert({"CurrentSpells.Stringified": "({x:eval('attack')})", "P1.SSfront.spells.name.1": "Shield"});
		expect(draft.warnings.join()).toContain("not a plain data object");
		expect(draft.character.spells.map(it => it.uid)).toContain("Shield|PHB");
	});
});

describe("MPMB character conversion using the local dataset", () => {
	it("preserves final scores, HP, state and totals without applying existing bonuses twice", () => {
		const c = convert({"Feat Name 1": "Keen Mind"}).character;
		const d = engine.derive(c);
		expect(d.abilities).toEqual({str: 10, dex: 14, con: 14, int: 18, wis: 12, cha: 10});
		expect({hp: d.hp, current: d.currentHp, ac: d.ac, initiative: d.initiative}).toEqual({hp: 37, current: 29, ac: 15, initiative: 3});
		expect(c.classes[0].improvements[4]).toEqual({mode: "included"});
		expect(c.state).toMatchObject({tempHp: 3, deathSuccess: 1, deathFailure: 1});
		expect(c.currency.gp).toBe(123);
		expect(d.proficiencies.tools["star chart"]).toBe(2);
		expect(engine.toCreature(c).languages).toContain("deep speech");
		c.classes[0].level = 8;
		c.classes[0].improvements[8] = {mode: "asi", abilities: {int: 2}};
		expect(engine.derive(c).abilities.int).toBe(20);
		expect(engine.derive(c).hp).toBe(61);
	});
	it("matches 2024 lineage, background, origin feat and racial spell uses", () => {
		const draft = convert({"Class and Levels": "Rogue (Assassin)", "Character Level": "3", "Class Features": "Rogue (Assassin), level 3: P24 129", Race: ["Tiefling"], "Race Remember": "tiefling-abyssal", "Racial Traits": "Abyssal Tiefling", Background: ["Criminal"], "Feat Name 1": ["Alert [Origin]"], "Feat Note 1": "P24 200", "CurrentSpells.Stringified": "({tiefling:{name:'Abyssal Tiefling',ability:6,selectBo:['thaumaturgy','poison spray','ray of sickness']}})##########({incl:['tiefling']})", "Limited Feature 1": "Ray of Sickness", "Limited Feature Max Usages 1": "1", "Limited Feature Used 1": "1"});
		const c = draft.character;
		const d = engine.derive(c);
		expect(c.rules).toBe("2024");
		expect(c.classes[0].subclass).toBe("Assassin|XPHB|Rogue|XPHB");
		expect(c.background).toBe("Criminal|XPHB");
		expect(c.spellChoices.race.ability).toBe("cha");
		expect(d.origins.filter(it => it.entity.name === "Alert")).toHaveLength(1);
		expect(engine.getSpells(c, d).map(it => it.entity.name).sort()).toEqual(["Poison Spray", "Ray of Sickness", "Thaumaturgy"]);
		const resource = d.resources.find(it => it.name.startsWith("Ray of Sickness"));
		expect(c.state.resources[resource.id]).toBe(1);
	});
	it("matches 2014 species variants using the site's merged species data", () => {
		for (const [name, expected] of [["High Elf", "Elf (High)|PHB"], ["Wood Elf", "Elf (Wood)|PHB"], ["Variant Human", "Human (Variant)|PHB"], ["Hill Dwarf", "Dwarf (Hill)|PHB"]]) {
			const c = convert({Race: [name]}).character;
			expect(c.race).toBe(expected);
			expect(engine.derive(c).abilities).toEqual(c.abilities);
		}
	});
	it("keeps known spells, spellbook entries and printed preparation, and ignores duplicate page slots", () => {
		const c = convert({"CurrentSpells.Stringified": "({wizard:{selectCa:['fire bolt'],selectSp:['shield','mage armor'],selectSpSB:['detect magic'],selectPrep:['shield']}})", "P1.SSfront.spells.name.1": "Shield", "P1.SSfront.spells.remember.1": "shield##checkbox##wizard", "P1.SSfront.spells.checkbox.1": false, "SpellSlots.CheckboxesSet.lvl1": "4", "SpellSlots.Checkboxes.lvl1.top2.1": true, "SpellSlots.Checkboxes.lvl1.top2.2": true, "P1.SSfront.SpellSlots.CheckboxesSet.lvl1": "4", "P1.SSfront.SpellSlots.Checkboxes.lvl1.top2.1": true, "HD1 Die": "6", "HD1 Used": "2"}).character;
		expect(c.spells.map(it => it.uid).sort()).toEqual(["Detect Magic|PHB", "Fire Bolt|PHB", "Mage Armor|PHB", "Shield|PHB"]);
		expect(c.spells.find(it => it.uid === "Shield|PHB").prepared).toBe(false);
		expect(c.spells.find(it => it.uid === "Mage Armor|PHB").prepared).toBe(false);
		expect(c.state.slots[1]).toBe(2);
		expect(c.state.hitDice[c.classes[0].id]).toBe(2);
	});
	it("preserves class ownership for shared spells in multiclass sheets", () => {
		const c = convert({"Class and Levels": "Wizard (Evocation) 3 / Cleric (Life Domain) 2", "Class Features": "", "Character Level": "5", "CurrentSpells.Stringified": "({wizard:{selectSp:['detect magic']},cleric:{selectSp:['detect magic']}})"}).character;
		expect(c.classes.map(it => [it.uid, it.level])).toEqual([["Wizard|PHB", 3], ["Cleric|PHB", 2]]);
		expect(c.spells.filter(it => it.uid === "Detect Magic|PHB")).toHaveLength(2);
		expect(new Set(c.spells.map(it => it.classId)).size).toBe(2);
	});
	it("imports pact slot usage and flags ambiguous mixed slot usage", () => {
		const fields = {"Class and Levels": "Warlock (Fiend) 3", "Class Features": "", "Character Level": "3", "SpellSlots.CheckboxesSet.lvl2": "2", "SpellSlots.Checkboxes.lvl2.top1": true};
		const c = convert(fields).character;
		expect(c.state.pact[c.classes[0].id]).toBe(1);
		const mixed = convert({...fields, "Class and Levels": "Warlock (Fiend) 3 / Wizard (Evocation) 3", "Character Level": "6"});
		expect(mixed.warnings.join()).toContain("cannot be split");
	});
	it("retains unknown multiclass records instead of losing their levels", () => {
		const draft = convert({"Class and Levels": "Fighter (Champion) 3 / Star Weaver (Moon) 2", "Class Features": "", "Character Level": "5"});
		expect(draft.character.classes.map(it => [it.uid, it.level])).toEqual([["Fighter|PHB", 3], ["Star Weaver|MPMB", 2]]);
		expect(draft.character.notes).toContain("subclass: Moon");
		expect(draft.summary.level).toBe(5);
		expect(() => convert({"Class and Levels": "Wizard 0"})).toThrow("could not be determined");
		expect(() => convert({"Class and Levels": "Wizard 20 / Fighter 1"})).toThrow("exceed 20");
	});
	it("matches magic equipment and merges an equipped weapon without multiplying its quantity", () => {
		const c = convert({"Adventuring Gear Row 1": "Dagger", "Adventuring Gear Amount 1": "4", "AC Armor Description": ["Studded Leather +2"], "Attack.1.Weapon Selection": ["Dagger"], "Attack.1.Proficiency": true, "Attack.1.Mod": ["Dex Mod"], "Attack.1.To Hit": "+4", "Attack.1.Damage": "1d4+2", "Attack.1.Damage Type": "Piercing", "Attack.1.Range": "Melee, 20/60 ft"}).character;
		expect(c.inventory.find(it => it.uid === "Dagger|PHB")).toMatchObject({quantity: 4, equipped: true});
		expect(c.inventory.some(it => it.uid === "+2 Studded Leather Armor|DMG")).toBe(true);
		expect(c.inventory).toHaveLength(2);
	});
	it("retains custom equipment and attacks, including spacing variants and attunement", () => {
		const c = convert({"Adventuring Gear Row 1": "Moonblade+2", "Adventuring Gear Amount 1": "1", "Adventuring Gear Weight 1": "2", "Adventuring Gear Row 2": "Lost gem", "Adventuring Gear Amount 2": "0", "Attack.1.Weapon Selection": "Moonblade +2", "Attack.1.To Hit": "+8", "Attack.1.Damage": "1d6+5", "Attack.1.Range": "Melee", "Attack.1.Damage Type": "Slashing", "Extra.Magic Item 1": "Moonblade+2", "Extra.Magic Item Attuned 1": true, "Feat Name 1": "Star Sense", "Feat Description 1": "A campaign boon."}).character;
		expect(c.inventory).toHaveLength(2);
		expect(c.inventory.find(it => it.custom?.name === "Moonblade+2")).toMatchObject({quantity: 1, equipped: true, attuned: true});
		expect(c.inventory.find(it => it.custom?.name === "Lost gem").quantity).toBe(0);
		expect(engine.derive(c).attacks.find(it => it.isImported)).toMatchObject({toHit: 8, damage: "1d6+5"});
		expect(c.customOptions[0]).toMatchObject({kind: "feat", name: "Star Sense", description: "A campaign boon."});
		expect(engine.toCreature(c).trait.some(it => it.name === "Star Sense (Custom)")).toBe(true);
		const json = exportCharacters([c]);
		const validate = new Ajv().compile(readSchema());
		expect(validate(json)).toBe(true);
		const restored = importCharacters(JSON.parse(JSON.stringify(json)))[0];
		expect(restored.id).not.toBe(c.id);
		expect(restored.inventory).toEqual(c.inventory);
		expect(restored.toolTraining).toEqual(c.toolTraining);
		expect(engine.derive(restored).abilities).toEqual(engine.derive(c).abilities);
	});
	it("renders imported text safely and exposes score and equipment review controls", () => {
		const draft = convert({"PC Name": '<img src=x> {@dice 999d99}', "Feat Name 1": "Star Sense", "Adventuring Gear Row 1": '<script>test</script> {@link unsafe|x}'});
		const html = renderMpmbReview(draft);
		expect(html).not.toContain("<img");
		expect(html).not.toContain("<script>");
		const creature = JSON.stringify(engine.toCreature(draft.character));
		expect(creature).not.toContain("{@link unsafe");
		globalThis.VetoolsConfig = {get: () => "classic"};
		try {
			const app = {character: draft.character, derived: engine.derive(draft.character), engine, catalog};
			expect(renderBuild(app)).toContain("Already included in imported scores");
			expect(renderInventory(app)).toContain("Match library item");
			expect(renderInventory(app)).toContain("edit-imported-item");
		} finally { delete globalThis.VetoolsConfig; }
	});
	it("rejects invalid custom equipment and imported training in character JSON", () => {
		const original = exportCharacters([convert({"Adventuring Gear Row 1": "Cometglass Saber", "Attack.1.Weapon Selection": "Cometglass Saber", "Attack.1.To Hit": "+8", "Attack.1.Damage": "1d6+5"}).character]);
		for (const change of [
			c => { c.inventory[0].custom.attack.toHit = "8"; },
			c => { c.inventory[0].custom.attack.damage = "alert(1)"; },
			c => { c.inventory[0].custom.attack.range = "<img src=x>"; },
			c => { c.inventory[0].custom.weight = -1; },
			c => { c.toolTraining["star chart"] = 3; },
			c => { c.abilityChoices.race = {index: 0, bonuses: {}, included: "true"}; },
		]) {
			const json = structuredClone(original); change(json.character[0]);
			expect(() => importCharacters(json)).toThrow();
		}
	});
});

const readSchema = () => JSON.parse(fs.readFileSync("schema/characters.schema.json", "utf8"));
class TestDialog extends EventTarget {
	constructor (options) { super(); this.options = options; this.elements = new Map(); }
	querySelector (selector) { if (!this.elements.has(selector)) this.elements.set(selector, new EventTarget()); return this.elements.get(selector); }
	close () { this.dispatchEvent(new Event("close")); }
}
const makeApp = () => ({catalog, characters: [createCharacter({name: "Existing character"})], dialogs: [], changed: jest.fn(), updateHash: jest.fn(), notify: jest.fn(), dialog (title, body, options) { const dialog = new TestDialog(options); this.dialogs.push(dialog); return dialog; }});

describe("MPMB upload staging (without a browser)", () => {
	const originalWorker = globalThis.Worker;
	beforeEach(() => {
		globalThis.Worker = class {
			postMessage (bytes) { readMpmbPdf(bytes).then(result => { if (!this.terminated) this.onmessage({data: {result}}); }, error => { if (!this.terminated) this.onmessage({data: {error: error.message}}); }); }
			terminate () { this.terminated = true; }
		};
	});
	afterEach(() => { if (originalWorker) globalThis.Worker = originalWorker; else delete globalThis.Worker; });
	it("adds a fresh character only when the user confirms the reviewed draft", async () => {
		const app = makeApp();
		const previous = structuredClone(app.characters[0]);
		await importMpmbFile(app, asFile(await makePdf()));
		expect(app.characters).toEqual([previous]);
		expect(app.pdfImportPending).toBe(true);
		app.dialogs[1].options.onConfirm();
		app.dialogs[1].close();
		expect(app.characters).toHaveLength(2);
		expect(app.characters[0]).toEqual(previous);
		expect(app.selectedId).toBe(app.characters[1].id);
		expect(app.changed).toHaveBeenCalledTimes(1);
		expect(app.pdfImportPending).toBe(false);
	});
	it("cancels a reviewed draft without adding it", async () => {
		const app = makeApp();
		await importMpmbFile(app, asFile(await makePdf()));
		app.dialogs[1].close();
		expect(app.characters).toHaveLength(1);
		expect(app.changed).not.toHaveBeenCalled();
		expect(app.pdfImportPending).toBe(false);
	});
	it("rebuilds source matches before confirmation and bounds file/library sizes", async () => {
		const app = makeApp();
		await expect(importMpmbFile(app, {size: 51 * 1024 * 1024})).rejects.toThrow("50 MiB");
		expect(app.pdfImportPending).toBe(false);
		await importMpmbFile(app, asFile(await makePdf()));
		const dialog = app.dialogs.at(-1);
		const select = dialog.querySelector('[name="mpmb-rules"]');
		select.value = "2024"; select.dispatchEvent(new Event("change"));
		dialog.options.onConfirm(); dialog.close();
		expect(app.characters[1].classes[0].uid).toBe("Wizard|XPHB");
		expect(app.characters[1].rules).toBe("2024");
		app.characters = Array(200).fill(app.characters[0]);
		await expect(importMpmbFile(app, {size: 100})).rejects.toThrow("at most 200");
	});
	it("can cancel while reading and can retry after an invalid upload", async () => {
		const app = makeApp();
		let release;
		const pending = importMpmbFile(app, {name: "slow.pdf", size: 100, arrayBuffer: () => new Promise(resolve => { release = resolve; })});
		app.dialogs[0].close(); release(new ArrayBuffer(100)); await pending;
		expect(app.characters).toHaveLength(1);
		expect(app.pdfImportPending).toBe(false);
		await expect(importMpmbFile(app, asFile(new TextEncoder().encode("invalid")))).rejects.toThrow("not a PDF");
		expect(app.pdfImportPending).toBe(false);
		await importMpmbFile(app, asFile(await makePdf()));
		app.dialogs.at(-1).close();
		expect(app.characters).toHaveLength(1);
	});
});
