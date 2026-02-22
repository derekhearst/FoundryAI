/* ==========================================================================
   FoundryAI — Module Entry Point
   Registers hooks, settings, sidebar tab, and exposes the public API.
   ========================================================================== */

import { registerSettings, getSetting } from './settings'
import { openRouterService } from '@core/openrouter-service'
import { embeddingService } from '@core/embedding-service'
import { chatSessionManager } from '@core/chat-session-manager'
import { sessionRecapManager } from '@core/session-recap-manager'
import { SvelteSidebarTab, openPopoutChat, openSettingsDialog } from '@ui/svelte-application'
import { buildSystemPrompt } from '@core/system-prompt'
import ChatWindow from '@ui/components/ChatWindow.svelte'
import SettingsPanel from '@ui/components/SettingsPanel.svelte'

// Import styles so Vite bundles them
import './styles/foundry-ai.scss'

const MODULE_ID = 'foundry-ai'

// ---- Module Initialization ----

Hooks.once('init', () => {
	console.log('FoundryAI | Initializing module...')

	// Register settings
	registerSettings()

	// Register sidebar tab
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
		openRouterService.configure({ apiKey })
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

	// Add module control button
	registerSceneControlButton()

	// Listen for settings changes
	Hooks.on(`${MODULE_ID}.settingsChanged`, (key: string) => {
		if (key === 'apiKey') {
			const newKey = getSetting('apiKey')
			if (newKey) openRouterService.configure({ apiKey: newKey })
		}
	})

	// Notification
	ui.notifications.info('FoundryAI is ready! Click the brain icon to start chatting.')
})

// ---- Sidebar Tab Registration ----

function registerSidebarTab() {
	// Add the FoundryAI tab to the sidebar
	Hooks.on('renderSidebar', (_app: any, html: HTMLElement) => {
		// Check if tab already exists
		if (html.querySelector('[data-tab="foundry-ai"]')) return

		const sidebar = ui.sidebar
		if (!sidebar) return

		// Use Foundry's tab registration system
		const tabConfig: SidebarTabDescriptor = {
			id: MODULE_ID,
			icon: 'fas fa-brain',
			label: 'FoundryAI',
			cls: createSidebarTabClass(),
			order: 100,
		}

		// Register the tab descriptor
		if (typeof foundry.applications.sidebar.Sidebar.TABS === 'object') {
			foundry.applications.sidebar.Sidebar.TABS[MODULE_ID] = tabConfig
		}
	})

	// Alternative: Add tab button manually after sidebar renders
	Hooks.on('renderSidebarV2', (_app: any, html: HTMLElement) => {
		injectSidebarTab(html)
	})

	// Also try with the generic render hook (for compatibility)
	Hooks.on('changeSidebarTab', (_tab: any) => {
		// Opportunity to refresh our tab if needed
	})
}

/**
 * Create a sidebar tab class wired to the ChatWindow Svelte component.
 */
function createSidebarTabClass(): typeof foundry.applications.sidebar.AbstractSidebarTab {
	return class FoundryAISidebarTab extends SvelteSidebarTab {
		constructor(options: Partial<ApplicationConfiguration> = {}) {
			super(ChatWindow, {}, options)
		}

		static override tabName = MODULE_ID

		static override DEFAULT_OPTIONS = {
			...SvelteSidebarTab.DEFAULT_OPTIONS,
			id: 'foundry-ai-sidebar',
			classes: ['foundry-ai'],
		}
	} as any
}

/**
 * Fallback: Manually inject a tab button into the sidebar navigation.
 */
function injectSidebarTab(sidebarHtml: HTMLElement) {
	const nav = sidebarHtml.querySelector('.sidebar-tabs, nav.tabs')
	if (!nav) return

	// Don't add if already present
	if (nav.querySelector('[data-tab="foundry-ai"]')) return

	const tabButton = document.createElement('a')
	tabButton.classList.add('item')
	tabButton.setAttribute('data-tab', MODULE_ID)
	tabButton.setAttribute('data-tooltip', 'FoundryAI')
	tabButton.innerHTML = '<i class="fas fa-brain"></i>'
	tabButton.addEventListener('click', (e) => {
		e.preventDefault()
		openPopoutChat(ChatWindow)
	})

	nav.appendChild(tabButton)
}

// ---- Scene Controls Button ----

function registerSceneControlButton() {
	Hooks.on('getSceneControlButtons', (controls: any[]) => {
		// Add a button in the token controls group
		const tokenGroup = controls.find((c: any) => c.name === 'token')
		if (tokenGroup?.tools) {
			tokenGroup.tools.push({
				name: MODULE_ID,
				title: 'FoundryAI Chat',
				icon: 'fas fa-brain',
				button: true,
				onClick: () => {
					openPopoutChat(ChatWindow)
				},
			})
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
