/* ==========================================================================
   FoundryAI — Module Entry Point
   Registers hooks, settings, sidebar tab, and exposes the public API.
   ========================================================================== */

import { registerSettings, getSetting } from './settings'
import { openRouterService } from '@core/openrouter-service'
import { embeddingService } from '@core/embedding-service'
import { chatSessionManager } from '@core/chat-session-manager'
import { sessionRecapManager } from '@core/session-recap-manager'
import { openPopoutChat } from '@ui/svelte-application'
import { buildSystemPrompt } from '@core/system-prompt'
import ChatWindow from '@ui/components/ChatWindow.svelte'

// Import styles so Vite bundles them
import './styles/foundry-ai.scss'

const MODULE_ID = 'foundry-ai'

// ---- Module Initialization ----

Hooks.once('init', () => {
	console.log('FoundryAI | Initializing module...')

	// Register settings
	registerSettings()

	// Register scene control button (must be before first render)
	registerSceneControlButton()

	// Register sidebar tab icon via Sidebar.TABS + changeTab intercept
	registerSidebarTab()
})

Hooks.once('ready', async () => {
	console.log('FoundryAI | Module ready.')

	// Only proceed for GM
	if (!game.user?.isGM) {
		console.log('FoundryAI | Non-GM user, skipping initialization.')
		return
	}

	// Configure OpenRouter service
	const apiKey = getSetting('apiKey')
	if (apiKey) {
		openRouterService.configure({
			apiKey,
			defaultModel: getSetting('chatModel'),
			embeddingModel: getSetting('embeddingModel'),
		})
	}

	// Initialize embedding service
	try {
		const worldId = game.world?.id || 'default'
		await embeddingService.initialize(worldId)
		console.log('FoundryAI | Embedding service initialized.')
	} catch (error) {
		console.error('FoundryAI | Failed to initialize embedding service:', error)
	}

	// Auto-index if configured
	if (apiKey && getSetting('autoIndex')) {
		const journalFolders = getSetting('journalFolders') || []
		const actorFolders = getSetting('actorFolders') || []

		if (journalFolders.length > 0 || actorFolders.length > 0) {
			// Delay indexing slightly to not block UI
			setTimeout(async () => {
				try {
					console.log('FoundryAI | Starting auto-index...')
					await embeddingService.reindexAll(journalFolders, actorFolders)
					console.log('FoundryAI | Auto-index complete.')
				} catch (error) {
					console.error('FoundryAI | Auto-index failed:', error)
				}
			}, 5000)
		}
	}

	// Expose public API
	game.foundryAI = {
		chat: publicChat,
		openChat: () => openPopoutChat(ChatWindow),
		reindex: publicReindex,
		generateSessionRecap: publicGenerateRecap,
	}

	// Listen for settings changes
	Hooks.on(`${MODULE_ID}.settingsChanged`, (key: string) => {
		if (key === 'apiKey') {
			const newKey = getSetting('apiKey')
			if (newKey) openRouterService.configure({
				apiKey: newKey,
				defaultModel: getSetting('chatModel'),
				embeddingModel: getSetting('embeddingModel'),
			})
		}
	})

	// Notification
	ui.notifications.info('FoundryAI is ready! Click the brain icon to start chatting.')
})

// ---- Sidebar Tab Registration ----

/**
 * Register a brain icon in the right-side sidebar tab bar by adding an entry
 * to Sidebar.TABS and intercepting the tab change to open the chat popout.
 */
function registerSidebarTab() {
	try {
		const SidebarClass = foundry.applications.sidebar.Sidebar as any

		// Add our tab descriptor to the static TABS record
		// This makes Foundry render a brain icon in the sidebar tab bar
		SidebarClass.TABS[MODULE_ID] = {
			icon: 'fas fa-brain',
			tooltip: 'FoundryAI Chat',
			gmOnly: true,
		}

		// Monkey-patch changeTab to intercept clicks on our fake tab
		const origChangeTab = SidebarClass.prototype.changeTab
		SidebarClass.prototype.changeTab = function (tab: string, group: string, options: any = {}) {
			if (tab === MODULE_ID) {
				// Don't actually switch tabs — just open the popout window
				openPopoutChat(ChatWindow)
				return
			}
			return origChangeTab.call(this, tab, group, options)
		}

		console.log('FoundryAI | Sidebar tab registered via Sidebar.TABS')
	} catch (err) {
		console.error('FoundryAI | Failed to register sidebar tab:', err)
	}
}

// ---- Scene Controls Button ----

/**
 * Register a brain button in the scene controls (left toolbar).
 * Uses the v13 Record-based API: controls.tokens.tools[id] = SceneControlTool
 * Per the API: onChange(event, active) is the callback for tool activation.
 */
function registerSceneControlButton() {
	Hooks.on('getSceneControlButtons', (controls: any) => {
		const tokenGroup = controls.tokens ?? controls.token
		if (tokenGroup?.tools) {
			tokenGroup.tools[MODULE_ID] = {
				name: MODULE_ID,
				title: 'FoundryAI Chat',
				icon: 'fas fa-brain',
				button: true,
				order: 100,
				onChange: (_event: Event, _active: boolean) => {
					openPopoutChat(ChatWindow)
				},
			}
		}
	})
}

// ---- Public API Implementation ----

async function publicChat(message: string): Promise<string> {
	const apiKey = getSetting('apiKey')
	if (!apiKey) throw new Error('OpenRouter API key not configured.')

	const response = await openRouterService.chatCompletion({
		model: getSetting('chatModel'),
		messages: [
			{ role: 'system', content: buildSystemPrompt() },
			{ role: 'user', content: message },
		],
		temperature: getSetting('temperature'),
		max_tokens: getSetting('maxTokens'),
	})

	return response.choices?.[0]?.message?.content || ''
}

async function publicReindex(): Promise<void> {
	const journalFolders = getSetting('journalFolders') || []
	const actorFolders = getSetting('actorFolders') || []
	await embeddingService.reindexAll(journalFolders, actorFolders)
}

async function publicGenerateRecap(): Promise<void> {
	const sessions = chatSessionManager.listSessions()
	if (sessions.length === 0) {
		ui.notifications.warn('No chat sessions available for recap.')
		return
	}

	// Use today's sessions
	const today = new Date()
	today.setHours(0, 0, 0, 0)
	const todaySessions = sessions.filter((s) => s.updatedAt >= today.getTime())
	const sessionIds = todaySessions.length > 0 ? todaySessions.map((s) => s.id) : [sessions[0].id]

	const model = getSetting('chatModel')
	await sessionRecapManager.generateRecap(sessionIds, model)
	ui.notifications.info('Session recap generated!')
}
