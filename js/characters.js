import {RenderBestiary} from "./render-bestiary.js";
import {loadCharacterCatalog} from "./characters/character-data.js";
import {CharacterEngine} from "./characters/character-engine.js";
import {ABILITIES, createCharacter, createClass, newId, uid, subclassUid, exportCharacters, importCharacters, escapeHtml as e, signed, clamp, plain, rollDice, createCustomOption, getCustomOptions, customOptionLabel} from "./characters/character-model.js";
import {button, renderEntries, renderBuild, renderInventory, renderJournal} from "./characters/character-builder.js";
import {renderPlay, renderSpells} from "./characters/character-play.js";
import {importMpmbFile} from "./characters/character-import-mpmb-ui.js";

const STORAGE_KEY = "5etools.characters.v1";
const TABS = [["sheet", "Stat block"], ["build", "Build & level up"], ["spells", "Spells"], ["inventory", "Inventory"], ["journal", "Journal"]];

class CharactersPage {
	constructor () {
		this.characters = [];
		this.selectedId = "";
		this.tab = "sheet";
		this.search = "";
		this.rollMode = "normal";
		this.storageConflict = false;
		this.saveError = "";
	}

	get character () { return this.characters.find(it => it.id === this.selectedId); }

	async init () {
		this.root = document.querySelector("#characters-app");
		this.catalog = await loadCharacterCatalog();
		this.engine = new CharacterEngine(this.catalog);
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) this.characters = importCharacters(JSON.parse(raw), {keepIds: true});
		} catch (error) {
			this.saveError = `The saved library could not be loaded: ${error.message} Export the recovery file before resetting storage.`;
			this.storageConflict = true;
		}
		const requested = decodeURIComponent(location.hash.slice(1));
		this.selectedId = this.characters.find(it => it.id === requested)?.id || this.characters[0]?.id || "";
		this.root.addEventListener("click", evt => this.onClick(evt).catch(error => this.notify(error.message, true)));
		this.root.addEventListener("change", evt => { try { this.onChange(evt); } catch (error) { this.notify(error.message, true); } });
		this.root.addEventListener("input", evt => {
			if (evt.target.id === "character-search") { this.search = evt.target.value; this.renderRoster(); }
			else if (evt.target.matches('input[data-field], textarea[data-field], input[type="number"][data-kind]') && (evt.target.type !== "number" || evt.target.value !== "") && !evt.target.validity?.badInput) {
				try { this.onChange(evt); } catch (error) { this.notify(error.message, true); }
			}
		});
		this.root.addEventListener("submit", evt => {
			if (evt.target.id !== "custom-roll") return;
			evt.preventDefault();
			try { this.roll(new FormData(evt.target).get("expression"), "Custom roll"); } catch (error) { this.notify(error.message, true); }
		});
		window.addEventListener("hashchange", () => {
			const id = decodeURIComponent(location.hash.slice(1));
			if (this.characters.some(it => it.id === id)) { this.selectedId = id; this.render(); }
		});
		window.addEventListener("storage", evt => {
			if (evt.key !== STORAGE_KEY) return;
			this.storageConflict = true;
			this.saveError = "This library changed in another tab. Export any unsaved work, then reload to use the latest library.";
			this.render();
		});
		window.addEventListener("beforeunload", evt => { if (this.saveError && this.characters.length) { evt.preventDefault(); evt.returnValue = ""; } });
		this.render();
		window.dispatchEvent(new Event("toolsLoaded"));
	}

	save () {
		if (this.character) this.character.updated = Date.now();
		try {
			if (this.storageConflict) throw new Error(this.saveError || "Reload to resolve the storage conflict.");
			if (this.characters.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(exportCharacters(this.characters)));
			else localStorage.removeItem(STORAGE_KEY);
			this.saveError = "";
		} catch (error) {
			this.saveError = `Not saved: ${error.message} Export JSON to keep your work.`;
			this.notify(this.saveError, true);
		}
	}

	changed ({defer = false} = {}) {
		this.save();
		clearTimeout(this.renderTimer);
		if (defer) this.renderTimer = setTimeout(() => this.render(), 180);
		else this.render();
	}

	notify (message, isError = false) {
		const status = document.querySelector("#characters-status");
		status.textContent = message;
		status.hidden = false;
		status.classList.toggle("chars-toast--error", isError);
		clearTimeout(this.toastTimer);
		this.toastTimer = setTimeout(() => { status.hidden = true; }, isError ? 10000 : 5000);
	}

	log (message) {
		this.character.log.unshift(message);
		this.character.log = this.character.log.slice(0, 80);
		this.notify(message);
		this.changed();
	}

	roll (expression, label) {
		const result = rollDice(expression);
		this.log(`${label}: ${result.total} — ${expression} (${result.detail})`);
		return result;
	}

	rollD20 (bonus, label) {
		const first = rollDice("1d20").total;
		const second = this.rollMode === "normal" ? first : rollDice("1d20").total;
		const die = this.rollMode === "advantage" ? Math.max(first, second) : this.rollMode === "disadvantage" ? Math.min(first, second) : first;
		this.log(`${label}: ${die + bonus} — ${this.rollMode === "normal" ? `d20 ${die}` : `${this.rollMode}: ${first}, ${second}`} ${signed(bonus)}${die === 20 ? " · natural 20" : die === 1 ? " · natural 1" : ""}`);
		return die;
	}

	renderRoster () {
		const list = this.root.querySelector("#character-roster");
		if (!list) return;
		list.innerHTML = this.characters.filter(it => `${it.name} ${it.player}`.toLowerCase().includes(this.search.toLowerCase())).map(character => `<button type="button" class="chars-roster-entry ${character.id === this.selectedId ? "is-active" : ""}" data-action="select" data-id="${e(character.id)}" ${character.id === this.selectedId ? 'aria-current="true"' : ""}><strong>${e(character.name)}</strong><span>${character.classes.length ? character.classes.map(it => `${e(it.uid.split("|")[0])} ${it.level}`).join(" / ") : "Ready to build"}</span></button>`).join("") || '<p class="chars-muted chars-roster-empty">No characters found.</p>';
	}

	render () {
		clearTimeout(this.renderTimer);
		const scroll = this.root.querySelector(".chars-workspace")?.scrollTop || 0;
		const open = [...this.root.querySelectorAll("details")].map(it => it.open);
		const active = document.activeElement;
		const focusAttrs = active && this.root.contains(active) ? ["data-field", "data-kind", "data-key", "data-origin", "data-index", "data-level"].filter(key => active.hasAttribute(key)).map(key => [key, active.getAttribute(key)]) : [];
		this.derived = this.character ? this.engine.derive(this.character) : null;
		const c = this.character;
		const d = this.derived;
		this.root.innerHTML = `<aside class="chars-sidebar" aria-label="Saved characters"><div class="chars-section-title"><h2>Your characters</h2><span class="chars-badge">${this.characters.length}</span></div>${button("new", "+ New character", "", "primary")}<input class="ve-form-control ve-input-xs" id="character-search" type="search" placeholder="Find a character…" aria-label="Find a character" value="${e(this.search)}"><div id="character-roster"></div><div class="chars-sidebar-footer">${button("import", "Import JSON")}${button("import-mpmb", "Import MPMB PDF")}${button("export-all", "Export library", this.characters.length ? "" : "disabled")}<input type="file" id="character-import" accept=".json,application/json" hidden><input type="file" id="character-import-mpmb" accept=".pdf,application/pdf" hidden><p class="chars-muted">Saved in this browser. Export a backup to move your characters or keep them safe.</p><a href="managebrew.html">Manage homebrew sources</a></div></aside>
		<section class="chars-workspace">${this.saveError ? `<div class="chars-banner chars-banner--error" role="alert">${e(this.saveError)} ${button("recovery", "Export recovery file")} ${button("reload", "Reload")}</div>` : ""}
		${c ? `<header class="chars-character-header"><div><p class="chars-eyebrow">${c.rules} rest rules · Level ${d.level || "—"}</p><h2>${e(c.name)}</h2><p class="chars-muted">${e(d.race?.name || "Choose a species")} · ${d.classes.map(it => `${e(it.entity.name)} ${it.row.level}`).join(" / ") || "Choose a class"}</p></div><div class="chars-actions">${button("duplicate", "Duplicate")}${button("export", "Export JSON")}${button("export-creature", "Export creature")}${button("print", "Print")}${button("delete", "Delete", "", "danger")}</div></header>
		<div class="chars-summary"><span><strong>${d.ac}</strong> Armor Class</span><span><strong>${d.currentHp}/${d.hp}</strong> HP</span><span><strong>${signed(d.pb)}</strong> Proficiency</span><span><strong>${signed(d.initiative)}</strong> Initiative</span><span><strong>${d.speed.walk}</strong> ft. speed</span><span class="chars-save-state">${this.saveError ? "Unsaved changes" : "Saved locally"}</span></div>
		<nav class="chars-tabs" aria-label="Character sections">${TABS.map(([id, label]) => `<button class="ve-ui-tab__btn-tab-head ve-btn ve-btn-default ve-pt-2p ve-px-4p ve-pb-0 ${id === this.tab ? "ve-ui-tab__btn-tab-head--active" : ""}" type="button" data-action="tab" data-tab="${id}" ${id === this.tab ? 'aria-current="page"' : ""}>${label}</button>`).join("")}</nav>
		${d.warnings.length ? `<details class="chars-banner"><summary>${d.warnings.length} choice${d.warnings.length === 1 ? "" : "s"} or check${d.warnings.length === 1 ? "" : "s"} to review</summary><ul>${d.warnings.map(it => `<li>${e(it)}</li>`).join("")}</ul></details>` : ""}
		<div class="chars-content ${this.tab === "sheet" ? "chars-content--sheet" : this.tab === "build" ? "chars-content--build" : ""}">${this.tab === "sheet" ? `<div class="chars-statblock-wrap"><table id="character-statblock" class="ve-stats ve-w-100" aria-label="Character bestiary stat block"></table></div>${renderPlay(this)}` : this.tab === "build" ? `${renderBuild(this)}<aside class="chars-preview"><p class="chars-eyebrow">Live stat block</p><table id="character-statblock" class="ve-stats ve-w-100" aria-label="Character bestiary stat block"></table></aside>` : this.tab === "spells" ? renderSpells(this) : this.tab === "inventory" ? renderInventory(this) : renderJournal(this)}</div>` : `<div class="chars-welcome"><h2>Character Sheets</h2><p>Build from the 5etools library, follow your class progression, and bring your attacks, spells, and resources to the table.</p><div class="chars-actions">${button("new", "Create your first character", "", "primary")}${button("import", "Import a character")}${button("import-mpmb", "Import MPMB PDF")}</div><div class="chars-welcome-features"><div><strong>Build & level up</strong><span>Classes, subclasses, species, feats, and features from your library.</span></div><div><strong>Ready to play</strong><span>Calculated attacks, saves, armor, hit points, and spell slots.</span></div><div><strong>Keep your party</strong><span>Multiple characters, local saves, and portable JSON files.</span></div></div></div>`}</section>`;
		this.renderRoster();
		const table = this.root.querySelector("#character-statblock");
		if (table) veE(table).vee.appends(RenderBestiary.getRenderedCreature(this.engine.toCreature(c, d), {isSkipExcludesRender: true, isSkipTokenRender: true, isCharacter: true}));
		this.root.querySelector(".chars-workspace").scrollTop = scroll;
		[...this.root.querySelectorAll("details")].forEach((it, ix) => { if (open[ix] != null) it.open = open[ix]; });
		if (focusAttrs.length) {
			const focus = [...this.root.querySelectorAll("input, select, textarea")].find(el => focusAttrs.every(([key, value]) => el.getAttribute(key) === value));
			focus?.focus({preventScroll: true});
		}
	}

	download (filename, json) {
		const blob = new Blob([JSON.stringify(json, null, "\t")], {type: "application/json"});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${filename.replace(/[^a-z0-9_-]/gi, "-").slice(0, 100)}.json`;
		anchor.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}

	dialog (title, body, {confirm = "", onConfirm = null} = {}) {
		const dialog = document.createElement("dialog");
		dialog.className = "chars-dialog";
		dialog.innerHTML = `<header><h2>${e(title)}</h2><button class="ve-btn ve-btn-default" type="button" data-close aria-label="Close dialog">×</button></header><div class="chars-dialog-body">${body}</div><footer><span class="chars-dialog-error" role="alert"></span><button class="ve-btn ve-btn-default" type="button" data-close>Cancel</button>${confirm ? `<button class="ve-btn ve-btn-primary" type="button" data-confirm>${e(confirm)}</button>` : ""}</footer>`;
		dialog.querySelectorAll("[data-close]").forEach(it => it.addEventListener("click", () => dialog.close()));
		if (onConfirm) dialog.querySelector("[data-confirm]").addEventListener("click", async () => {
			try { if (await onConfirm(dialog) !== false) dialog.close(); } catch (error) { dialog.querySelector(".chars-dialog-error").textContent = error.message; }
		});
		dialog.addEventListener("close", () => dialog.remove(), {once: true});
		document.body.append(dialog);
		dialog.showModal();
		return dialog;
	}

	customOptionDialog (kind, onPick = null, ref = "") {
		const character = this.character;
		const existing = character.customOptions.find(it => `custom:${it.id}` === ref);
		const label = customOptionLabel(kind);
		this.dialog(`${existing ? "Edit" : "Add"} custom ${label}`, `<label class="chars-field"><span>Name</span><input class="ve-form-control ve-input-xs" name="name" value="${e(existing?.name || "")}" maxlength="200" required></label><label class="chars-field"><span>Description / notes (optional)</span><textarea class="ve-form-control ve-input-xs" name="description" rows="4" maxlength="10000">${e(existing?.description || "")}</textarea></label><p class="chars-muted">${["tool", "language"].includes(kind) ? "This fills a proficiency choice, just like a library option." : "This fills the selected feat or feature slot. Apply its special effects using Bonuses & adjustments or resource trackers."} Custom options are saved with this character and included in exports.</p>`, {confirm: existing ? "Save custom option" : `Use custom ${label}`, onConfirm: dialog => {
			const option = createCustomOption({kind, name: dialog.querySelector('[name="name"]').value, description: dialog.querySelector('[name="description"]').value, ...(existing ? {id: existing.id} : {})});
			if (!existing && character.customOptions.length >= 200) throw new Error("This character already has 200 custom options.");
			if (character.customOptions.some(it => it.id !== option.id && it.kind === kind && it.name.toLowerCase() === option.name.toLowerCase())) throw new Error("A custom option with this name already exists. Select it from the choices instead.");
			const entity = getCustomOptions({customOptions: [option]}, kind)[0];
			if (onPick) onPick(entity);
			if (existing) character.customOptions[character.customOptions.indexOf(existing)] = option;
			else character.customOptions.push(option);
			this.changed();
		}});
	}

	pick (prop, title, onPick, {filter = null, caster = null} = {}) {
		let entries = [...this.catalog.list(prop), ...getCustomOptions(this.character, prop)].filter(it => !it._isBaseRace && (!filter || filter(it)));
		const sources = [...new Set(entries.map(it => it.source))].sort();
		let selected = null;
		const dialog = this.dialog(title, `<div class="chars-picker-controls"><input class="ve-form-control ve-input-xs" type="search" placeholder="Search name or source…" aria-label="Search options" data-picker-search><select class="ve-form-control ve-input-xs" aria-label="Source" data-picker-source><option value="">All sources</option>${sources.map(source => `<option value="${e(source)}">${e(source)} — ${e(Parser.sourceJsonToFull(source))}</option>`).join("")}</select>${caster ? '<label class="chars-check"><input type="checkbox" data-picker-all> Show spells outside this class / level</label>' : ""}</div><p class="chars-muted" data-picker-count></p><div class="chars-picker"><div class="chars-picker-list" role="group" aria-label="Library options"></div><div class="chars-picker-detail"><p class="chars-muted">Select an option to read its source text.</p></div></div>`, {confirm: "Choose", onConfirm: () => { if (!selected) throw new Error("Select an option first."); onPick(selected); this.changed(); }});
		const render = () => {
			const search = dialog.querySelector("[data-picker-search]").value.toLowerCase().trim();
			const source = dialog.querySelector("[data-picker-source]").value;
			const all = dialog.querySelector("[data-picker-all]")?.checked;
			const matches = entries.filter(it => (!source || it.source === source) && `${it.name} ${it.source} ${Parser.sourceJsonToFull(it.source)}`.toLowerCase().includes(search) && (!caster || all || (it.level <= caster.maxSpellLevel && this.engine.spellAvailable(it, caster))));
			matches.sort((a, b) => (b.source === (this.character.rules === "2024" ? "XPHB" : "PHB")) - (a.source === (this.character.rules === "2024" ? "XPHB" : "PHB")) || a.name.localeCompare(b.name));
			dialog.querySelector("[data-picker-count]").textContent = `${matches.length} options${matches.length > 120 ? " · showing the first 120; search to narrow the list" : ""}`;
			const visible = matches.slice(0, 120);
			dialog.querySelector(".chars-picker-list").innerHTML = visible.map((it, ix) => `<button type="button" data-pick-index="${ix}" class="${selected === it ? "is-active" : ""}"><strong>${e(it.name)}</strong><small>${e(it.source)}${prop === "spell" ? ` · ${it.level ? `Level ${it.level}` : "Cantrip"}` : ""}</small></button>`).join("") || '<p class="chars-muted">No matching options.</p>';
			dialog.querySelectorAll("[data-pick-index]").forEach(btn => btn.addEventListener("click", () => {
				selected = visible[Number(btn.dataset.pickIndex)];
				dialog.querySelectorAll("[data-pick-index]").forEach(it => it.classList.toggle("is-active", it === btn));
				const prereq = selected.prerequisite ? `<p><strong>Prerequisite:</strong> ${Renderer.utils.prerequisite.getHtml(selected.prerequisite)}</p>` : "";
				const details = prop === "class" ? [{type: "entries", name: "Progression", entries: (selected.classFeatures || []).map(ref => { const feature = this.catalog.feature(ref); return feature ? `Level ${feature.level}: ${feature.name}` : String(ref.classFeature || ref); })}] : this.catalog.resolveEntries(selected.entries || selected._fullEntries || []);
				dialog.querySelector(".chars-picker-detail").innerHTML = `<h3>${e(selected.name)}</h3><p class="chars-muted">${e(Parser.sourceJsonToFull(selected.source))}${selected.page ? ` · p. ${selected.page}` : ""}</p>${prereq}${renderEntries(details)}`;
			}));
		};
		dialog.querySelector("[data-picker-search]").addEventListener("input", render);
		dialog.querySelector("[data-picker-source]").addEventListener("change", render);
		dialog.querySelector("[data-picker-all]")?.addEventListener("change", render);
		if (["feat", "optionalfeature"].includes(prop)) {
			const custom = document.createElement("button");
			custom.type = "button";
			custom.className = "ve-btn ve-btn-default ve-btn-xs";
			custom.textContent = `Type a custom ${customOptionLabel(prop)}…`;
			custom.addEventListener("click", () => { dialog.close(); this.customOptionDialog(prop, onPick); });
			dialog.querySelector("footer").prepend(custom);
		}
		render();
		dialog.querySelector("[data-picker-search]").focus();
	}

	newCharacter () {
		if (this.characters.length >= 200) return this.notify("A library can contain at most 200 characters. Export and remove a character before creating another.", true);
		this.dialog("Create a character", '<label class="chars-field"><span>Character name</span><input class="ve-form-control ve-input-xs" name="name" value="New adventurer" maxlength="200" required></label><label class="chars-field"><span>Rules preference</span><select class="ve-form-control ve-input-xs" name="rules"><option value="2024">2024</option><option value="2014">2014</option></select></label><p class="chars-muted">Both editions remain available in the library. Your preference controls rests and which sources appear first.</p>', {confirm: "Create character", onConfirm: dialog => {
			const name = dialog.querySelector('[name="name"]').value.trim();
			if (!name) throw new Error("Enter a character name.");
			const character = createCharacter({name, rules: dialog.querySelector('[name="rules"]').value});
			this.characters.push(character);
			this.selectedId = character.id;
			this.tab = "build";
			this.changed();
			this.updateHash();
		}});
	}

	updateHash () { history.replaceState(null, "", this.selectedId ? `#${encodeURIComponent(this.selectedId)}` : location.pathname); }

	levelUp (index) {
		const row = this.character.classes[index];
		if (this.derived.level >= 20) return this.notify("The character is already level 20.", true);
		const meta = this.derived.classes.find(it => it.row === row);
		const next = row.level + 1;
		const features = this.engine.getClassFeatures({...meta, row: {...row, level: next}}, {includeFuture: true}).filter(it => it.level === next);
		this.dialog(`${meta.entity.name}: level ${row.level} → ${next}`, `<p>Character level ${this.derived.level + 1}. Features and spell slots update automatically.</p>${features.map(it => `<details class="chars-feature"><summary>${e(it.name)}</summary>${renderEntries(this.catalog.resolveEntries(it.entries))}</details>`).join("") || '<p class="chars-muted">Check the class table for improvements to existing features.</p>'}<label class="chars-field"><span>Hit die result (before Constitution; average by default)</span><input class="ve-form-control ve-input-xs" name="hp" type="number" min="1" max="${meta.entity.hd.faces}" value="${meta.entity.hd.faces / 2 + 1}"></label><p class="chars-muted">Subclass, feat, and ability choices appear in the builder after leveling.</p>`, {confirm: `Advance to level ${next}`, onConfirm: dialog => {
			row.hpRolls[next] = clamp(dialog.querySelector('[name="hp"]').value, 1, meta.entity.hd.faces);
			row.level = next;
			this.tab = "build";
			this.changed();
		}});
	}

	addItem (entity, quantity = 1) {
		const existing = this.character.inventory.find(it => it.uid.toLowerCase() === uid(entity).toLowerCase());
		if (existing) existing.quantity = Math.min(9999, existing.quantity + quantity);
		else this.character.inventory.push({id: newId(), uid: uid(entity), quantity, equipped: !!(entity.dmg1 || entity.ac), attuned: false});
	}

	startingEquipment () {
		const c = this.character;
		if (c.equipmentApplied) return this.notify("Starting equipment was already added. Add or remove individual items in inventory.", true);
		const first = this.derived.classes[0]?.entity;
		const background = this.catalog.get("background", c.background);
		const groups = [...first?.startingEquipment?.defaultData || [], ...background?.startingEquipment || []];
		if (!groups.length) return this.notify("Choose a class and background with starting-equipment data first.", true);
		const choices = groups.map(group => Object.keys(group)[0]);
		const itemLabel = spec => typeof spec === "string" ? spec.split("|")[0] : spec.value ? `${spec.value / 100} gp` : `${spec.quantity || 1} × ${spec.item?.split("|")[0] || spec.special || spec.equipmentType || spec.equipmentTypes?.join(" / ")}`;
		const dialog = this.dialog("Choose starting equipment", `<p>Choose a loadout for ${e(first?.name || "your class")} and ${e(background?.name || "your background")}.</p><div data-equipment-options></div>`, {confirm: "Add equipment", onConfirm: dialog => {
			const pending = [];
			let gold = 0;
			groups.forEach((group, i) => group[choices[i]].forEach((spec, j) => {
				if (spec.value) { gold += spec.value / 100; return; }
				const ref = typeof spec === "string" ? spec : spec.item || dialog.querySelector(`[data-equipment-item="${i}:${j}"]`)?.value;
				const entity = this.catalog.get("item", ref);
				if (!entity) throw new Error(`Choose an item for ${itemLabel(spec)}. Missing items can be added from inventory after loading their source.`);
				pending.push({entity, quantity: spec.quantity || 1});
			}));
			pending.forEach(it => this.addItem(it.entity, it.quantity));
			c.currency.gp += gold;
			c.equipmentApplied = true;
			this.changed();
		}});
		const render = () => {
			dialog.querySelector("[data-equipment-options]").innerHTML = groups.map((group, i) => `<section class="chars-origin"><label class="chars-field"><span>Equipment choice ${i + 1}</span><select class="ve-form-control ve-input-xs" data-equipment-group="${i}">${Object.entries(group).map(([key, items]) => `<option value="${key}" ${key === choices[i] ? "selected" : ""}>${key === "_" ? "Included" : key}: ${e(items.map(itemLabel).join(", "))}</option>`).join("")}</select></label>${group[choices[i]].map((spec, j) => {
				if (typeof spec === "string" || spec.item || spec.value) return `<p>${e(itemLabel(spec))}</p>`;
				const types = spec.equipmentTypes || [spec.equipmentType || ""];
				const items = this.catalog.list("item").filter(it => it.source === (first?.source === "XPHB" ? "XPHB" : "PHB") && types.some(type => {
					if (type === "weaponSimple") return it.weaponCategory === "simple";
					if (type === "weaponMartial") return it.weaponCategory === "martial";
					if (type === "weaponSimpleMelee") return it.weaponCategory === "simple" && it.type?.split("|")[0] === "M";
					if (type === "weaponMartialMelee") return it.weaponCategory === "martial" && it.type?.split("|")[0] === "M";
					if (type === "instrumentMusical") return it.type?.split("|")[0] === "INS";
					if (type === "toolArtisan") return it.type?.split("|")[0] === "AT";
					if (type === "setGaming") return it.type?.split("|")[0] === "GS";
					if (type.startsWith("focusSpellcasting")) return it.type?.split("|")[0] === "SCF" && it.scfType === {focusSpellcastingArcane: "arcane", focusSpellcastingDruidic: "druid", focusSpellcastingHoly: "holy"}[type];
					return spec.special ? it.name.toLowerCase().includes(spec.special.toLowerCase()) : true;
				}));
				return `<label class="chars-field"><span>${e(itemLabel(spec))}</span><select class="ve-form-control ve-input-xs" data-equipment-item="${i}:${j}"><option value="">Choose…</option>${items.map(it => `<option value="${e(uid(it))}">${e(it.name)}</option>`).join("")}</select></label>`;
			}).join("")}</section>`).join("");
			dialog.querySelectorAll("[data-equipment-group]").forEach(el => el.addEventListener("change", () => { choices[Number(el.dataset.equipmentGroup)] = el.value; render(); }));
		};
		render();
	}

	async onClick (event) {
		const target = event.target.closest("[data-action]");
		if (!target || target.disabled) return;
		clearTimeout(this.renderTimer);
		const {action, id, ref, key, name} = target.dataset;
		const ix = Number(target.dataset.index);
		const level = Number(target.dataset.level);
		const c = this.character;
		const d = this.derived;
		if (action === "new") return this.newCharacter();
		if (action === "import") return this.root.querySelector("#character-import").click();
		if (action === "import-mpmb") return this.root.querySelector("#character-import-mpmb").click();
		if (action === "export-all") return this.download("character-library", exportCharacters(this.characters));
		if (action === "recovery") return this.download("character-library-recovery", {saved: localStorage.getItem(STORAGE_KEY), current: exportCharacters(this.characters)});
		if (action === "reload") return location.reload();
		if (action === "select") { this.selectedId = id; this.render(); this.updateHash(); return; }
		if (!c) return;
		if (action === "tab") { this.tab = target.dataset.tab; this.render(); return; }
		if (action === "export") return this.download(c.name, exportCharacters([c]));
		if (action === "export-creature") {
			const json = exportCharacters([c]);
			return this.download(`${c.name}-bestiary`, {_meta: json._meta, monster: [this.engine.toCreature(c)]});
		}
		if (action === "print") { this.tab = "sheet"; this.render(); window.print(); return; }
		if (action === "duplicate") { if (this.characters.length >= 200) throw new Error("The library already contains 200 characters."); const duplicate = structuredClone(c); duplicate.id = newId(); duplicate.name = `${duplicate.name.slice(0, 193)} (copy)`; this.characters.push(duplicate); this.selectedId = duplicate.id; this.changed(); this.updateHash(); return; }
		if (action === "delete") return this.dialog(`Delete ${c.name}?`, "<p>This removes the character from this browser. Export a backup first if you want to keep it.</p>", {confirm: "Delete character", onConfirm: () => { this.characters = this.characters.filter(it => it !== c); this.selectedId = this.characters[0]?.id || ""; this.changed(); this.updateHash(); }});
		if (action === "pick-class") return this.pick("class", "Choose a class", entity => {
			if (c.classes.some(it => it.uid.split("|")[0].toLowerCase() === entity.name.toLowerCase())) throw new Error("This character already has that class. Increase its level instead.");
			if (d.level >= 20) throw new Error("Total character level cannot exceed 20.");
			c.classes.push(createClass(entity));
		});
		if (action === "pick-race" || action === "pick-background") return this.pick(action.slice(5), action === "pick-race" ? "Choose a species" : "Choose a background", entity => {
			const origin = action.slice(5);
			if (c[origin] === uid(entity)) return;
			c[origin] = uid(entity);
			for (const map of ["abilityChoices", "skillChoices", "spellChoices"]) delete c[map][origin];
			for (const map of ["proficiencyChoices", "proficiencyPatterns", "defenseChoices"]) for (const key of Object.keys(c[map])) if (key.startsWith(`${origin}:`)) delete c[map][key];
			if (origin === "race") c.size = "";
		});
		if (action === "pick-feat") return this.pick("feat", "Choose a feat", entity => { if (!c.feats.includes(uid(entity))) c.feats.push(uid(entity)); });
		if (action === "pick-optional") return this.pick("optionalfeature", "Choose an optional feature", entity => { if (!c.optionalFeatures.includes(uid(entity))) c.optionalFeatures.push(uid(entity)); });
		if (action === "pick-improvement") return this.pick("feat", `Choose a level ${level} feat`, entity => { c.classes[ix].improvements[level] = {mode: "feat", feat: uid(entity)}; });
		if (action === "configure-ability") { delete c.abilityChoices[key]; this.changed(); return; }
		if (action === "edit-custom") {
			const option = c.customOptions.find(it => `custom:${it.id}` === ref);
			if (option) return this.customOptionDialog(option.kind, null, ref);
			return;
		}
		if (action === "custom-proficiency") {
			const group = d.proficiencies.groups.find(it => it.key === key);
			const kind = target.dataset.kind;
			if (!group?.customKinds.includes(kind)) return;
			return this.customOptionDialog(kind, entity => {
				const selected = [...new Set(c.proficiencyChoices[key] ?? group.selected)];
				if (selected.length >= group.count) throw new Error("Clear a selection before adding a custom proficiency.");
				if (group.options.some(it => it.kind === kind && it.key === entity.name.toLowerCase() && (it.isEligible === false || selected.includes(it.id)))) throw new Error("That proficiency is already assigned. Enter a different name.");
				c.proficiencyChoices[key] = [...selected, uid(entity)];
			});
		}
		if (action === "pick-progression" || action === "remove-progression") {
			const meta = d.classes.find(it => it.row === c.classes[ix]);
			const group = this.engine.getProgressionChoices(meta, c).find(it => it.key === key);
			const slot = Number(target.dataset.slot);
			if (!group || slot < 0 || slot >= group.count - group.required.length) return;
			const choices = (meta.row.options ||= {})[key] ||= [];
			while (choices.length <= slot) choices.push("");
			if (action === "remove-progression") { choices[slot] = ""; this.changed(); return; }
			const assigned = new Set(d.classes.flatMap(owner => this.engine.getProgressionChoices(owner, c).filter(it => it.prop === group.prop).flatMap(it => [...it.required, ...it.selected.filter((ref, index) => owner.row !== meta.row || it.key !== key || index !== slot)])).filter(Boolean).map(it => it.toLowerCase()));
			return this.pick(group.prop, `Choose ${group.name.toLowerCase()}`, entity => {
				choices[slot] = uid(entity);
				const extras = group.prop === "feat" ? "feats" : "optionalFeatures";
				c[extras] = c[extras].filter(ref => ref.toLowerCase() !== uid(entity).toLowerCase());
			}, {filter: entity => group.available.some(it => uid(it).toLowerCase() === uid(entity).toLowerCase()) && !assigned.has(uid(entity).toLowerCase())});
		}
		if (action === "remove-feat") c.feats = c.feats.filter(it => it.toLowerCase() !== ref.toLowerCase());
		if (action === "remove-optional") c.optionalFeatures = c.optionalFeatures.filter(it => it !== ref);
		if (action === "remove-class") return this.dialog("Remove class?", "<p>Its levels and features stop contributing. Spells assigned to this class will also be removed.</p>", {confirm: "Remove class", onConfirm: () => { const [row] = c.classes.splice(ix, 1); c.spells = c.spells.filter(it => it.classId !== row.id); this.changed(); }});
		if (action === "level-up") return this.levelUp(ix);
		if (action === "assign-abilities") {
			const scores = c.abilityMethod === "rolled" ? ABILITIES.map(() => { const rolls = Array.from({length: 4}, () => rollDice("1d6").total).sort((a, b) => b - a); return rolls.slice(0, 3).reduce((a, b) => a + b, 0); }) : c.abilityMethod === "pointbuy" ? [8, 8, 8, 8, 8, 8] : [15, 14, 13, 12, 10, 8];
			ABILITIES.forEach((key, i) => { c.abilities[key] = scores[i]; });
			this.notify(`Base scores: ${scores.join(", ")}. Rearrange them for your character.`);
		}
		if (action === "pick-item") return this.pick("item", "Add equipment", entity => this.addItem(entity));
		if (action === "starting-equipment") return this.startingEquipment();
		if (action === "item-detail") { const entity = this.engine.getItem(c.inventory[ix]); return this.dialog(entity?.name || "Missing item", renderEntries(entity?._fullEntries || entity?.entries)); }
		if (action === "edit-imported-item") {
			const item = c.inventory[ix]?.custom;
			if (!item) return;
			const field = (key, label, value, type = "text") => `<label class="chars-field"><span>${e(label)}</span><input class="ve-form-control ve-input-xs" name="${key}" type="${type}" value="${e(value)}"></label>`;
			return this.dialog("Edit imported item", `${field("name", "Name", item.name)}${field("weight", "Weight (lb.)", item.weight, "number")}<label class="chars-field"><span>Description / notes</span><textarea class="ve-form-control ve-input-xs" name="description" rows="4">${e(item.description)}</textarea></label>${item.attack ? `<h3>Imported attack</h3><p class="chars-muted">These values are entered manually. Match a library item to use its automatic calculations.</p><div class="chars-grid">${field("toHit", "Attack bonus", item.attack.toHit, "number")}${field("damage", "Damage dice", item.attack.damage)}${field("damageType", "Damage type", item.attack.damageType)}${field("range", "Range", item.attack.range)}${field("reach", "Reach", item.attack.reach)}</div>` : ""}`, {confirm: "Save item", onConfirm: dialog => {
				const get = key => dialog.querySelector(`[name="${key}"]`).value.trim();
				const custom = {...item, name: get("name"), description: get("description"), weight: Number(get("weight"))};
				if (item.attack) { custom.attack = {...item.attack, toHit: Number(get("toHit")), damage: get("damage"), damageType: get("damageType"), range: get("range"), reach: get("reach")}; rollDice(custom.attack.damage, () => 0.5); }
				const validated = importCharacters(exportCharacters([{...c, inventory: c.inventory.map((row, index) => index === ix ? {...row, custom} : row)}]), {keepIds: true})[0];
				c.inventory[ix].custom = validated.inventory[ix].custom;
				this.changed();
			}});
		}
		if (action === "match-item") return this.pick("item", "Match imported equipment", entity => { c.inventory[ix].uid = uid(entity); delete c.inventory[ix].custom; });
		if (action === "remove-item") c.inventory.splice(ix, 1);
		if (action === "pick-spell") {
			const open = caster => this.pick("spell", `Add a ${caster.entity.name} spell`, entity => { if (!c.spells.some(it => it.uid === uid(entity) && it.classId === caster.row.id)) c.spells.push({uid: uid(entity), classId: caster.row.id, prepared: true}); }, {caster});
			if (d.casting.casters.length === 1) return open(d.casting.casters[0]);
			return this.dialog("Choose a spellcasting class", `<label class="chars-field"><span>Spellcasting class</span><select class="ve-form-control ve-input-xs">${d.casting.casters.map(it => `<option value="${it.row.id}">${e(it.entity.name)}</option>`).join("")}</select></label>`, {confirm: "Continue", onConfirm: dialog => { const caster = d.casting.casters.find(it => it.row.id === dialog.querySelector("select").value); dialog.close(); open(caster); }});
		}
		if (action === "pick-granted-spell") {
			const {origin, path} = target.dataset;
			const choice = this.engine.getGrantedSpellData(c, d).choices.find(it => it.source.key === origin && it.path === path);
			return this.pick("spell", `Choose a ${choice.source.entity.name} spell`, entity => {
				const saved = c.spellChoices[origin] ||= structuredClone(choice.source.saved);
				(saved.chosen[path] ||= Array(choice.count).fill(""))[ix] = uid(entity);
			}, {filter: entity => this.engine.matchesSpellFilter(entity, choice.filter) && (!choice.from || choice.from.some(it => (it.includes("|") ? it : `${it}|PHB`).toLowerCase() === uid(entity).toLowerCase()))});
		}
		if (action === "remove-spell") { const row = this.engine.getSpells(c, d)[ix]?.row; c.spells = c.spells.filter(it => it !== row); }
		if (action === "cast" || action === "cast-ritual") {
			const slot = this.root.querySelector(`[data-slot-for="${ix}"]`)?.value;
			return this.log(this.engine.cast(c, this.engine.getSpells(c, d)[ix].row, slot, {ritual: action === "cast-ritual"}));
		}
		if (action === "spell-attack") { const spell = this.engine.getSpells(c, d)[ix]; return this.rollD20(spell.caster.attack, spell.entity.name); }
		if (action === "spell-damage") {
			const spell = this.engine.getSpells(c, d)[ix];
			const slot = this.root.querySelector(`[data-slot-for="${ix}"]`)?.value;
			const castLevel = c.state.lastSpellLevels[`${spell.row.classId}:${uid(spell.entity)}`] ?? (slot === "innate" ? spell.row.innate.level : slot?.startsWith("pact:") ? d.casting.casters.find(it => `pact:${it.row.id}` === slot).pact.level : Number(slot) || spell.entity.level);
			const roll = this.engine.getSpellRolls(spell.entity, d.level, castLevel, d.mods[spell.caster?.ability] || 0)[Number(target.dataset.roll)];
			return this.roll(roll.dice, `${spell.entity.name} roll${castLevel ? ` (level ${castLevel})` : ""}`);
		}
		if (action === "end-concentration") c.state.concentration = "";
		if (action === "slot-spend") c.state.slots[level] = Math.min(d.casting.slots[level - 1], (c.state.slots[level] || 0) + 1);
		if (action === "slot-restore") c.state.slots[level] = Math.max(0, (c.state.slots[level] || 0) - 1);
		if (action === "pact-spend") c.state.pact[id] = Math.min(d.casting.casters.find(it => it.row.id === id).pact.max, (c.state.pact[id] || 0) + 1);
		if (action === "pact-restore") c.state.pact[id] = Math.max(0, (c.state.pact[id] || 0) - 1);
		if (action === "damage" || action === "heal") { const amount = clamp(this.root.querySelector("#hp-amount").value, 0, 9999); this.engine.changeHp(c, amount * (action === "damage" ? 1 : -1)); return this.log(`${action === "damage" ? "Damage taken" : "Healing"}: ${amount}${action === "damage" && c.state.concentration ? `. Check concentration: CON save DC ${Math.max(10, Math.floor(amount / 2))}.` : ""}`); }
		if (action.startsWith("rest-")) return this.dialog(action === "rest-long" ? "Take a long rest?" : "Take a short rest?", `<p>${action === "rest-long" ? "Recover HP, spell slots, eligible resources, and hit dice using your selected rest rules. Reduce exhaustion by one. Conditions remain until you remove them." : "Recover pact slots and eligible resources. Spend hit dice separately to recover HP."}</p>`, {confirm: "Finish rest", onConfirm: () => { this.engine.rest(c, action.slice(5)); this.log(`${action === "rest-long" ? "Long" : "Short"} rest completed.`); }});
		if (action === "hit-die") return this.log(`Spent a hit die: recovered ${this.engine.spendHitDie(c, id)} HP.`);
		if (action === "initiative") return this.rollD20(d.initiative, "Initiative");
		if (action === "feature-roll") return this.roll(target.dataset.dice, name);
		if (action === "skill-roll") return this.rollD20(d.skillBonuses[key], key);
		if (action === "save-roll") return this.rollD20(d.saves[key], `${key.toUpperCase()} saving throw`);
		if (action === "tool-roll") return this.rollD20(d.mods[this.toolAbility || "int"] + d.pb * d.proficiencies.tools[key], `${key} (${(this.toolAbility || "int").toUpperCase()})`);
		if (action === "clear-proficiency") c.proficiencyChoices[key] = [];
		if (["attack", "damage-roll", "critical-roll"].includes(action)) {
			const attack = d.attacks.find(it => it.id === id);
			if (action === "attack") return this.rollD20(attack.toHit, `${attack.name} attack`);
			const dice = action === "critical-roll" ? attack.damage.replace(/(\d*)d(\d+)/g, (m, count, sides) => `${Number(count || 1) * 2}d${sides}`) : attack.damage;
			return this.roll(dice, `${attack.name} ${action === "critical-roll" ? "critical " : ""}damage`);
		}
		if (action === "death-save") {
			const die = rollDice("1d20").total;
			if (die === 20) this.engine.changeHp(c, -1);
			else if (die >= 10) c.state.deathSuccess = Math.min(3, c.state.deathSuccess + 1);
			else c.state.deathFailure = Math.min(3, c.state.deathFailure + (die === 1 ? 2 : 1));
			return this.log(`Death save: ${die}${die === 20 ? " — recover 1 HP" : die >= 10 ? " — success" : die === 1 ? " — two failures" : " — failure"}.`);
		}
		if (action === "add-resource") return this.dialog("Add a resource tracker", '<label class="chars-field"><span>Name</span><input class="ve-form-control ve-input-xs" name="name" required></label><label class="chars-field"><span>Maximum uses</span><input class="ve-form-control ve-input-xs" type="number" name="max" min="1" max="10000" value="1"></label><label class="chars-field"><span>Recovery</span><select class="ve-form-control ve-input-xs" name="recovery"><option value="long">Long rest</option><option value="short">Short or long rest</option><option value="manual">Manual</option></select></label>', {confirm: "Add tracker", onConfirm: dialog => { const name = dialog.querySelector('[name="name"]').value.trim(); if (!name) throw new Error("Enter a resource name."); c.resources.push({id: newId(), name, max: clamp(dialog.querySelector('[name="max"]').value, 1, 10000), recovery: dialog.querySelector('[name="recovery"]').value}); this.changed(); }});
		if (action === "remove-resource") c.resources = c.resources.filter(it => it.id !== id);
		if (action === "resource-spend") {
			const resource = d.resources.find(it => it.id === id);
			if (resource.used >= resource.max) throw new Error("This resource has no remaining uses.");
			c.state.resources[id] = resource.used + 1;
			if (resource.healing) { const amount = rollDice(resource.healing).total; this.engine.changeHp(c, -amount); return this.log(`${resource.name}: recovered ${amount} HP (${resource.healing}).`); }
		}
		if (action === "resource-restore") c.state.resources[id] = Math.max(0, (c.state.resources[id] || 0) - 1);
		if (action === "remove-condition") c.state.conditions = c.state.conditions.filter(it => it !== name);
		if (action === "clear-log") c.log = [];
		this.changed();
	}

	onChange (event) {
		const target = event.target;
		if (target.id === "character-import-mpmb") {
			const file = target.files[0];
			target.value = "";
			if (file) importMpmbFile(this, file).catch(error => this.notify(`MPMB import failed: ${error.message}`, true));
			return;
		}
		if (target.id === "character-import") {
			const file = target.files[0];
			if (!file) return;
			if (file.size > 10 * 1024 * 1024) return this.notify("Character files must be smaller than 10 MB.", true);
			file.text().then(text => {
				const characters = importCharacters(JSON.parse(text));
				if (this.characters.length + characters.length > 200) throw new Error("A library can contain at most 200 characters.");
				this.characters.push(...characters);
				this.selectedId = characters[0].id;
				this.changed();
				this.updateHash();
				this.notify(`Imported ${characters.length} character${characters.length === 1 ? "" : "s"}. Existing characters were kept.`);
			}).catch(error => this.notify(`Import failed: ${error.message}`, true));
			return;
		}
		if (target.id === "roll-mode") { this.rollMode = target.value; return; }
		if (target.id === "tool-ability") { this.toolAbility = target.value; this.render(); return; }
		const c = this.character;
		if (!c) return;
		const {field, kind, key, origin} = target.dataset;
		const ix = Number(target.dataset.index);
		const level = Number(target.dataset.level);
		const value = target.type === "checkbox" ? target.checked : target.type === "number" ? Math.trunc(clamp(target.value, target.min === "" ? -100000 : Number(target.min), target.max === "" ? 100000 : Number(target.max))) : target.value;
		if (field) {
			const path = field.split(".");
			const dest = path.length === 1 ? c : c[path[0]];
			if (!dest || ["__proto__", "prototype", "constructor"].includes(path.at(-1))) return;
			if (field === "name" && !String(value).trim()) { target.value = c.name; return; }
			dest[path.at(-1)] = field === "name" ? String(value).slice(0, 200) : value;
		} else if (kind === "class-level") {
			c.classes[ix].level = clamp(value, 1, 20 - this.derived.level + c.classes[ix].level);
		} else if (kind === "subclass") c.classes[ix].subclass = value;
		else if (kind === "hp-roll") c.classes[ix].hpRolls[level] = value;
		else if (kind === "ability-pattern") c.abilityChoices[origin] = {index: Number(value), bonuses: {}};
		else if (kind === "ability-bonus") { (c.abilityChoices[origin] ||= {index: 0, bonuses: {}}).bonuses[key] = value; }
		else if (kind === "skill-choice") { const choices = new Set(c.skillChoices[origin] || []); target.checked ? choices.add(target.value) : choices.delete(target.value); c.skillChoices[origin] = [...choices]; }
		else if (kind === "proficiency-pattern") c.proficiencyPatterns[origin] = Number(value);
		else if (kind === "proficiency-choice") { const choices = new Set(c.proficiencyChoices[origin] ?? this.derived.proficiencies.groups.find(it => it.key === origin)?.selected ?? []); target.checked ? choices.add(target.value) : choices.delete(target.value); c.proficiencyChoices[origin] = [...choices]; }
		else if (kind === "feature-choice") { const choices = new Set(c.featureChoices[origin] || []); target.checked ? choices.add(target.value) : choices.delete(target.value); c.featureChoices[origin] = [...choices]; }
		else if (kind === "defense-choice") { const choices = new Set(c.defenseChoices[origin] || []); target.checked ? choices.add(target.value) : choices.delete(target.value); c.defenseChoices[origin] = [...choices]; }
		else if (kind === "improvement-mode") c.classes[ix].improvements[level] = value === "asi" ? {mode: "asi", abilities: {}} : {mode: "feat", feat: ""};
		else if (kind === "improvement-ability") { const choice = c.classes[ix].improvements[level] ||= {mode: "asi", abilities: {}}; choice.abilities[key] = value; }
		else if (kind === "skill-override") { if (value === "") delete c.skills[key]; else c.skills[key] = Number(value); }
		else if (kind === "save-override") { if (value === "") delete c.saves[key]; else c.saves[key] = value === "yes"; }
		else if (kind === "armor-override") { if (value === "") delete c.armorTraining[key]; else c.armorTraining[key] = value === "yes"; }
		else if (kind === "tool-training") { if (value === "") delete c.toolTraining[key]; else c.toolTraining[key] = Number(value); }
		else if (kind?.startsWith("item-")) c.inventory[ix][{quantity: "quantity", equipped: "equipped", attuned: "attuned", proficient: "proficient", twohanded: "twoHanded"}[kind.slice(5)]] = value;
		else if (kind === "spell-prepared") this.engine.getSpells(c, this.derived)[ix].row.prepared = value;
		else if (kind === "spell-ritual") this.engine.getSpells(c, this.derived)[ix].row.ritualAllowed = value;
		else if (kind === "spell-origin-group") c.spellChoices[origin] = {index: Number(value), ability: "", chosen: {}};
		else if (kind === "spell-origin-ability") { (c.spellChoices[origin] ||= structuredClone(this.derived.spellSources.find(it => it.key === origin).saved)).ability = value; }
		else if (kind === "condition") { if (value && !c.state.conditions.includes(value)) c.state.conditions.push(value); }
		else return;
		this.changed({defer: event.type === "input" && target.type !== "number"});
	}
}

window.addEventListener("load", () => {
	const page = new CharactersPage();
	page.init().catch(error => {
		document.querySelector("#characters-app").innerHTML = `<div class="chars-loading" role="alert"><h2>Character options could not be loaded</h2><p>${e(error.message)}</p><p>Keep the local server running and reload this page to retry.</p><button class="ve-btn ve-btn-primary" type="button" onclick="location.reload()">Reload</button></div>`;
		console.error(error);
	});
});
