# Character sheets

Open **Player → Character Sheets**, or `characters.html`, in this clone. Start a local server with `npm run serve:dev` (port 5050). The home page also links to the character sheets page.

The page uses 5etools' shared light/night Sass palette, compact buttons and form controls, native stat tabs, container width, selected-list treatment, and bestiary renderer. Site theme and wide-mode settings continue to apply.

## Building and playing

1. Create a character and select a species, background, and class. Search pickers include the source abbreviation and source text. Both 2014 and 2024 content are available; class progression follows the selected source. The rules preference controls hit-die recovery and source ordering.
2. Assign base scores using a standard array, point buy, rolls, or manual entry. Make ability choices under **Origin & proficiency choices**, then complete **Proficiencies & expertise**. Skill, tool, language, weapon, armor, mixed choices, and alternative proficiency sets use the local data. Fixed grants are applied automatically. Expertise choices appear as their class features unlock, and 2024 characters receive Common plus two language choices from the local standard-language table.
3. Advance class levels with **Level up**, or edit the class level. Subclasses unlock at the level specified by the class data. Ability score improvements and feats belong to their class level, so reducing a level deactivates them without deleting the choices. Add another class for multiclassing.
4. Choose embedded class options, feats, and optional features. Class and subclass progression data provide the appropriate number of fighting styles, invocations, metamagic options, maneuvers, and other selections at the current level. Required grants are included automatically; reducing a level deactivates later choices without deleting them. The review panel flags pending choices, multiclass ability prerequisites, missing sources, and spell limits. Restrictions described only in source prose still need review.
5. Choose starting equipment or add items from the item library. Quantity, equipped state, attunement, weapon proficiency, and versatile use are editable. Starting equipment can be applied once per character; later purchases and replacements use the inventory controls.
6. Add spells to the appropriate class. Subclass and origin grants appear automatically at their unlock level. Some origins require a spell variant, casting ability, or spell choice on the Spells tab. Cast spends a selected regular, pact, or granted-use resource. Cantrips do not spend slots. Ritual casting checks core class/feat permissions and preparation, adds 10 minutes, and spends no slot. Ritual-only grants cannot be cast normally. Prepared status, concentration, spell attacks, DCs, and damage/healing dice are available here.
7. Use **Stat block** during play. It uses the same bestiary renderer and the current site style. Play controls handle HP, temporary HP, death saves, initiative, attacks, skills, saves, tool checks, spell slots, hit dice, limited resources, conditions, inspiration, and rests. Tool checks let you select the relevant ability and apply proficiency or expertise. Second Wind also rolls and applies healing. Notes and personality fields live in Journal.

Dice results appear in the character's roll log. Advantage/disadvantage applies to the play controls' d20 rolls. Critical weapon damage doubles dice, not the flat modifier. Structured cantrip and spell-slot scaling uses local spell data. Spell damage/healing rolls remember the most recent cast level, including when that cast spent the last slot of its level.

For campaign-specific choices, use **+ Custom language** or **+ Custom tool** under an open proficiency choice, or **Type a custom feat/feature…** in a feat or class-option picker. Enter a name and optional description; the option fills the same slot as a library choice. Custom tools receive proficiency on tool checks. Selected custom options have an **Edit** button, and saved options can be selected again from that character's choices. Deselect a proficiency checkbox or use **Clear choices** to free its slot. Level-up feats and class options retain their level gates. Custom feat/feature descriptions are recorded as text; apply mechanical effects through **Bonuses & adjustments** or resource trackers. Naming a custom option after a published feat does not copy that feat's rules.

## Automation boundaries

The JSON library contains both structured rules and prose. The sheet calculates level/proficiency, abilities, skills/saves, HP, equipment AC, common unarmored defenses, weapon attack/damage, carrying capacity, spell preparation/known limits, multiclass slots, pact magic, and common class resources. Class feature selection counts, required selections, and level prerequisites use the structured progression data. Multiclass calculations retain the different half-caster rounding for 2014 and 2024 classes. Structured proficiency grants apply automatically, including species and feat weapon training and the 2024 finesse/light weapon filters. Casting checks training with equipped armor and shields. Standard feature effects such as Tough, Defense, Archery, Dueling, Alert, monk martial arts, and unarmored movement have explicit handling. Source-scoped adapters also handle core Rogue/Bard/Ranger expertise, Scholar, Tool Expertise, Divine/Primal Order training, several subclass proficiency grants, Ritual Caster, and Book of Ancient Secrets.

The sheet is not a combat adjudicator or a complete port of the PDF's JavaScript. It does not choose targets, decide hits, apply enemy resistance, enforce action economy, or execute arbitrary feature text. Situational bonuses, exceptional subclass effects, weapon mastery decisions, unrecognized prose-only proficiency grants, spell components, non-level feature prerequisites, and special casting benefits such as Quick Ritual need the player to consult the displayed source. Use **Bonuses & adjustments**, skill/save/armor-training overrides, custom resource trackers, inventory, and the dice box for those cases. A learned ritual spell's description includes an explicit ritual-permission override for additional features or rulings. Conditions and exhaustion are tracked with reminders; their situational roll penalties are not silently applied. Rest buttons assume the character is eligible to finish that rest.

## Importing an MPMB character

Choose **Import MPMB PDF** in the character sidebar or welcome screen, then select the original, saved, fillable MorePurpleMoreBetter character PDF. Review the detected character and library matches, choose **2014** or **2024** source matching if needed, and select **Import character**. Cancel leaves the library unchanged. Import creates a new character; it never replaces an existing sheet.

The importer reads saved form fields for identity, class levels and subclasses, species, background, ability scores, proficiency/expertise, languages, tools, feats, equipment, currency, HP, death saves, spell selections/preparation, slot usage, hit dice, limited resources, and notes. It matches names against this clone's loaded 5etools catalog, including installed homebrew. Known equipment and spells use the normal character calculations. The PDF stays on this device; a local Web Worker reads its form data. Neither embedded PDF JavaScript nor imported MPMB scripts are executed.

The review screen lists source matches and details needing attention. Unmatched feats become character-local custom feats. Unmatched equipment stays in inventory, with its name, weight and description; printed weapon attack/damage values are retained when readable. Use **Edit** to change imported item details or attack values, or **Match library item** to use a library item's automatic rules. Unrecognized class/species/background references and spell/feature details are retained with review notes. Original class and species descriptions, attack details, equipment notes, and import warnings are available in Journal. Resolve unresolved source and progression choices in the normal builder and Spells tab.

Saved PDF scores are treated as final scores: existing origin and feat ability increases and prior ASIs are marked as already included. New level-ups still add their new improvements. Acquisition levels for old feats and feature choices cannot reliably be recovered from the current PDF state. Review these before changing an origin or reducing previously imported levels. Imported proficiencies use normal choices where identifiable and overrides where needed. Differences between the PDF's HP, AC, initiative or speed and the local calculation become visible **Bonuses & adjustments**; review these after changing equipment or ongoing effects. Custom attacks keep manual values until edited or matched to an item. Mixed regular/Pact Magic slot usage is flagged when it cannot be assigned reliably.

Supported uploads are unencrypted AcroForm PDFs up to 50 MiB, 300 pages, 20,000 fields and 8 MiB of field text. Scans, printed/flattened PDFs without form fields, and XFA forms cannot be imported. Save changed fields in a compatible PDF editor before uploading. Other MPMB versions or custom scripts may use fields the importer cannot map; the review identifies recognized but unmatched data, and this is not a migration of the PDF's script engine. Keep the original PDF as a backup. No personal data from the reference sheet is included in the application or test fixtures.

## Storage and portable JSON

Characters are saved under `5etools.characters.v1` in this browser's local storage, scoped to the local site's origin. Different hostnames or ports have different libraries. Export backups before clearing browser data or moving to a different server.

**Export JSON** exports one full character. **Export library** exports all characters. **Import JSON** appends imported characters with fresh IDs and preserves existing characters. A whole file is validated before any entry is added; unsupported versions, unsafe keys, invalid types, invalid levels, and oversized files are rejected. Missing data-source references remain in the character with a warning, so restoring that source can restore the options.

**Export creature** exports a snapshot under the usual `monster` array with `_meta.sources`, suitable for the Homebrew Manager. It contains the derived stat block, not the editable character history; use the character export for a round trip. Exported characters reference library entries by name and source. Transfer any custom homebrew sources separately.

The character envelope is:

```json
{
  "_meta": {"sources": [{"json": "CSH", "abbreviation": "CSH", "full": "Character Sheets", "authors": [], "version": "1"}]},
  "fileType": "5etools-characters",
  "version": 1,
  "character": []
}
```

An import must contain 1–200 characters. Each character stores identity, base scores, class levels and subclass references, level-specific improvements, origin/feature/spell choices, proficiencies, feats, inventory, spells, currency, adjustments, resource usage, notes, and the roll log. Class `options` maps source progression keys to ordered choices, including inactive choices retained after lowering a level or changing subclass. Ordinary references are `name|source`. Subclass references are `name|source|className|classSource`; class-feature references retain the native 5etools UID format. Class and inventory IDs are stable within a character. The library limit is 200 characters; the import size limit is 10 MiB.

The public envelope schema is in `schema/characters.schema.json`. Runtime validation and defaults are in `js/characters/character-model.js`. Imports preserve extension fields but reject prototype-related keys at any depth. User text is escaped before insertion into the stat block, and dice use a restricted arithmetic parser rather than `eval`.

Character-local custom definitions live in `customOptions` (`id`, `kind`, `name`, `description`) and use `custom:<id>` references in the existing choice fields. Supported kinds are `language`, `tool`, `feat`, and `optionalfeature`. Definitions and choices travel together in character exports; no homebrew source installation is needed for these entries. Older version-1 exports load with an empty custom-option collection. A character can store 200 custom definitions, with names up to 200 characters and descriptions up to 10,000 characters.

MPMB imports also use `inventory[].custom` for unmatched item details and optional manual attacks, `toolTraining` for additional tool proficiency/expertise, `abilityChoices[].included` and improvement mode `included` for existing score increases, and `importedMpmb` for review notes and provenance. These fields round-trip with character JSON; PDFs are not retained in browser storage or JSON exports.

Failed storage writes leave the current work in memory and show an export warning. Changes detected in another tab block further writes until reload, preventing a stale tab from overwriting the library. The recovery export includes both the stored text and the current in-memory envelope.

## Implementation and checks

- `js/characters/character-data.js`: the existing `DataUtil` loaders, merged species, generated item variants, spell-class metadata, and installed homebrew/prerelease content.
- `js/characters/character-model.js`: portable state, validation, defaults, and dice.
- `js/characters/character-engine.js`: derived statistics, feature grants, spells, rests, and creature conversion. No browser dependencies.
- `js/characters/character-proficiencies.js`: structured proficiency choices, source-scoped core feature grants, expertise, language/tool options, and weapon-training filters.
- `js/characters.js`, `character-builder.js`, `character-play.js`: page, pickers, persistence, builder, and play controls.
- `character-import-pdf.js` and `character-import-worker.js`: bounded, read-only PDF form extraction.
- `character-import-mpmb.js` and `character-import-mpmb-ui.js`: data conversion and upload/review workflow.
- `node/generate-character-pdf-libs.js`: copies the pinned PDF and data-literal readers into `lib/`, with licenses. See `lib/character-pdf-libs.md`.
- `node/generate-pages/template/page/template-page-characters.hbs`: generated-page source.
- `scss/characters.scss`: scoped layout and print/responsive styles; compiled output is tracked in `css/`.

Run focused rules tests with:

```sh
npm run test:unit -- --runInBand --runTestsByPath test/jest/CharacterSheet.test.js test/jest/MpmbImport.test.js
```

The tests use the repository's actual class, subclass, species, background, feat, item, language, and spell JSON. They exercise every indexed class through levels 1–20 and derive stat blocks for every indexed subclass and top-level origin/feat/optional-feature entry. Focused assertions cover subclass gates, ASIs, HP/CON, armor, attacks, proficiency choices, expertise unlocks, multiclass grants and casting, rests, spell grants, scaling, imports, and unsafe input. This compatibility sweep verifies that entries can be processed; it does not prove every prose-only rule is automated. Generate HTML with `npm run gen:pages`; compile this stylesheet with `npx sass --style=compressed scss/characters.scss css/characters.css`.

Browser regression checklist (serve this clone, never the public 5etools site): create a character; select a class/species/background; level up and choose a subclass/ASI; choose starting equipment; cast and restore a slot; apply damage and rest; add a species spell choice; export/import and check roster isolation; reload for persistence; reject a malformed import without changing the roster; inspect desktop/mobile layouts and the bestiary page.

MPMB regression checks use synthetic fillable PDFs and the local class, item, spell and feat data. They cover extraction without script execution, both editions, final-score preservation, future ASIs, multiclass and unknown classes, spell ownership/preparation, regular/pact slot usage, custom items/feats, JSON round trips, invalid uploads, cancellation and confirmation. Browser checklist: upload a saved MPMB PDF, review both source choices, cancel and retry, confirm, inspect the stat block and retained equipment, edit a custom attack, then export/import the resulting JSON. Unit tests exercise the upload workflow with a worker stub and the real PDF reader; they do not replace browser interaction or layout checks.
