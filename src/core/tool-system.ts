/* ==========================================================================
   Tool System - OpenAI-compatible function calling tools for the LLM
   ========================================================================== */

import { embeddingService } from './embedding-service'
import { collectionReader } from './collection-reader'
import type { ToolDefinition, ToolCall } from './openrouter-service'

// ---- Tool Definitions (OpenAI function calling format) ----

export const TOOL_DEFINITIONS: ToolDefinition[] = [
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
			description: 'List all journal and actor folders available in the world.',
			parameters: {
				type: 'object',
				properties: {
					type: {
						type: 'string',
						enum: ['journal', 'actor', 'all'],
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
			description: 'Get information about the currently active scene including tokens, notes, and other details.',
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

// ---- Tool Execution ----

export async function executeTool(toolCall: ToolCall): Promise<string> {
	const funcName = toolCall.function.name
	let args: Record<string, any>

	try {
		args = JSON.parse(toolCall.function.arguments)
	} catch {
		return JSON.stringify({ error: `Invalid arguments for tool ${funcName}` })
	}

	try {
		switch (funcName) {
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

			default:
				return JSON.stringify({ error: `Unknown tool: ${funcName}` })
		}
	} catch (error: any) {
		return JSON.stringify({ error: `Tool execution failed: ${error.message}` })
	}
}

// ---- Tool Handlers ----

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
	const content = collectionReader.getJournalContent(journalId)
	if (!content) {
		return JSON.stringify({ error: `Journal entry not found: ${journalId}` })
	}

	const entry = game.journal?.get(journalId)
	return JSON.stringify({
		id: journalId,
		name: entry?.name || 'Unknown',
		folder: entry?.folder?.name || 'Root',
		content,
	})
}

function handleGetActor(actorId: string): string {
	const content = collectionReader.getActorContent(actorId)
	if (!content) {
		return JSON.stringify({ error: `Actor not found: ${actorId}` })
	}

	const actor = game.actors?.get(actorId)
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
	// Resolve folder: prefer folderName, fall back to folderId
	let resolvedFolderId = folderId || null

	if (folderName && !resolvedFolderId) {
		// Find existing folder by name
		let folder = game.folders?.find((f: any) => f.type === 'JournalEntry' && f.name === folderName)

		// Create folder if it doesn't exist
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
				text: { content, format: 1 }, // 1 = HTML
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

	// Update the first page
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

	if (type === 'journal' || type === 'all') {
		result.journalFolders = collectionReader.getJournalFolders()
	}

	if (type === 'actor' || type === 'all') {
		result.actorFolders = collectionReader.getActorFolders()
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
