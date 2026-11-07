import {CharacterCatalog} from "./character-engine.js";

/** All URLs are resolved by the site's normal loaders against this local clone. */
export async function loadCharacterCatalog () {
	await Promise.all([PrereleaseUtil.pInit(), BrewUtil2.pInit()]);
	await ExcludeUtil.pInitialise();
	const [classes, races, backgrounds, feats, options, items, spells, conditions, languages, brew, prerelease] = await Promise.all([
		DataUtil.class.loadRawJSON(),
		DataUtil.race.loadJSON({isAddBaseRaces: true}),
		DataUtil.background.loadJSON(),
		DataUtil.feat.loadJSON(),
		DataUtil.optionalfeature.loadJSON(),
		DataUtil.item.loadJSON(),
		DataUtil.spell.loadJSON(),
		DataUtil.condition.loadJSON(),
		DataUtil.loadJSON("data/languages.json"),
		BrewUtil2.pGetBrewProcessed(),
		PrereleaseUtil.pGetBrewProcessed(),
	]);
	const data = {...classes, ...races, ...backgrounds, ...feats, ...options, ...items, ...spells, ...conditions, ...languages};
	for (const extra of [prerelease, brew]) {
		for (const prop of ["class", "subclass", "classFeature", "subclassFeature", "background", "feat", "optionalfeature", "spell", "language"]) {
			if (extra?.[prop]?.length) data[prop] = [...data[prop] || [], ...extra[prop]];
		}
	}
	const [brewRaces, preRaces, brewItems, preItems] = await Promise.all([
		DataUtil.race.loadBrew({isAddBaseRaces: true}), DataUtil.race.loadPrerelease({isAddBaseRaces: true}),
		DataUtil.item.loadBrew(), DataUtil.item.loadPrerelease(),
	]);
	data.race.push(...brewRaces?.race || [], ...preRaces?.race || []);
	data.item.push(...brewItems?.item || [], ...preItems?.item || []);
	for (const prop of Object.keys(data)) {
		if (!Array.isArray(data[prop])) continue;
		data[prop].sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.source).localeCompare(String(b.source)));
	}
	return new CharacterCatalog(data);
}
