/* ==========================================================================
   Chat Session Manager
   Persists raw chat conversations as JournalEntry documents in a dedicated
   "FoundryAI Chat History" folder.
   ========================================================================== */

import type { LLMMessage } from './openrouter-service'

const MODULE_ID = 'foundry-ai'
const CHAT_HISTORY_FOLDER_NAME = 'FoundryAI Chat History'

export interface ChatSession {
	id: string // JournalEntry document ID
	name: string // Session title
	messages: LLMMessage[] // Full conversation
	createdAt: number // Epoch ms
	updatedAt: number // Epoch ms
	model: string // Model used for this session
	tokenCount?: number // Approximate total tokens
}

export interface SessionSummary {
	id: string
	name: string
	createdAt: number
	updatedAt: number
	messageCount: number
	model: string
}

class ChatSessionManager {
	private folderCache: string | null = null

	/** Get or create the chat history folder */
	async getChatHistoryFolder(): Promise<any> {
		// Check settings for configured folder first
		const configuredFolderId = this.getConfiguredFolderId()
		if (configuredFolderId) {
			const folder = game.folders?.get(configuredFolderId)
			if (folder) return folder
		}

		// Find existing folder
		if (this.folderCache) {
			const cached = game.folders?.get(this.folderCache)
			if (cached) return cached
		}

		const existing = game.folders?.find((f: Folder) => f.name === CHAT_HISTORY_FOLDER_NAME && f.type === 'JournalEntry')

		if (existing) {
			this.folderCache = existing.id
			return existing
		}

		// Create folder
		const folder = await Folder.create({
			name: CHAT_HISTORY_FOLDER_NAME,
			type: 'JournalEntry',
			color: '#5e4fa2',
		})

		this.folderCache = folder.id
		return folder
	}

	/** Create a new chat session */
	async createSession(name?: string): Promise<ChatSession> {
		const folder = await this.getChatHistoryFolder()
		const now = Date.now()
		const sessionName = name || `Chat ${new Date(now).toLocaleString()}`

		const journal = await JournalEntry.create({
			name: sessionName,
			folder: folder.id,
			pages: [
				{
					name: 'Chat Log',
					type: 'text',
					text: { content: '', format: 1 },
				},
			],
			flags: {
				[MODULE_ID]: {
					type: 'chat-session',
					messages: [],
					createdAt: now,
					updatedAt: now,
					model: '',
					tokenCount: 0,
				},
			},
		})

		return {
			id: journal.id,
			name: sessionName,
			messages: [],
			createdAt: now,
			updatedAt: now,
			model: '',
		}
	}

	/** Save a message to a session */
	async saveMessage(sessionId: string, message: LLMMessage, model?: string): Promise<void> {
		const entry = game.journal?.get(sessionId)
		if (!entry) throw new Error(`Chat session not found: ${sessionId}`)

		const flags = (entry.flags?.[MODULE_ID] as Record<string, any>) || {}
		const messages: LLMMessage[] = [...(flags.messages || []), message]
		const now = Date.now()

		// Update flags with new message
		await entry.update({
			flags: {
				[MODULE_ID]: {
					...flags,
					messages,
					updatedAt: now,
					model: model || flags.model || '',
				},
			},
		})

		// Also update the visual page content with formatted messages
		await this.updatePageContent(entry, messages)
	}

	/** Save multiple messages at once (e.g. user + assistant pair) */
	async saveMessages(sessionId: string, newMessages: LLMMessage[], model?: string): Promise<void> {
		const entry = game.journal?.get(sessionId)
		if (!entry) throw new Error(`Chat session not found: ${sessionId}`)

		const flags = (entry.flags?.[MODULE_ID] as Record<string, any>) || {}
		const messages: LLMMessage[] = [...(flags.messages || []), ...newMessages]
		const now = Date.now()

		await entry.update({
			flags: {
				[MODULE_ID]: {
					...flags,
					messages,
					updatedAt: now,
					model: model || flags.model || '',
				},
			},
		})

		await this.updatePageContent(entry, messages)
	}

	/** Replace the entire message array for a session (used after edits, retries, tool calls, etc.) */
	async saveFullConversation(sessionId: string, allMessages: LLMMessage[], model?: string): Promise<void> {
		const entry = game.journal?.get(sessionId)
		if (!entry) throw new Error(`Chat session not found: ${sessionId}`)

		const flags = (entry.flags?.[MODULE_ID] as Record<string, any>) || {}
		const now = Date.now()

		await entry.update({
			flags: {
				[MODULE_ID]: {
					...flags,
					messages: allMessages,
					updatedAt: now,
					model: model || flags.model || '',
				},
			},
		})

		await this.updatePageContent(entry, allMessages)
	}

	/** Load a session by ID */
	loadSession(sessionId: string): ChatSession | null {
		const entry = game.journal?.get(sessionId)
		if (!entry) return null

		const flags = entry.flags?.[MODULE_ID] as Record<string, any>
		if (!flags || flags.type !== 'chat-session') return null

		return {
			id: entry.id,
			name: entry.name,
			messages: flags.messages || [],
			createdAt: flags.createdAt || 0,
			updatedAt: flags.updatedAt || 0,
			model: flags.model || '',
			tokenCount: flags.tokenCount,
		}
	}

	/** List all chat sessions (most recent first) */
	listSessions(): SessionSummary[] {
		if (!game.journal) return []

		const sessions: SessionSummary[] = []

		for (const entry of game.journal.values()) {
			const flags = entry.flags?.[MODULE_ID] as Record<string, any>
			if (!flags || flags.type !== 'chat-session') continue

			sessions.push({
				id: entry.id,
				name: entry.name,
				createdAt: flags.createdAt || 0,
				updatedAt: flags.updatedAt || 0,
				messageCount: (flags.messages || []).length,
				model: flags.model || '',
			})
		}

		sessions.sort((a, b) => b.updatedAt - a.updatedAt)
		return sessions
	}

	/** Delete a chat session */
	async deleteSession(sessionId: string): Promise<void> {
		const entry = game.journal?.get(sessionId)
		if (!entry) throw new Error(`Chat session not found: ${sessionId}`)

		await entry.delete()
	}

	/** Rename a session */
	async renameSession(sessionId: string, newName: string): Promise<void> {
		const entry = game.journal?.get(sessionId)
		if (!entry) throw new Error(`Chat session not found: ${sessionId}`)

		await entry.update({ name: newName })
	}

	/** Get the raw message array for a session (for continuing a conversation) */
	getMessages(sessionId: string): LLMMessage[] {
		const session = this.loadSession(sessionId)
		return session?.messages || []
	}

	// ---- Private Helpers ----

	private getConfiguredFolderId(): string | null {
		try {
			return (game.settings?.get(MODULE_ID, 'chatHistoryFolder') as string) || null
		} catch {
			return null
		}
	}

	/** Update the journal page with nicely formatted HTML of the conversation */
	private async updatePageContent(entry: JournalEntry, messages: LLMMessage[]): Promise<void> {
		const firstPage = entry.pages?.contents?.[0]
		if (!firstPage) return

		const html = this.formatMessagesAsHtml(messages)
		await firstPage.update({ 'text.content': html })
	}

	/** Format messages as readable HTML for the journal page */
	private formatMessagesAsHtml(messages: LLMMessage[]): string {
		const lines: string[] = []

		for (const msg of messages) {
			if (msg.role === 'system') continue // Skip system prompts in visual display

			const roleName = msg.role === 'user' ? '🧑 You' : msg.role === 'assistant' ? '🤖 FoundryAI' : `🔧 ${msg.role}`

			const style =
				msg.role === 'user'
					? 'background:#1a1a2e; border-left:3px solid #e94560; padding:8px 12px; margin:4px 0; border-radius:4px;'
					: msg.role === 'assistant'
						? 'background:#16213e; border-left:3px solid #0f3460; padding:8px 12px; margin:4px 0; border-radius:4px;'
						: 'background:#1a1a1a; padding:4px 8px; margin:2px 0; font-size:0.9em; opacity:0.7;'

			const content = typeof msg.content === 'string' ? msg.content : ''
			// Basic markdown-ish to HTML for the journal view
			const formattedContent = content
				.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/\n/g, '<br>')
				.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
				.replace(/\*(.*?)\*/g, '<em>$1</em>')
				.replace(/`(.*?)`/g, '<code>$1</code>')

			lines.push(`<div style="${style}"><strong>${roleName}</strong><br>${formattedContent}</div>`)
		}

		return lines.join('\n')
	}
}

export const chatSessionManager = new ChatSessionManager()
