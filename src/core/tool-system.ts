/* ==========================================================================
   Tool System - OpenAI-compatible function calling tools for the LLM
   ========================================================================== */

import { embeddingService } from './embedding-service'
import { collectionReader } from './collection-reader'
import { getSetting } from '../settings'
import type { ToolDefinition, ToolCall } from './openrouter-service'

// ---- Folder Permission Helpers ----
// These check whether a document's folder is in the user's allowed list.
// If no folders are selected for a type, nothing is accessible.

function isJournalFolderAllowed(folderId: string | undefined | null): boolean {
	const allowed = getSetting('journalFolders') || []
	if (allowed.length === 0) return true // no restriction if none selected
	if (!folderId) return false // root items excluded when filtering is active
	return allowed.includes(folderId)
}

function isActorFolderAllowed(folderId: string | undefined | null): boolean {
	const allowed = getSetting('actorFolders') || []
	if (allowed.length === 0) return true
	if (!folderId) return false
	return allowed.includes(folderId)
}

function isSceneFolderAllowed(folderId: string | undefined | null): boolean {
	const allowed = getSetting('sceneFolders') || []
	if (allowed.length === 0) return true
	if (!folderId) return false
	return allowed.includes(folderId)
}

// ---- Tool Definitions (OpenAI function calling format) ----

// == Core Tools (always available when tools enabled) ==
const CORE_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'search_journals',
			description:
				'Semantically search through indexed journal entries (sourcebooks, notes, lore). Returns the most relevant passages.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: "The search query describing what information you're looking for",
					},
					max_results: {
						type: 'number',
						description: 'Maximum number of results to return (default: 5)',
					},
				},
				required: ['query'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'search_actors',
			description:
				'Semantically search through indexed actors (NPCs, monsters, characters). Returns the most relevant matches.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'The search query (e.g. NPC name, trait, role)',
					},
					max_results: {
						type: 'number',
						description: 'Maximum number of results to return (default: 5)',
					},
				},
				required: ['query'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_journal',
			description: 'Get the full content of a specific journal entry by its ID.',
			parameters: {
				type: 'object',
				properties: {
					journal_id: {
						type: 'string',
						description: 'The Foundry VTT document ID of the journal entry',
					},
				},
				required: ['journal_id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_actor',
			description: 'Get details about a specific actor (NPC/character) by ID.',
			parameters: {
				type: 'object',
				properties: {
					actor_id: {
						type: 'string',
						description: 'The Foundry VTT document ID of the actor',
					},
				},
				required: ['actor_id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'create_journal',
			description:
				'Create a new journal entry in a specified folder. Session recaps MUST go in the "Sessions" folder. Notes and stored data MUST go in the "Notes" folder.',
			parameters: {
				type: 'object',
				properties: {
					name: {
						type: 'string',
						description: 'The title of the journal entry',
					},
					content: {
						type: 'string',
						description: 'The HTML content of the journal entry. Use proper HTML formatting.',
					},
					folder_name: {
						type: 'string',
						description:
							'The name of the journal folder to create in (e.g. "Sessions", "Notes"). The folder will be created if it does not exist.',
					},
					folder_id: {
						type: 'string',
						description: 'The folder ID to create the journal in. Prefer folder_name instead.',
					},
				},
				required: ['name', 'content'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'update_journal',
			description: 'Update the content of an existing journal entry.',
			parameters: {
				type: 'object',
				properties: {
					journal_id: {
						type: 'string',
						description: 'The ID of the journal entry to update',
					},
					content: {
						type: 'string',
						description: 'The new HTML content for the first page',
					},
					page_name: {
						type: 'string',
						description: 'Optionally update the page name',
					},
				},
				required: ['journal_id', 'content'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'list_journals_in_folder',
			description: 'List all journal entries in a specific folder.',
			parameters: {
				type: 'object',
				properties: {
					folder_id: {
						type: 'string',
						description: 'The folder ID to list journals from',
					},
				},
				required: ['folder_id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'list_folders',
			description: 'List all accessible journal, actor, and scene folders in the world.',
			parameters: {
				type: 'object',
				properties: {
					type: {
						type: 'string',
						enum: ['journal', 'actor', 'scene', 'all'],
						description: 'Filter by folder type',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_scene_info',
			description:
				'Get detailed information about the currently active scene including tokens, notes, combat, and other details.',
			parameters: {
				type: 'object',
				properties: {},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'roll_table',
			description: 'Roll on a roll table by its ID and return the result.',
			parameters: {
				type: 'object',
				properties: {
					table_id: {
						type: 'string',
						description: 'The ID of the roll table',
					},
				},
				required: ['table_id'],
			},
		},
	},
]

// == Scene Tools ==
const SCENE_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'list_scenes',
			description: 'List all scenes in the world with their IDs, names, and active status.',
			parameters: {
				type: 'object',
				properties: {
					type: {
						type: 'string',
						enum: ['all', 'navigation'],
						description: 'Filter: "all" for all scenes, "navigation" for only scenes in the nav bar (default: all)',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'view_scene',
			description: 'Get detailed information about a specific scene without activating it.',
			parameters: {
				type: 'object',
				properties: {
					scene_id: {
						type: 'string',
						description: 'The ID of the scene to view',
					},
				},
				required: ['scene_id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'activate_scene',
			description: 'Switch the active scene to a different one. All players will be moved to this scene.',
			parameters: {
				type: 'object',
				properties: {
					scene_id: {
						type: 'string',
						description: 'The ID of the scene to activate',
					},
				},
				required: ['scene_id'],
			},
		},
	},
]

// == Dice Tools ==
const DICE_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'roll_dice',
			description:
				'Roll dice using a standard dice expression. Returns the total and individual results. Does NOT post to chat.',
			parameters: {
				type: 'object',
				properties: {
					expression: {
						type: 'string',
						description: 'Dice expression (e.g. "2d6+4", "4d6kh3", "1d20+5")',
					},
					label: {
						type: 'string',
						description: 'Optional label for the roll (e.g. "Attack Roll", "Damage")',
					},
				},
				required: ['expression'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'roll_check',
			description: 'Roll an ability check or saving throw for a specific actor.',
			parameters: {
				type: 'object',
				properties: {
					actor_id: {
						type: 'string',
						description: 'The ID of the actor to roll for',
					},
					ability: {
						type: 'string',
						enum: ['str', 'dex', 'con', 'int', 'wis', 'cha'],
						description: 'The ability to roll',
					},
					type: {
						type: 'string',
						enum: ['check', 'save'],
						description: 'Whether to roll an ability check or saving throw',
					},
				},
				required: ['actor_id', 'ability', 'type'],
			},
		},
	},
]

// == Token Tools ==
const TOKEN_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'place_token',
			description:
				'Place a new token on the active scene from an actor. Tokens are placed HIDDEN by default so the DM can approve placement before revealing.',
			parameters: {
				type: 'object',
				properties: {
					actor_id: {
						type: 'string',
						description: 'The ID of the actor to create a token from',
					},
					x: {
						type: 'number',
						description: 'X position on the canvas (grid coordinates)',
					},
					y: {
						type: 'number',
						description: 'Y position on the canvas (grid coordinates)',
					},
					hidden: {
						type: 'boolean',
						description: 'Whether the token starts hidden (default: true)',
					},
				},
				required: ['actor_id', 'x', 'y'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'move_token',
			description: 'Move an existing token to a new position on the canvas.',
			parameters: {
				type: 'object',
				properties: {
					token_id: {
						type: 'string',
						description: 'The ID of the token to move',
					},
					x: {
						type: 'number',
						description: 'New X position',
					},
					y: {
						type: 'number',
						description: 'New Y position',
					},
				},
				required: ['token_id', 'x', 'y'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'hide_token',
			description: 'Hide a token from player view.',
			parameters: {
				type: 'object',
				properties: {
					token_id: {
						type: 'string',
						description: 'The ID of the token to hide',
					},
				},
				required: ['token_id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'reveal_token',
			description: 'Reveal a hidden token to player view.',
			parameters: {
				type: 'object',
				properties: {
					token_id: {
						type: 'string',
						description: 'The ID of the token to reveal',
					},
				},
				required: ['token_id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'remove_token',
			description: 'Remove a token from the scene entirely.',
			parameters: {
				type: 'object',
				properties: {
					token_id: {
						type: 'string',
						description: 'The ID of the token to remove',
					},
				},
				required: ['token_id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'update_token',
			description: 'Update properties of a token (name, size, elevation, light).',
			parameters: {
				type: 'object',
				properties: {
					token_id: {
						type: 'string',
						description: 'The ID of the token to update',
					},
					name: { type: 'string', description: 'New display name' },
					width: { type: 'number', description: 'Width in grid squares' },
					height: { type: 'number', description: 'Height in grid squares' },
					elevation: { type: 'number', description: 'Elevation in feet' },
					light_dim: { type: 'number', description: 'Dim light radius in feet' },
					light_bright: { type: 'number', description: 'Bright light radius in feet' },
					light_color: { type: 'string', description: 'Light color hex (e.g. "#ff9900")' },
				},
				required: ['token_id'],
			},
		},
	},
]

// == Combat Tools ==
const COMBAT_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'start_combat',
			description: 'Create a new combat encounter and optionally add tokens to it.',
			parameters: {
				type: 'object',
				properties: {
					token_ids: {
						type: 'array',
						items: { type: 'string' },
						description: 'Optional list of token IDs to add as combatants',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'end_combat',
			description: 'End the current combat encounter.',
			parameters: {
				type: 'object',
				properties: {},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'add_to_combat',
			description: 'Add tokens to the current combat encounter.',
			parameters: {
				type: 'object',
				properties: {
					token_ids: {
						type: 'array',
						items: { type: 'string' },
						description: 'Token IDs to add as combatants',
					},
				},
				required: ['token_ids'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'remove_from_combat',
			description: 'Remove combatants from the current combat encounter.',
			parameters: {
				type: 'object',
				properties: {
					combatant_ids: {
						type: 'array',
						items: { type: 'string' },
						description: 'Combatant IDs to remove',
					},
				},
				required: ['combatant_ids'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'next_turn',
			description: 'Advance to the next turn in combat.',
			parameters: {
				type: 'object',
				properties: {},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'roll_initiative',
			description:
				'Roll initiative for combatants. If no IDs specified, rolls for all combatants that have not yet rolled.',
			parameters: {
				type: 'object',
				properties: {
					combatant_ids: {
						type: 'array',
						items: { type: 'string' },
						description: 'Specific combatant IDs to roll for. Leave empty to roll for all unrolled combatants.',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'apply_damage',
			description: 'Apply damage or healing to a token/actor.',
			parameters: {
				type: 'object',
				properties: {
					token_id: {
						type: 'string',
						description: 'The token ID of the target',
					},
					amount: {
						type: 'number',
						description: 'Amount of damage (positive) or healing (negative)',
					},
					type: {
						type: 'string',
						enum: ['damage', 'healing'],
						description: 'Whether this is damage or healing',
					},
				},
				required: ['token_id', 'amount', 'type'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'apply_condition',
			description: 'Apply a condition/status effect to a token (e.g. poisoned, stunned, prone, blinded, etc.).',
			parameters: {
				type: 'object',
				properties: {
					token_id: {
						type: 'string',
						description: 'The token ID to apply the condition to',
					},
					condition: {
						type: 'string',
						description: 'The condition name (e.g. "poisoned", "stunned", "prone", "blinded", "frightened")',
					},
				},
				required: ['token_id', 'condition'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'remove_condition',
			description: 'Remove a condition/status effect from a token.',
			parameters: {
				type: 'object',
				properties: {
					token_id: {
						type: 'string',
						description: 'The token ID to remove the condition from',
					},
					condition: {
						type: 'string',
						description: 'The condition name to remove',
					},
				},
				required: ['token_id', 'condition'],
			},
		},
	},
]

// == Audio Tools ==
const AUDIO_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'list_playlists',
			description: 'List all playlists and their tracks.',
			parameters: {
				type: 'object',
				properties: {},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'play_playlist',
			description: 'Start playing a playlist.',
			parameters: {
				type: 'object',
				properties: {
					playlist_id: {
						type: 'string',
						description: 'The ID of the playlist to play',
					},
				},
				required: ['playlist_id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'stop_playlist',
			description: 'Stop a playlist. If no ID given, stops all playing playlists.',
			parameters: {
				type: 'object',
				properties: {
					playlist_id: {
						type: 'string',
						description: 'The ID of the playlist to stop. Omit to stop all.',
					},
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'play_track',
			description: 'Play a specific track from a playlist.',
			parameters: {
				type: 'object',
				properties: {
					playlist_id: {
						type: 'string',
						description: 'The ID of the playlist',
					},
					track_name: {
						type: 'string',
						description: 'The name of the track to play',
					},
				},
				required: ['playlist_id', 'track_name'],
			},
		},
	},
]

// == Chat & Narration Tools ==
const CHAT_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'post_chat_message',
			description:
				'Post a message to the Foundry VTT chat log visible to all players. Use for narration, NPC dialogue, or announcements.',
			parameters: {
				type: 'object',
				properties: {
					content: {
						type: 'string',
						description: 'The HTML/text content of the message',
					},
					speaker_name: {
						type: 'string',
						description: 'The name to display as the speaker (e.g. NPC name). Omit for narration.',
					},
					whisper_to: {
						type: 'array',
						items: { type: 'string' },
						description: 'Player names to whisper to. Omit for public message.',
					},
				},
				required: ['content'],
			},
		},
	},
]

// == Compendium Tools ==
const COMPENDIUM_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'search_compendium',
			description: 'Search across all compendium packs (SRD monsters, items, spells, etc.) by name.',
			parameters: {
				type: 'object',
				properties: {
					query: {
						type: 'string',
						description: 'Search name or partial name',
					},
					type: {
						type: 'string',
						enum: ['Actor', 'Item', 'JournalEntry', 'RollTable', 'all'],
						description: 'Filter by document type (default: all)',
					},
					max_results: {
						type: 'number',
						description: 'Maximum results to return (default: 10)',
					},
				},
				required: ['query'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'get_compendium_entry',
			description: 'Get the full details of a specific compendium entry.',
			parameters: {
				type: 'object',
				properties: {
					pack_id: {
						type: 'string',
						description: 'The compendium pack ID (e.g. "dnd5e.monsters")',
					},
					entry_id: {
						type: 'string',
						description: 'The document ID within the pack',
					},
				},
				required: ['pack_id', 'entry_id'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'import_from_compendium',
			description:
				'Import a document from a compendium into the world. Useful for importing SRD monsters to then place as tokens.',
			parameters: {
				type: 'object',
				properties: {
					pack_id: {
						type: 'string',
						description: 'The compendium pack ID',
					},
					entry_id: {
						type: 'string',
						description: 'The document ID to import',
					},
					folder_id: {
						type: 'string',
						description: 'Optional folder ID to import into',
					},
				},
				required: ['pack_id', 'entry_id'],
			},
		},
	},
]

// == Spatial Tools ==
const SPATIAL_TOOLS: ToolDefinition[] = [
	{
		type: 'function',
		function: {
			name: 'measure_distance',
			description: 'Measure the distance between two tokens or two points on the map.',
			parameters: {
				type: 'object',
				properties: {
					from_token_id: { type: 'string', description: 'Token ID of the origin' },
					to_token_id: { type: 'string', description: 'Token ID of the destination' },
					from_x: { type: 'number', description: 'Origin X (if not using token)' },
					from_y: { type: 'number', description: 'Origin Y (if not using token)' },
					to_x: { type: 'number', description: 'Destination X (if not using token)' },
					to_y: { type: 'number', description: 'Destination Y (if not using token)' },
				},
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'tokens_in_range',
			description: 'Find all tokens within a certain distance of a point or token.',
			parameters: {
				type: 'object',
				properties: {
					token_id: { type: 'string', description: 'Center token ID (or use x/y)' },
					x: { type: 'number', description: 'Center X (if not using token)' },
					y: { type: 'number', description: 'Center Y (if not using token)' },
					range: { type: 'number', description: 'Range in grid distance units (e.g. feet)' },
				},
				required: ['range'],
			},
		},
	},
	{
		type: 'function',
		function: {
			name: 'create_measured_template',
			description: 'Place a measured template on the canvas (for spell areas, etc.).',
			parameters: {
				type: 'object',
				properties: {
					type: {
						type: 'string',
						enum: ['circle', 'cone', 'ray', 'rect'],
						description: 'Template shape',
					},
					x: { type: 'number', description: 'X position' },
					y: { type: 'number', description: 'Y position' },
					distance: { type: 'number', description: 'Size/distance in grid units (e.g. 20 for 20ft radius)' },
					direction: {
						type: 'number',
						description: 'Direction in degrees (for cone/ray). 0=right, 90=down, 180=left, 270=up',
					},
					width: { type: 'number', description: 'Width for ray templates (default: 5)' },
					color: { type: 'string', description: 'Fill color hex (default: "#FF0000")' },
				},
				required: ['type', 'x', 'y', 'distance'],
			},
		},
	},
]

// ---- Combine all tool definitions ----

export const TOOL_DEFINITIONS: ToolDefinition[] = [
	...CORE_TOOLS,
	...SCENE_TOOLS,
	...DICE_TOOLS,
	...TOKEN_TOOLS,
	...COMBAT_TOOLS,
	...AUDIO_TOOLS,
	...CHAT_TOOLS,
	...COMPENDIUM_TOOLS,
	...SPATIAL_TOOLS,
]

/**
 * Get only the enabled tool definitions based on user settings.
 */
export function getEnabledTools(): ToolDefinition[] {
	if (!getSetting('enableTools')) return []

	const tools: ToolDefinition[] = [...CORE_TOOLS]

	if (getSetting('enableSceneTools')) tools.push(...SCENE_TOOLS)
	if (getSetting('enableDiceTools')) tools.push(...DICE_TOOLS)
	if (getSetting('enableTokenTools')) tools.push(...TOKEN_TOOLS)
	if (getSetting('enableCombatTools')) tools.push(...COMBAT_TOOLS)
	if (getSetting('enableAudioTools')) tools.push(...AUDIO_TOOLS)
	if (getSetting('enableChatTools')) tools.push(...CHAT_TOOLS)
	if (getSetting('enableCompendiumTools')) tools.push(...COMPENDIUM_TOOLS)
	if (getSetting('enableSpatialTools')) tools.push(...SPATIAL_TOOLS)

	return tools
}

// ---- Tool Execution ----

export async function executeTool(toolCall: ToolCall): Promise<string> {
	const funcName = toolCall.function.name
	let args: Record<string, any>

	console.log(
		`FoundryAI | executeTool called — name: "${funcName}", id: "${toolCall.id}", raw args: ${toolCall.function.arguments?.slice(0, 200)}`,
	)

	if (!funcName) {
		console.error('FoundryAI | Tool call has no function name!', JSON.stringify(toolCall))
		return JSON.stringify({ error: 'Tool call has no function name. This is a streaming parsing error.' })
	}

	try {
		args = JSON.parse(toolCall.function.arguments)
	} catch (e) {
		console.error(`FoundryAI | Failed to parse arguments for tool "${funcName}":`, toolCall.function.arguments, e)
		return JSON.stringify({ error: `Invalid arguments for tool ${funcName}` })
	}

	console.log(`FoundryAI | Executing tool "${funcName}" with args:`, args)

	try {
		let result: string
		switch (funcName) {
			// Core tools
			case 'search_journals':
				return await handleSearchJournals(args.query, args.max_results)
			case 'search_actors':
				return await handleSearchActors(args.query, args.max_results)
			case 'get_journal':
				return handleGetJournal(args.journal_id)
			case 'get_actor':
				return handleGetActor(args.actor_id)
			case 'create_journal':
				return await handleCreateJournal(args.name, args.content, args.folder_name, args.folder_id)
			case 'update_journal':
				return await handleUpdateJournal(args.journal_id, args.content, args.page_name)
			case 'list_journals_in_folder':
				return handleListJournalsInFolder(args.folder_id)
			case 'list_folders':
				return handleListFolders(args.type || 'all')
			case 'get_scene_info':
				return handleGetSceneInfo()
			case 'roll_table':
				return await handleRollTable(args.table_id)

			// Scene tools
			case 'list_scenes':
				return handleListScenes(args.type)
			case 'view_scene':
				return handleViewScene(args.scene_id)
			case 'activate_scene':
				return await handleActivateScene(args.scene_id)

			// Dice tools
			case 'roll_dice':
				return await handleRollDice(args.expression, args.label)
			case 'roll_check':
				return await handleRollCheck(args.actor_id, args.ability, args.type)

			// Token tools
			case 'place_token':
				return await handlePlaceToken(args.actor_id, args.x, args.y, args.hidden)
			case 'move_token':
				return await handleMoveToken(args.token_id, args.x, args.y)
			case 'hide_token':
				return await handleSetTokenVisibility(args.token_id, true)
			case 'reveal_token':
				return await handleSetTokenVisibility(args.token_id, false)
			case 'remove_token':
				return await handleRemoveToken(args.token_id)
			case 'update_token':
				return await handleUpdateToken(args)

			// Combat tools
			case 'start_combat':
				return await handleStartCombat(args.token_ids)
			case 'end_combat':
				return await handleEndCombat()
			case 'add_to_combat':
				return await handleAddToCombat(args.token_ids)
			case 'remove_from_combat':
				return await handleRemoveFromCombat(args.combatant_ids)
			case 'next_turn':
				return await handleNextTurn()
			case 'roll_initiative':
				return await handleRollInitiative(args.combatant_ids)
			case 'apply_damage':
				return await handleApplyDamage(args.token_id, args.amount, args.type)
			case 'apply_condition':
				return await handleApplyCondition(args.token_id, args.condition)
			case 'remove_condition':
				return await handleRemoveCondition(args.token_id, args.condition)

			// Audio tools
			case 'list_playlists':
				return handleListPlaylists()
			case 'play_playlist':
				return await handlePlayPlaylist(args.playlist_id)
			case 'stop_playlist':
				return await handleStopPlaylist(args.playlist_id)
			case 'play_track':
				return await handlePlayTrack(args.playlist_id, args.track_name)

			// Chat tools
			case 'post_chat_message':
				return await handlePostChatMessage(args.content, args.speaker_name, args.whisper_to)

			// Compendium tools
			case 'search_compendium':
				return await handleSearchCompendium(args.query, args.type, args.max_results)
			case 'get_compendium_entry':
				return await handleGetCompendiumEntry(args.pack_id, args.entry_id)
			case 'import_from_compendium':
				return await handleImportFromCompendium(args.pack_id, args.entry_id, args.folder_id)

			// Spatial tools
			case 'measure_distance':
				return handleMeasureDistance(args)
			case 'tokens_in_range':
				return handleTokensInRange(args)
			case 'create_measured_template':
				return await handleCreateMeasuredTemplate(args)

			default:
				console.warn(`FoundryAI | Unknown tool called: "${funcName}"`)
				return JSON.stringify({ error: `Unknown tool: ${funcName}` })
		}
	} catch (error: any) {
		console.error(`FoundryAI | Tool "${funcName}" execution failed:`, error)
		return JSON.stringify({ error: `Tool execution failed: ${error.message}` })
	}
}

// ===============================
// CORE TOOL HANDLERS
// ===============================

async function handleSearchJournals(query: string, maxResults?: number): Promise<string> {
	const results = await embeddingService.search(query, maxResults || 5, { documentType: 'journal' })

	if (results.length === 0) {
		return JSON.stringify({ results: [], message: 'No matching journals found.' })
	}

	return JSON.stringify({
		results: results.map((r) => ({
			documentId: r.entry.documentId,
			documentName: r.entry.documentName,
			folder: r.entry.folderName,
			relevance: Math.round(r.score * 100) / 100,
			excerpt: r.entry.text.slice(0, 500),
		})),
	})
}

async function handleSearchActors(query: string, maxResults?: number): Promise<string> {
	const results = await embeddingService.search(query, maxResults || 5, { documentType: 'actor' })

	if (results.length === 0) {
		return JSON.stringify({ results: [], message: 'No matching actors found.' })
	}

	return JSON.stringify({
		results: results.map((r) => ({
			documentId: r.entry.documentId,
			documentName: r.entry.documentName,
			folder: r.entry.folderName,
			relevance: Math.round(r.score * 100) / 100,
			excerpt: r.entry.text.slice(0, 500),
		})),
	})
}

function handleGetJournal(journalId: string): string {
	const entry = game.journal?.get(journalId)
	if (!entry) {
		return JSON.stringify({ error: `Journal entry not found: ${journalId}` })
	}

	if (!isJournalFolderAllowed(entry.folder?.id)) {
		return JSON.stringify({ error: `Journal entry not found: ${journalId}` })
	}

	const content = collectionReader.getJournalContent(journalId)
	return JSON.stringify({
		id: journalId,
		name: entry?.name || 'Unknown',
		folder: entry?.folder?.name || 'Root',
		content,
	})
}

function handleGetActor(actorId: string): string {
	const actor = game.actors?.get(actorId)
	if (!actor) {
		return JSON.stringify({ error: `Actor not found: ${actorId}` })
	}

	if (!isActorFolderAllowed(actor.folder?.id)) {
		return JSON.stringify({ error: `Actor not found: ${actorId}` })
	}

	const content = collectionReader.getActorContent(actorId)
	return JSON.stringify({
		id: actorId,
		name: actor?.name || 'Unknown',
		type: actor?.type || 'Unknown',
		folder: actor?.folder?.name || 'Root',
		content,
	})
}

async function handleCreateJournal(
	name: string,
	content: string,
	folderName?: string,
	folderId?: string,
): Promise<string> {
	let resolvedFolderId = folderId || null

	if (folderName && !resolvedFolderId) {
		let folder = game.folders?.find((f: any) => f.type === 'JournalEntry' && f.name === folderName)

		if (!folder) {
			folder = await Folder.create({
				name: folderName,
				type: 'JournalEntry',
				parent: null,
			} as any)
		}

		resolvedFolderId = folder?.id || null
	}

	const journalData: any = {
		name,
		pages: [
			{
				name,
				type: 'text',
				text: { content, format: 1 },
			},
		],
	}

	if (resolvedFolderId) {
		journalData.folder = resolvedFolderId
	}

	const journal = await JournalEntry.create(journalData)
	return JSON.stringify({
		success: true,
		id: journal.id,
		name: journal.name,
		folder: folderName || 'Root',
		message: `Created journal entry "${name}" in folder "${folderName || 'Root'}"`,
	})
}

async function handleUpdateJournal(journalId: string, content: string, pageName?: string): Promise<string> {
	const entry = game.journal?.get(journalId)
	if (!entry) {
		return JSON.stringify({ error: `Journal entry not found: ${journalId}` })
	}

	if (!isJournalFolderAllowed(entry.folder?.id)) {
		return JSON.stringify({ error: `Journal entry not found: ${journalId}` })
	}

	const firstPage = entry.pages.contents?.[0]
	if (!firstPage) {
		return JSON.stringify({ error: 'Journal has no pages to update' })
	}

	const updateData: Record<string, any> = {
		'text.content': content,
	}
	if (pageName) {
		updateData.name = pageName
	}

	await firstPage.update(updateData)
	return JSON.stringify({
		success: true,
		id: journalId,
		message: `Updated journal entry "${entry.name}"`,
	})
}

function handleListJournalsInFolder(folderId: string): string {
	if (!game.journal) {
		return JSON.stringify({ error: 'Journal collection not available' })
	}

	if (!isJournalFolderAllowed(folderId)) {
		return JSON.stringify({ error: `Folder not accessible: ${folderId}` })
	}

	const entries: Array<{ id: string; name: string }> = []
	for (const entry of game.journal.values()) {
		if (entry.folder?.id === folderId) {
			entries.push({ id: entry.id, name: entry.name })
		}
	}

	const folder = game.folders?.get(folderId)
	return JSON.stringify({
		folder: folder?.name || 'Unknown',
		entries,
		count: entries.length,
	})
}

function handleListFolders(type: string): string {
	const result: Record<string, any> = {}
	const allowedJournalIds = getSetting('journalFolders') || []
	const allowedActorIds = getSetting('actorFolders') || []
	const allowedSceneIds = getSetting('sceneFolders') || []

	if (type === 'journal' || type === 'all') {
		const all = collectionReader.getJournalFolders()
		result.journalFolders = allowedJournalIds.length > 0 ? all.filter((f) => allowedJournalIds.includes(f.id)) : all
	}

	if (type === 'actor' || type === 'all') {
		const all = collectionReader.getActorFolders()
		result.actorFolders = allowedActorIds.length > 0 ? all.filter((f) => allowedActorIds.includes(f.id)) : all
	}

	if (type === 'scene' || type === 'all') {
		const all = collectionReader.getSceneFolders()
		result.sceneFolders = allowedSceneIds.length > 0 ? all.filter((f) => allowedSceneIds.includes(f.id)) : all
	}

	return JSON.stringify(result)
}

function handleGetSceneInfo(): string {
	return collectionReader.getCurrentSceneInfo()
}

async function handleRollTable(tableId: string): Promise<string> {
	const table = game.tables?.get(tableId)
	if (!table) {
		return JSON.stringify({ error: `Roll table not found: ${tableId}` })
	}

	try {
		const result = await table.draw({ displayChat: false })
		const results = result?.results?.map((r: any) => ({
			text: r.text || r.name || 'No result text',
			range: r.range,
		}))

		return JSON.stringify({
			table: table.name,
			roll: result?.roll?.total,
			results: results || [],
		})
	} catch (error: any) {
		return JSON.stringify({ error: `Failed to roll table: ${error.message}` })
	}
}

// ===============================
// SCENE TOOL HANDLERS
// ===============================

function handleListScenes(type?: string): string {
	if (!game.scenes) return JSON.stringify({ error: 'Scenes not available' })

	const scenes: Array<Record<string, any>> = []
	for (const scene of game.scenes.values()) {
		if (type === 'navigation' && !scene.navigation) continue
		if (!isSceneFolderAllowed(scene.folder?.id)) continue
		scenes.push({
			id: scene.id,
			name: scene.name,
			active: scene.active,
			navigation: scene.navigation,
			folder: scene.folder?.name || null,
			tokenCount: scene.tokens?.size || 0,
		})
	}

	return JSON.stringify({ scenes, count: scenes.length })
}

function handleViewScene(sceneId: string): string {
	const scene = game.scenes?.get(sceneId)
	if (!scene) return JSON.stringify({ error: `Scene not found: ${sceneId}` })
	if (!isSceneFolderAllowed(scene.folder?.id)) return JSON.stringify({ error: `Scene not found: ${sceneId}` })

	const details = collectionReader.getSceneDetails(sceneId)
	if (!details) return JSON.stringify({ error: `Scene not found: ${sceneId}` })
	return details
}

async function handleActivateScene(sceneId: string): Promise<string> {
	const scene = game.scenes?.get(sceneId)
	if (!scene) return JSON.stringify({ error: `Scene not found: ${sceneId}` })
	if (!isSceneFolderAllowed(scene.folder?.id)) return JSON.stringify({ error: `Scene not found: ${sceneId}` })

	await scene.activate()
	return JSON.stringify({
		success: true,
		message: `Activated scene "${scene.name}". All players have been moved to this scene.`,
	})
}

// ===============================
// DICE TOOL HANDLERS
// ===============================

async function handleRollDice(expression: string, label?: string): Promise<string> {
	try {
		const roll = new Roll(expression)
		await roll.evaluate()

		return JSON.stringify({
			formula: roll.formula,
			total: roll.total,
			result: roll.result,
			label: label || null,
			dice: roll.dice?.map((d: any) => ({
				faces: d.faces,
				results: d.results?.map((r: any) => r.result),
			})),
		})
	} catch (error: any) {
		return JSON.stringify({ error: `Invalid dice expression "${expression}": ${error.message}` })
	}
}

async function handleRollCheck(actorId: string, ability: string, type: string): Promise<string> {
	const actor = game.actors?.get(actorId)
	if (!actor) return JSON.stringify({ error: `Actor not found: ${actorId}` })

	try {
		let result: any

		if (type === 'save' && actor.rollAbilitySave) {
			result = await actor.rollAbilitySave(ability, { chatMessage: false })
		} else if (actor.rollAbilityTest) {
			result = await actor.rollAbilityTest(ability, { chatMessage: false })
		} else {
			// Fallback: manual roll with ability modifier
			const mod = actor.system?.abilities?.[ability]?.mod ?? 0
			const roll = new Roll(`1d20+${mod}`)
			await roll.evaluate()
			return JSON.stringify({
				actor: actor.name,
				type: `${ability} ${type}`,
				total: roll.total,
				formula: roll.formula,
				modifier: mod,
			})
		}

		return JSON.stringify({
			actor: actor.name,
			type: `${ability} ${type}`,
			total: result?.total ?? result?.roll?.total ?? null,
			formula: result?.formula ?? result?.roll?.formula ?? null,
		})
	} catch (error: any) {
		return JSON.stringify({ error: `Roll failed: ${error.message}` })
	}
}

// ===============================
// TOKEN TOOL HANDLERS
// ===============================

function getActiveScene(): Scene | null {
	return game.scenes?.contents?.find((s) => s.active) || canvas?.scene || null
}

function getToken(tokenId: string): TokenDocument | null {
	const scene = getActiveScene()
	if (!scene) return null
	return scene.tokens?.get(tokenId) || null
}

async function handlePlaceToken(actorId: string, x: number, y: number, hidden?: boolean): Promise<string> {
	const actor = game.actors?.get(actorId)
	if (!actor) return JSON.stringify({ error: `Actor not found: ${actorId}` })
	if (!isActorFolderAllowed(actor.folder?.id)) return JSON.stringify({ error: `Actor not found: ${actorId}` })

	const scene = getActiveScene()
	if (!scene) return JSON.stringify({ error: 'No active scene' })

	const tokenData: any = {
		name: actor.name,
		actorId: actor.id,
		x,
		y,
		hidden: hidden !== false, // Default to hidden=true
		disposition: actor.prototypeToken?.disposition ?? -1,
		texture: { src: actor.prototypeToken?.texture?.src || actor.img },
		width: actor.prototypeToken?.width ?? 1,
		height: actor.prototypeToken?.height ?? 1,
	}

	const created = await scene.createEmbeddedDocuments('Token', [tokenData])
	const token = created[0]

	return JSON.stringify({
		success: true,
		token_id: token?.id || token?._id,
		name: actor.name,
		position: { x, y },
		hidden: tokenData.hidden,
		message: `Placed "${actor.name}" at (${x}, ${y})${tokenData.hidden ? ' — HIDDEN (use reveal_token to show to players)' : ''}`,
	})
}

async function handleMoveToken(tokenId: string, x: number, y: number): Promise<string> {
	const token = getToken(tokenId)
	if (!token) return JSON.stringify({ error: `Token not found: ${tokenId}` })

	await token.update({ x, y })

	return JSON.stringify({
		success: true,
		name: token.name,
		position: { x, y },
		message: `Moved "${token.name}" to (${x}, ${y})`,
	})
}

async function handleSetTokenVisibility(tokenId: string, hidden: boolean): Promise<string> {
	const token = getToken(tokenId)
	if (!token) return JSON.stringify({ error: `Token not found: ${tokenId}` })

	await token.update({ hidden })

	return JSON.stringify({
		success: true,
		name: token.name,
		hidden,
		message: hidden ? `Hidden "${token.name}" from players` : `Revealed "${token.name}" to players`,
	})
}

async function handleRemoveToken(tokenId: string): Promise<string> {
	const scene = getActiveScene()
	if (!scene) return JSON.stringify({ error: 'No active scene' })

	const token = scene.tokens?.get(tokenId)
	if (!token) return JSON.stringify({ error: `Token not found: ${tokenId}` })

	const name = token.name
	await scene.deleteEmbeddedDocuments('Token', [tokenId])

	return JSON.stringify({
		success: true,
		message: `Removed "${name}" from the scene`,
	})
}

async function handleUpdateToken(args: Record<string, any>): Promise<string> {
	const token = getToken(args.token_id)
	if (!token) return JSON.stringify({ error: `Token not found: ${args.token_id}` })

	const updateData: Record<string, any> = {}
	if (args.name != null) updateData.name = args.name
	if (args.width != null) updateData.width = args.width
	if (args.height != null) updateData.height = args.height
	if (args.elevation != null) updateData.elevation = args.elevation
	if (args.light_dim != null || args.light_bright != null || args.light_color != null) {
		updateData.light = {
			dim: args.light_dim ?? token.light?.dim ?? 0,
			bright: args.light_bright ?? token.light?.bright ?? 0,
			color: args.light_color ?? token.light?.color ?? '',
		}
	}

	await token.update(updateData)

	return JSON.stringify({
		success: true,
		name: token.name,
		updated: Object.keys(updateData),
		message: `Updated "${token.name}"`,
	})
}

// ===============================
// COMBAT TOOL HANDLERS
// ===============================

async function handleStartCombat(tokenIds?: string[]): Promise<string> {
	const combat = await Combat.create({})
	if (!combat) return JSON.stringify({ error: 'Failed to create combat' })

	if (tokenIds?.length) {
		const scene = getActiveScene()
		const combatantData = tokenIds
			.map((tid) => {
				const token = scene?.tokens?.get(tid)
				if (!token) return null
				return { tokenId: tid, actorId: token.actorId, hidden: token.hidden }
			})
			.filter(Boolean)

		if (combatantData.length) {
			await combat.createEmbeddedDocuments('Combatant', combatantData as any)
		}
	}

	return JSON.stringify({
		success: true,
		combat_id: combat.id,
		combatants: combat.combatants?.size || 0,
		message: `Combat started${tokenIds?.length ? ` with ${tokenIds.length} combatants` : ''}. Use roll_initiative to roll initiative.`,
	})
}

async function handleEndCombat(): Promise<string> {
	const combat = game.combat
	if (!combat) return JSON.stringify({ error: 'No active combat to end' })

	await combat.endCombat()

	return JSON.stringify({
		success: true,
		message: 'Combat has ended.',
	})
}

async function handleAddToCombat(tokenIds: string[]): Promise<string> {
	const combat = game.combat
	if (!combat) return JSON.stringify({ error: 'No active combat. Use start_combat first.' })

	const scene = getActiveScene()
	const combatantData = tokenIds
		.map((tid) => {
			const token = scene?.tokens?.get(tid)
			if (!token) return null
			return { tokenId: tid, actorId: token.actorId, hidden: token.hidden }
		})
		.filter(Boolean)

	if (combatantData.length === 0) {
		return JSON.stringify({ error: 'No valid tokens found for the given IDs' })
	}

	await combat.createEmbeddedDocuments('Combatant', combatantData as any)

	return JSON.stringify({
		success: true,
		added: combatantData.length,
		total: combat.combatants?.size || 0,
		message: `Added ${combatantData.length} combatants to the encounter.`,
	})
}

async function handleRemoveFromCombat(combatantIds: string[]): Promise<string> {
	const combat = game.combat
	if (!combat) return JSON.stringify({ error: 'No active combat' })

	await combat.deleteEmbeddedDocuments('Combatant', combatantIds)

	return JSON.stringify({
		success: true,
		removed: combatantIds.length,
		message: `Removed ${combatantIds.length} combatants from combat.`,
	})
}

async function handleNextTurn(): Promise<string> {
	const combat = game.combat
	if (!combat) return JSON.stringify({ error: 'No active combat' })

	if (!combat.started) {
		await combat.startCombat()
		return JSON.stringify({
			success: true,
			round: combat.round,
			turn: combat.turn,
			current: combat.combatant?.name || 'Unknown',
			message: `Combat started! Round ${combat.round}, ${combat.combatant?.name || 'Unknown'}'s turn.`,
		})
	}

	await combat.nextTurn()

	return JSON.stringify({
		success: true,
		round: combat.round,
		turn: combat.turn,
		current: combat.combatant?.name || 'Unknown',
		message: `Round ${combat.round}: ${combat.combatant?.name || 'Unknown'}'s turn.`,
	})
}

async function handleRollInitiative(combatantIds?: string[]): Promise<string> {
	const combat = game.combat
	if (!combat) return JSON.stringify({ error: 'No active combat' })

	// If no IDs specified, roll for all unrolled combatants
	let ids = combatantIds
	if (!ids?.length) {
		ids = Array.from(combat.combatants.values())
			.filter((c: any) => c.initiative == null)
			.map((c: any) => c.id)
	}

	if (ids.length === 0) {
		return JSON.stringify({ message: 'All combatants already have initiative.' })
	}

	await combat.rollInitiative(ids)

	const order = Array.from(combat.combatants.values())
		.sort((a: any, b: any) => (b.initiative ?? -999) - (a.initiative ?? -999))
		.map((c: any) => ({ name: c.name, initiative: c.initiative }))

	return JSON.stringify({
		success: true,
		rolled: ids.length,
		order,
		message: `Rolled initiative for ${ids.length} combatants.`,
	})
}

async function handleApplyDamage(tokenId: string, amount: number, type: string): Promise<string> {
	const token = getToken(tokenId)
	if (!token) return JSON.stringify({ error: `Token not found: ${tokenId}` })

	const actor = token.actor
	if (!actor) return JSON.stringify({ error: `Token "${token.name}" has no associated actor` })

	const hp = actor.system?.attributes?.hp
	if (hp == null) return JSON.stringify({ error: `Cannot access HP for "${actor.name}"` })

	const currentHp = hp.value ?? 0
	const maxHp = hp.max ?? currentHp

	let newHp: number
	if (type === 'healing') {
		newHp = Math.min(currentHp + amount, maxHp)
	} else {
		newHp = Math.max(currentHp - amount, 0)
	}

	await actor.update({ 'system.attributes.hp.value': newHp })

	return JSON.stringify({
		success: true,
		name: actor.name,
		previousHp: currentHp,
		newHp,
		maxHp,
		change: type === 'healing' ? `+${amount}` : `-${amount}`,
		message: `${type === 'healing' ? 'Healed' : 'Damaged'} "${actor.name}" for ${amount} HP (${currentHp} → ${newHp}/${maxHp})`,
	})
}

async function handleApplyCondition(tokenId: string, condition: string): Promise<string> {
	const token = getToken(tokenId)
	if (!token) return JSON.stringify({ error: `Token not found: ${tokenId}` })

	const actor = token.actor
	if (!actor) return JSON.stringify({ error: `Token "${token.name}" has no associated actor` })

	// Try to find matching status effect in CONFIG
	const conditionLower = condition.toLowerCase()
	const statusEffect = CONFIG.statusEffects?.find(
		(e: any) => e.id?.toLowerCase() === conditionLower || e.name?.toLowerCase() === conditionLower,
	)

	if (statusEffect) {
		// Use Foundry's built-in status effect
		const effectData: Record<string, any> = {
			name: statusEffect.name || condition,
			icon: statusEffect.icon || 'icons/svg/aura.svg',
			'flags.core.statusId': statusEffect.id,
			statuses: [statusEffect.id],
		}
		await actor.createEmbeddedDocuments('ActiveEffect', [effectData] as any)
	} else {
		// Create a custom effect
		const effectData: Record<string, any> = {
			name: condition.charAt(0).toUpperCase() + condition.slice(1),
			icon: 'icons/svg/aura.svg',
			statuses: [conditionLower],
		}
		await (actor as any).createEmbeddedDocuments('ActiveEffect', [effectData])
	}

	return JSON.stringify({
		success: true,
		name: actor.name,
		condition,
		message: `Applied "${condition}" to "${actor.name}"`,
	})
}

async function handleRemoveCondition(tokenId: string, condition: string): Promise<string> {
	const token = getToken(tokenId)
	if (!token) return JSON.stringify({ error: `Token not found: ${tokenId}` })

	const actor = token.actor
	if (!actor) return JSON.stringify({ error: `Token "${token.name}" has no associated actor` })

	const conditionLower = condition.toLowerCase()
	const effect = Array.from(actor.effects.values()).find(
		(e: any) =>
			e.name?.toLowerCase() === conditionLower ||
			e.statuses?.has?.(conditionLower) ||
			e.flags?.core?.statusId?.toLowerCase() === conditionLower,
	)

	if (!effect) {
		return JSON.stringify({ error: `Condition "${condition}" not found on "${actor.name}"` })
	}

	await effect.delete()

	return JSON.stringify({
		success: true,
		name: actor.name,
		condition,
		message: `Removed "${condition}" from "${actor.name}"`,
	})
}

// ===============================
// AUDIO TOOL HANDLERS
// ===============================

function handleListPlaylists(): string {
	if (!game.playlists) return JSON.stringify({ error: 'Playlists not available' })

	const playlists: Array<Record<string, any>> = []
	for (const playlist of game.playlists.values()) {
		const tracks = Array.from(playlist.sounds?.values() || []).map((s: any) => ({
			name: s.name,
			playing: s.playing || false,
		}))

		playlists.push({
			id: playlist.id,
			name: playlist.name,
			playing: playlist.playing,
			trackCount: tracks.length,
			tracks,
		})
	}

	return JSON.stringify({ playlists, count: playlists.length })
}

async function handlePlayPlaylist(playlistId: string): Promise<string> {
	const playlist = game.playlists?.get(playlistId)
	if (!playlist) return JSON.stringify({ error: `Playlist not found: ${playlistId}` })

	await playlist.playAll()

	return JSON.stringify({
		success: true,
		name: playlist.name,
		message: `Now playing "${playlist.name}"`,
	})
}

async function handleStopPlaylist(playlistId?: string): Promise<string> {
	if (playlistId) {
		const playlist = game.playlists?.get(playlistId)
		if (!playlist) return JSON.stringify({ error: `Playlist not found: ${playlistId}` })

		await playlist.stopAll()

		return JSON.stringify({
			success: true,
			message: `Stopped "${playlist.name}"`,
		})
	}

	// Stop all playlists
	if (game.playlists) {
		for (const playlist of game.playlists.values()) {
			if (playlist.playing) {
				await playlist.stopAll()
			}
		}
	}

	return JSON.stringify({
		success: true,
		message: 'Stopped all playlists',
	})
}

async function handlePlayTrack(playlistId: string, trackName: string): Promise<string> {
	const playlist = game.playlists?.get(playlistId)
	if (!playlist) return JSON.stringify({ error: `Playlist not found: ${playlistId}` })

	const sound = Array.from(playlist.sounds?.values() || []).find(
		(s: any) => s.name?.toLowerCase() === trackName.toLowerCase(),
	)

	if (!sound) return JSON.stringify({ error: `Track "${trackName}" not found in "${playlist.name}"` })

	await playlist.playSound(sound)

	return JSON.stringify({
		success: true,
		playlist: playlist.name,
		track: sound.name,
		message: `Now playing "${sound.name}" from "${playlist.name}"`,
	})
}

// ===============================
// CHAT TOOL HANDLERS
// ===============================

async function handlePostChatMessage(content: string, speakerName?: string, whisperTo?: string[]): Promise<string> {
	const messageData: Record<string, any> = { content }

	if (speakerName) {
		messageData.speaker = { alias: speakerName }
	}

	if (whisperTo?.length) {
		// Resolve player names to user IDs
		const userIds = whisperTo
			.map((name) => {
				const user = game.users?.find((u: any) => u.name?.toLowerCase() === name.toLowerCase())
				return user?.id
			})
			.filter(Boolean) as string[]

		if (userIds.length) {
			messageData.whisper = userIds
		}
	}

	const msg = await ChatMessage.create(messageData)

	return JSON.stringify({
		success: true,
		id: msg.id,
		message: speakerName
			? `Posted message as "${speakerName}"${whisperTo?.length ? ` (whispered to ${whisperTo.join(', ')})` : ''}`
			: `Posted narration to chat${whisperTo?.length ? ` (whispered to ${whisperTo.join(', ')})` : ''}`,
	})
}

// ===============================
// COMPENDIUM TOOL HANDLERS
// ===============================

async function handleSearchCompendium(query: string, type?: string, maxResults?: number): Promise<string> {
	if (!game.packs) return JSON.stringify({ error: 'Compendium packs not available' })

	const max = maxResults || 10
	const queryLower = query.toLowerCase()
	const results: Array<Record<string, any>> = []

	for (const [packId, pack] of game.packs) {
		if (type && type !== 'all' && pack.documentName !== type) continue

		// Ensure index is loaded
		try {
			await pack.getIndex()
		} catch {
			continue
		}

		for (const [, entry] of pack.index) {
			if (entry.name?.toLowerCase().includes(queryLower)) {
				results.push({
					pack_id: packId,
					entry_id: entry._id,
					name: entry.name,
					type: pack.documentName,
					pack_label: pack.metadata.label,
					img: entry.img || null,
				})

				if (results.length >= max) break
			}
		}

		if (results.length >= max) break
	}

	return JSON.stringify({ results, count: results.length })
}

async function handleGetCompendiumEntry(packId: string, entryId: string): Promise<string> {
	if (!game.packs) return JSON.stringify({ error: 'Compendium packs not available' })

	const pack = game.packs.get(packId)
	if (!pack) return JSON.stringify({ error: `Pack not found: ${packId}` })

	try {
		const doc = await pack.getDocument(entryId)
		if (!doc) return JSON.stringify({ error: `Entry not found: ${entryId}` })

		// Extract based on document type
		if (pack.documentName === 'Actor') {
			const content = collectionReader.getActorContent(doc.id) || collectionReader['extractActorContent'](doc as any)
			return JSON.stringify({
				id: doc.id,
				name: doc.name,
				type: (doc as any).type || pack.documentName,
				pack: packId,
				content: content || `Actor: ${doc.name}`,
			})
		}

		if (pack.documentName === 'Item') {
			const item = doc as any
			return JSON.stringify({
				id: doc.id,
				name: doc.name,
				type: item.type || 'item',
				pack: packId,
				description: item.system?.description?.value || '',
				img: item.img || null,
			})
		}

		if (pack.documentName === 'JournalEntry') {
			const content = collectionReader.getJournalContent(doc.id) || `Journal: ${doc.name}`
			return JSON.stringify({
				id: doc.id,
				name: doc.name,
				type: 'JournalEntry',
				pack: packId,
				content,
			})
		}

		return JSON.stringify({
			id: doc.id,
			name: doc.name,
			type: pack.documentName,
			pack: packId,
		})
	} catch (error: any) {
		return JSON.stringify({ error: `Failed to load entry: ${error.message}` })
	}
}

async function handleImportFromCompendium(packId: string, entryId: string, folderId?: string): Promise<string> {
	if (!game.packs) return JSON.stringify({ error: 'Compendium packs not available' })

	const pack = game.packs.get(packId)
	if (!pack) return JSON.stringify({ error: `Pack not found: ${packId}` })

	try {
		const doc = await pack.getDocument(entryId)
		if (!doc) return JSON.stringify({ error: `Entry not found: ${entryId}` })

		const importData: Record<string, any> = { folder: folderId || null }
		const imported = await pack.importDocument(doc, importData)

		return JSON.stringify({
			success: true,
			id: imported.id,
			name: imported.name,
			type: pack.documentName,
			message: `Imported "${imported.name}" from compendium "${pack.metadata.label}" into the world.`,
		})
	} catch (error: any) {
		return JSON.stringify({ error: `Import failed: ${error.message}` })
	}
}

// ===============================
// SPATIAL TOOL HANDLERS
// ===============================

function handleMeasureDistance(args: Record<string, any>): string {
	const scene = getActiveScene()
	if (!scene) return JSON.stringify({ error: 'No active scene' })

	let fromX: number, fromY: number, toX: number, toY: number

	if (args.from_token_id) {
		const token = scene.tokens?.get(args.from_token_id)
		if (!token) return JSON.stringify({ error: `Token not found: ${args.from_token_id}` })
		fromX = token.x
		fromY = token.y
	} else {
		fromX = args.from_x ?? 0
		fromY = args.from_y ?? 0
	}

	if (args.to_token_id) {
		const token = scene.tokens?.get(args.to_token_id)
		if (!token) return JSON.stringify({ error: `Token not found: ${args.to_token_id}` })
		toX = token.x
		toY = token.y
	} else {
		toX = args.to_x ?? 0
		toY = args.to_y ?? 0
	}

	// Calculate pixel distance, then convert to grid units
	const dx = toX - fromX
	const dy = toY - fromY
	const pixelDist = Math.sqrt(dx * dx + dy * dy)
	const gridSize = scene.grid?.size || 100
	const gridDistance = scene.grid?.distance || 5
	const units = scene.grid?.units || 'ft'
	const distance = Math.round((pixelDist / gridSize) * gridDistance)

	return JSON.stringify({
		distance,
		units,
		pixels: Math.round(pixelDist),
		message: `Distance: ${distance} ${units}`,
	})
}

function handleTokensInRange(args: Record<string, any>): string {
	const scene = getActiveScene()
	if (!scene) return JSON.stringify({ error: 'No active scene' })

	let centerX: number, centerY: number

	if (args.token_id) {
		const token = scene.tokens?.get(args.token_id)
		if (!token) return JSON.stringify({ error: `Token not found: ${args.token_id}` })
		centerX = token.x
		centerY = token.y
	} else {
		centerX = args.x ?? 0
		centerY = args.y ?? 0
	}

	const range = args.range
	const gridSize = scene.grid?.size || 100
	const gridDistance = scene.grid?.distance || 5
	const rangePixels = (range / gridDistance) * gridSize

	const tokensInRange: Array<Record<string, any>> = []

	for (const token of scene.tokens?.values() || []) {
		if (args.token_id && token.id === args.token_id) continue // Skip self

		const dx = token.x - centerX
		const dy = token.y - centerY
		const dist = Math.sqrt(dx * dx + dy * dy)

		if (dist <= rangePixels) {
			const gridDist = Math.round((dist / gridSize) * gridDistance)
			const disp = token.disposition === 1 ? 'friendly' : token.disposition === 0 ? 'neutral' : 'hostile'

			tokensInRange.push({
				token_id: token.id,
				name: token.name,
				distance: gridDist,
				disposition: disp,
				hidden: token.hidden,
			})
		}
	}

	tokensInRange.sort((a, b) => a.distance - b.distance)

	return JSON.stringify({
		center: args.token_id ? `token ${args.token_id}` : `(${centerX}, ${centerY})`,
		range: `${range} ${scene.grid?.units || 'ft'}`,
		tokens: tokensInRange,
		count: tokensInRange.length,
	})
}

async function handleCreateMeasuredTemplate(args: Record<string, any>): Promise<string> {
	const scene = getActiveScene()
	if (!scene) return JSON.stringify({ error: 'No active scene' })

	const templateData: Record<string, any> = {
		t: args.type,
		x: args.x,
		y: args.y,
		distance: args.distance,
		direction: args.direction ?? 0,
		angle: args.type === 'cone' ? 53.13 : 360,
		width: args.width ?? 5,
		fillColor: args.color || '#FF0000',
	}

	const created = await scene.createEmbeddedDocuments('MeasuredTemplate', [templateData])

	return JSON.stringify({
		success: true,
		template_id: created[0]?.id,
		type: args.type,
		position: { x: args.x, y: args.y },
		distance: args.distance,
		message: `Created ${args.type} template (${args.distance}${scene.grid?.units || 'ft'}) at (${args.x}, ${args.y})`,
	})
}
