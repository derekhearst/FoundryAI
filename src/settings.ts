/* ==========================================================================
   Settings Registration
   Registers all module settings with Foundry VTT's ClientSettings API.
   ========================================================================== */

import { SvelteApplication } from '@ui/svelte-application'
import SettingsPanel from '@ui/components/SettingsPanel.svelte'

const MODULE_ID = 'foundry-ai'

export interface FoundryAISettings {
	apiKey: string
	chatModel: string
	embeddingModel: string
	journalFolders: string[]
	actorFolders: string[]
	chatHistoryFolder: string
	sessionRecapFolder: string
	systemPromptOverride: string
	temperature: number
	maxTokens: number
	maxToolDepth: number
	streamResponses: boolean
	autoIndex: boolean
	enableTools: boolean
	showSidebarTab: boolean
}

export function registerSettings(): void {
	// ---- API Configuration ----

	game.settings.register(MODULE_ID, 'apiKey', {
		name: 'FOUNDRYAI.Settings.ApiKey',
		hint: 'FOUNDRYAI.Settings.ApiKeyHint',
		scope: 'world',
		config: false, // Shown in custom settings panel
		type: String,
		default: '',
		onChange: () => {
			Hooks.callAll(`${MODULE_ID}.settingsChanged`, 'apiKey')
		},
	})

	game.settings.register(MODULE_ID, 'chatModel', {
		name: 'FOUNDRYAI.Settings.ChatModel',
		hint: 'FOUNDRYAI.Settings.ChatModelHint',
		scope: 'world',
		config: false,
		type: String,
		default: 'anthropic/claude-sonnet-4',
		onChange: () => {
			Hooks.callAll(`${MODULE_ID}.settingsChanged`, 'chatModel')
		},
	})

	game.settings.register(MODULE_ID, 'embeddingModel', {
		name: 'FOUNDRYAI.Settings.EmbeddingModel',
		hint: 'FOUNDRYAI.Settings.EmbeddingModelHint',
		scope: 'world',
		config: false,
		type: String,
		default: 'openai/text-embedding-3-small',
		onChange: () => {
			Hooks.callAll(`${MODULE_ID}.settingsChanged`, 'embeddingModel')
		},
	})

	// ---- RAG Configuration ----

	game.settings.register(MODULE_ID, 'journalFolders', {
		name: 'FOUNDRYAI.Settings.JournalFolders',
		hint: 'FOUNDRYAI.Settings.JournalFoldersHint',
		scope: 'world',
		config: false,
		type: Array,
		default: [],
	})

	game.settings.register(MODULE_ID, 'actorFolders', {
		name: 'FOUNDRYAI.Settings.ActorFolders',
		hint: 'FOUNDRYAI.Settings.ActorFoldersHint',
		scope: 'world',
		config: false,
		type: Array,
		default: [],
	})

	// ---- Journal Folder Configuration ----

	game.settings.register(MODULE_ID, 'chatHistoryFolder', {
		name: 'FOUNDRYAI.Settings.ChatHistoryFolder',
		hint: 'FOUNDRYAI.Settings.ChatHistoryFolderHint',
		scope: 'world',
		config: false,
		type: String,
		default: '',
	})

	game.settings.register(MODULE_ID, 'sessionRecapFolder', {
		name: 'FOUNDRYAI.Settings.SessionRecapFolder',
		hint: 'FOUNDRYAI.Settings.SessionRecapFolderHint',
		scope: 'world',
		config: false,
		type: String,
		default: '',
	})

	// ---- LLM Parameters ----

	game.settings.register(MODULE_ID, 'temperature', {
		name: 'FOUNDRYAI.Settings.Temperature',
		hint: 'FOUNDRYAI.Settings.TemperatureHint',
		scope: 'world',
		config: false,
		type: Number,
		default: 0.8,
		range: { min: 0, max: 2, step: 0.1 },
	})

	game.settings.register(MODULE_ID, 'maxTokens', {
		name: 'FOUNDRYAI.Settings.MaxTokens',
		hint: 'FOUNDRYAI.Settings.MaxTokensHint',
		scope: 'world',
		config: false,
		type: Number,
		default: 4096,
	})

	game.settings.register(MODULE_ID, 'maxToolDepth', {
		name: 'FOUNDRYAI.Settings.MaxToolDepth',
		hint: 'FOUNDRYAI.Settings.MaxToolDepthHint',
		scope: 'world',
		config: false,
		type: Number,
		default: 0,
	})

	game.settings.register(MODULE_ID, 'systemPromptOverride', {
		name: 'FOUNDRYAI.Settings.SystemPrompt',
		hint: 'FOUNDRYAI.Settings.SystemPromptHint',
		scope: 'world',
		config: false,
		type: String,
		default: '',
	})

	// ---- Feature Toggles ----

	game.settings.register(MODULE_ID, 'streamResponses', {
		name: 'FOUNDRYAI.Settings.StreamResponses',
		hint: 'FOUNDRYAI.Settings.StreamResponsesHint',
		scope: 'world',
		config: false,
		type: Boolean,
		default: true,
	})

	game.settings.register(MODULE_ID, 'autoIndex', {
		name: 'FOUNDRYAI.Settings.AutoIndex',
		hint: 'FOUNDRYAI.Settings.AutoIndexHint',
		scope: 'world',
		config: false,
		type: Boolean,
		default: true,
	})

	game.settings.register(MODULE_ID, 'enableTools', {
		name: 'FOUNDRYAI.Settings.EnableTools',
		hint: 'FOUNDRYAI.Settings.EnableToolsHint',
		scope: 'world',
		config: false,
		type: Boolean,
		default: true,
	})

	game.settings.register(MODULE_ID, 'showSidebarTab', {
		name: 'FOUNDRYAI.Settings.ShowSidebarTab',
		hint: 'FOUNDRYAI.Settings.ShowSidebarTabHint',
		scope: 'world',
		config: false,
		type: Boolean,
		default: true,
	})

	// ---- Settings Menu ----

	game.settings.registerMenu(MODULE_ID, 'settingsMenu', {
		name: 'FOUNDRYAI.Settings.MenuName',
		label: 'FOUNDRYAI.Settings.MenuLabel',
		hint: 'FOUNDRYAI.Settings.MenuHint',
		icon: 'fas fa-brain',
		type: FoundryAISettingsApp as any,
		restricted: true,
	})
}

// ---- Settings Accessor ----

export function getSetting<K extends keyof FoundryAISettings>(key: K): FoundryAISettings[K] {
	return game.settings.get(MODULE_ID, key) as FoundryAISettings[K]
}

export async function setSetting<K extends keyof FoundryAISettings>(
	key: K,
	value: FoundryAISettings[K],
): Promise<void> {
	await game.settings.set(MODULE_ID, key, value)
}

// ---- Settings Application (Svelte-powered) ----

class FoundryAISettingsApp extends SvelteApplication {
	constructor(options: Partial<ApplicationConfiguration> = {}) {
		super(SettingsPanel, {}, options)
	}

	static override DEFAULT_OPTIONS: ApplicationConfiguration = {
		...SvelteApplication.DEFAULT_OPTIONS,
		id: 'foundry-ai-settings',
		classes: ['foundry-ai'],
		window: {
			frame: true,
			positioned: true,
			title: 'FoundryAI Settings',
			icon: 'fas fa-brain',
			minimizable: false,
			resizable: true,
			contentTag: 'section',
			contentClasses: ['foundry-ai-content'],
		},
		position: {
			width: 600,
			height: 700,
		},
	}

	override get title(): string {
		return 'FoundryAI Settings'
	}
}

export { FoundryAISettingsApp }
