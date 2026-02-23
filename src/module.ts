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

	// Register scene control button early (before first render)
	registerSceneControlButton()
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

	// Inject sidebar brain icon after DOM is ready
	injectSidebarIcon()

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

// ---- Sidebar Brain Icon (Direct DOM Injection) ----

/**
 * Inject a brain icon into the sidebar tab bar by querying the live DOM.
 * Uses requestAnimationFrame to wait for the sidebar to finish rendering.
 */
function injectSidebarIcon() {
	// Wait a tick for the sidebar DOM to be fully ready
	requestAnimationFrame(() => {
		doInjectSidebarIcon()
	})

	// Also re-inject whenever the sidebar re-renders (tab changes, etc.)
	Hooks.on('renderSidebar', () => {
		requestAnimationFrame(() => {
			doInjectSidebarIcon()
		})
	})

	// Also re-inject when any sidebar tab renders (in case sidebar was rebuilt)
	Hooks.on('changeSidebarTab', () => {
		requestAnimationFrame(() => {
			doInjectSidebarIcon()
		})
	})
}

function doInjectSidebarIcon() {
	// Already injected? Skip
	if (document.querySelector('.foundry-ai-sidebar-btn')) return

	// Find the sidebar tab navigation in the live DOM
	const sidebar = document.getElementById('sidebar')
	if (!sidebar) {
		console.warn('FoundryAI | #sidebar element not found in DOM')
		return
	}

	// Try multiple selectors for the tab bar
	const nav =
		sidebar.querySelector('nav.tabs') ||
		sidebar.querySelector('nav[role="tablist"]') ||
		sidebar.querySelector('nav') ||
		sidebar.querySelector('[role="tablist"]')

	if (!nav) {
		console.warn('FoundryAI | Could not find sidebar tab navigation. Trying fallback...')
		// Fallback: Search entire sidebar for a row of tab-like icons
		const allNavs = sidebar.querySelectorAll('nav, [data-group]')
		if (allNavs.length > 0) {
			injectIntoNav(allNavs[0] as HTMLElement)
		}
		return
	}

	injectIntoNav(nav as HTMLElement)
}

function injectIntoNav(nav: HTMLElement) {
	if (nav.querySelector('.foundry-ai-sidebar-btn')) return

	// Detect existing tab element type (button vs a)
	const existingTab = nav.querySelector('a[data-tab], button[data-tab], a.item, button.item')
	const tagName = existingTab?.tagName === 'BUTTON' ? 'button' : 'a'

	const btn = document.createElement(tagName)
	btn.className = 'item foundry-ai-sidebar-btn'
	if (tagName === 'button') btn.setAttribute('type', 'button')
	btn.setAttribute('data-tooltip', 'FoundryAI Chat')
	btn.setAttribute('aria-label', 'FoundryAI Chat')
	btn.innerHTML = '<i class="fas fa-brain"></i>'

	// Copy basic styles from an existing tab for consistent look
	if (existingTab) {
		const cs = window.getComputedStyle(existingTab)
		btn.style.display = cs.display || 'flex'
		btn.style.alignItems = cs.alignItems || 'center'
		btn.style.justifyContent = cs.justifyContent || 'center'
	}

	btn.addEventListener('click', (e) => {
		e.preventDefault()
		e.stopPropagation()
		e.stopImmediatePropagation()
		openPopoutChat(ChatWindow)
	})

	nav.appendChild(btn)
	console.log('FoundryAI | Brain icon injected into sidebar navigation')
}

// ---- Scene Controls Button ----

function registerSceneControlButton() {
	Hooks.on('getSceneControlButtons', (controls: any) => {
		// In v13, controls may be Record<string, SceneControl> or array-like
		const tokenGroup = controls.tokens ?? controls.token
		if (tokenGroup?.tools) {
			tokenGroup.tools[MODULE_ID] = {
				name: MODULE_ID,
				title: 'FoundryAI Chat',
				icon: 'fas fa-brain',
				button: true,
				order: 100,
				// v13 may use onChange or onClick depending on build
				onChange: () => {
					openPopoutChat(ChatWindow)
				},
				onClick: () => {
					openPopoutChat(ChatWindow)
				},
				onclick: () => {
					openPopoutChat(ChatWindow)
				},
			}
			console.log('FoundryAI | Scene control button registered')
		} else {
			console.warn('FoundryAI | Could not find token controls group. Available:', Object.keys(controls))
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
