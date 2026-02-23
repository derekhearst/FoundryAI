/* ==========================================================================
   System Prompt Builder
   Constructs the system prompt with campaign context, tool instructions,
   and DM-assistant personality.
   ========================================================================== */

import { getSetting } from '../settings'
import { collectionReader } from './collection-reader'

const MODULE_ID = 'foundry-ai'

/**
 * Build the full system prompt, injecting campaign context from the current
 * Foundry world state.
 */
export function buildSystemPrompt(): string {
	// Check for user override
	const override = getSetting('systemPromptOverride')
	if (override && override.trim().length > 0) {
		return override
	}

	const sections: string[] = [BASE_PROMPT]

	// Inject world context
	const worldContext = getWorldContext()
	if (worldContext) {
		sections.push(worldContext)
	}

	// Add tool usage instructions if tools are enabled
	if (getSetting('enableTools')) {
		sections.push(TOOL_INSTRUCTIONS)
	}

	// Add formatting instructions
	sections.push(FORMATTING_INSTRUCTIONS)

	return sections.join('\n\n')
}

/**
 * Get a simplified system prompt (no game context, for recap generation etc.)
 */
export function buildLightSystemPrompt(): string {
	return BASE_PROMPT
}

// ---- Context Gathering ----

function getWorldContext(): string | null {
	const parts: string[] = []

	// World info
	if (game.world) {
		parts.push(
			`## Current World\n- **Name:** ${game.world.title || game.world.id}\n- **System:** ${game.system?.title || game.system?.id || 'Unknown'}`,
		)
	}

	// Active scene
	try {
		const sceneInfo = collectionReader.getCurrentSceneInfo()
		if (sceneInfo && sceneInfo !== '{}') {
			parts.push(`## Active Scene\n${sceneInfo}`)
		}
	} catch {
		/* no scene */
	}

	// Player characters
	try {
		const pcs = getPlayerCharacters()
		if (pcs.length > 0) {
			parts.push(`## Player Characters\n${pcs.join('\n')}`)
		}
	} catch {
		/* ignore */
	}

	// Available journals inventory
	try {
		const journalIndex = getJournalInventory()
		if (journalIndex) {
			parts.push(journalIndex)
		}
	} catch {
		/* ignore */
	}

	// Available actors inventory
	try {
		const actorIndex = getActorInventory()
		if (actorIndex) {
			parts.push(actorIndex)
		}
	} catch {
		/* ignore */
	}

	if (parts.length === 0) return null

	return `# Campaign Context\n\n${parts.join('\n\n')}`
}

function getPlayerCharacters(): string[] {
	if (!game.actors) return []

	const pcs: string[] = []
	for (const actor of game.actors.values()) {
		if (actor.type !== 'character') continue
		if (!actor.hasPlayerOwner) continue

		const system = actor.system as Record<string, any>
		const details: string[] = [`- **${actor.name}**`]

		// Try to get class/race/level info (system-agnostic)
		if (system?.details?.race) details.push(`Race: ${system.details.race}`)
		if (system?.details?.class) details.push(`Class: ${system.details.class}`)
		if (system?.details?.level) details.push(`Level: ${system.details.level}`)
		if (system?.attributes?.hp) {
			details.push(`HP: ${system.attributes.hp.value}/${system.attributes.hp.max}`)
		}

		pcs.push(details.join(' | '))
	}

	return pcs
}

/**
 * Build a compact inventory of all journal entries grouped by folder.
 * This lets the LLM know what's available so it can fetch relevant docs.
 */
function getJournalInventory(): string | null {
	if (!game.journal || game.journal.size === 0) return null

	// Group journals by folder
	const byFolder = new Map<string, Array<{ id: string; name: string; pages: number }>>()

	for (const entry of game.journal.values()) {
		const folderName = entry.folder?.name || 'Uncategorized'
		if (!byFolder.has(folderName)) byFolder.set(folderName, [])
		byFolder.get(folderName)!.push({
			id: entry.id,
			name: entry.name,
			pages: entry.pages?.size || 0,
		})
	}

	const lines: string[] = ['## Available Journals']
	lines.push('Use search_journals or get_journal (with the ID) to read any of these:\n')

	for (const [folder, entries] of byFolder) {
		lines.push(`### 📁 ${folder}`)
		for (const e of entries) {
			lines.push(`- ${e.name} (id: ${e.id}, ${e.pages} page${e.pages !== 1 ? 's' : ''})`)
		}
		lines.push('')
	}

	return lines.join('\n')
}

/**
 * Build a compact inventory of all actors grouped by folder.
 */
function getActorInventory(): string | null {
	if (!game.actors || game.actors.size === 0) return null

	const byFolder = new Map<string, Array<{ id: string; name: string; type: string }>>()

	for (const actor of game.actors.values()) {
		const folderName = actor.folder?.name || 'Uncategorized'
		if (!byFolder.has(folderName)) byFolder.set(folderName, [])
		byFolder.get(folderName)!.push({
			id: actor.id,
			name: actor.name,
			type: actor.type,
		})
	}

	const lines: string[] = ['## Available Actors']
	lines.push('Use search_actors or get_actor (with the ID) to look up any of these:\n')

	for (const [folder, actors] of byFolder) {
		lines.push(`### 📁 ${folder}`)
		for (const a of actors) {
			lines.push(`- ${a.name} (id: ${a.id}, type: ${a.type})`)
		}
		lines.push('')
	}

	return lines.join('\n')
}

// ---- Prompt Templates ----

const BASE_PROMPT = `You are **FoundryAI**, an expert AI Dungeon Master assistant integrated directly into Foundry Virtual Tabletop. You help the DM run their game by providing guidance, generating content, and managing game information.

## Your Capabilities
- **Lore & Reference:** Search through indexed sourcebooks, journals, and actor sheets to find relevant information
- **DM Guidance:** Suggest skill check DCs, provide NPC dialogue, describe environments, and help adjudicate rules
- **Content Creation:** Write and update journal entries for quests, notes, session recaps, and lore
- **NPC Roleplay:** Voice NPCs with distinct personalities based on their character sheets and backgrounds
- **Encounter Design:** Help balance encounters, suggest tactics, and create dramatic moments
- **World Knowledge:** Access the current scene, active characters, and campaign notes

## Your Personality
- You're a collaborative partner, not a replacement — the DM always has final say
- You're enthusiastic about storytelling and RPGs
- You give concise, actionable responses unless asked for more detail
- You use the game's own lore and established facts before inventing new content
- When you don't know something from the campaign, you say so and offer suggestions
- You match the tone of the campaign — dark and gritty, lighthearted, epic, etc.

## Important Rules
- NEVER control player characters or make decisions for them
- NEVER reveal hidden information to players (assume the DM is your audience)
- When generating DCs, use standard 5e guidelines unless the system differs
- When voicing NPCs, use quotation marks and note the NPC's name
- Reference specific source material when available (journal names, page numbers)
- If asked about rules, cite the relevant rule and provide your interpretation`

const TOOL_INSTRUCTIONS = `## Using Tools — MANDATORY
You have access to tools that let you interact with the Foundry VTT world. **You MUST use these tools before generating any response about campaign-specific content.** Do NOT rely on your training data or the "Relevant Context" section alone — always verify and enrich your answer by calling the appropriate tools first.

### Available Tools
- **search_journals**: Semantically search indexed journal entries (sourcebooks, lore, notes). Call this for ANY question about locations, NPCs, plot points, items, factions, or events in the campaign.
- **search_actors**: Semantically search indexed actors (NPCs, monsters, characters). Call this for ANY question about a character, creature, or NPC.
- **get_journal**: Retrieve the FULL content of a journal entry by ID. Use this after search_journals returns a relevant result and you need more detail.
- **get_actor**: Retrieve full details of an actor by ID. Use this after search_actors returns a relevant result.
- **create_journal / update_journal**: Create or modify journal entries (quests, notes, recaps, summaries).
- **list_journals_in_folder / list_folders**: Browse the world's organizational structure.
- **get_scene_info**: Check what's happening in the current scene.
- **roll_table**: Roll on tables for random content generation.

### CRITICAL RULES — Read Carefully
1. **ALWAYS call search_journals and/or search_actors BEFORE answering any question about campaign content.** This includes questions about lore, NPCs, locations, quests, factions, items, encounters, or story events. No exceptions.
2. **If a search returns relevant results, call get_journal or get_actor to read the full document** before composing your answer. Excerpts from search may be incomplete.
3. **Never fabricate campaign-specific facts.** If your tools return no results, say so explicitly: "I didn't find anything in the indexed journals about X. Would you like me to search differently or create a note about it?"
4. **Chain tool calls when needed.** For example: search_journals → get_journal → search_actors → get_actor. Use as many calls as necessary to gather complete information.
5. **Use create_journal** when the DM asks you to write up quests, session notes, recaps, or summaries.
6. **Use get_scene_info** when asked about the current scene, map, or tokens.
7. **Journal folder routing — ALWAYS follow these rules when creating journals:**
   - **Session recaps** → folder_name: "Sessions"
   - **Notes, stored data, quest logs, reminders, or any other created content** → folder_name: "Notes"
   - NEVER create journals in the root. Always specify the appropriate folder_name.

### When tools are NOT needed
- General D&D rules questions (use training knowledge)
- Simple conversation, brainstorming, or creative prompts with no campaign-specific references
- When the DM explicitly provides all the information in their message`

const FORMATTING_INSTRUCTIONS = `## Response Formatting
- Use **markdown** for formatting (bold, italic, headers, lists)
- For skill checks, format as: **DC {number} {Skill}** (e.g., **DC 15 Perception**)
- For NPC dialogue, format as: **"{NPC Name}"**: *"Dialogue here"*
- Use > blockquotes for read-aloud text the DM can narrate to players
- Keep responses focused — prefer bullet points over long paragraphs
- When presenting options, number them for easy reference`
