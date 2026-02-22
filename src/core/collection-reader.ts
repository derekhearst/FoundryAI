/* ==========================================================================
   Collection Reader - Extracts content from Foundry collections for RAG
   ========================================================================== */

export interface ExtractedDocument {
	id: string
	name: string
	type: 'journal' | 'actor'
	folderId: string | null
	folderName: string
	content: string
	lastModified: number
	metadata: Record<string, any>
}

export class CollectionReader {
	// ---- Journal Entries ----

	getJournalsByFolders(folderIds: string[]): ExtractedDocument[] {
		if (!game.journal) return []

		const documents: ExtractedDocument[] = []

		for (const entry of game.journal.values()) {
			if (!entry.folder) continue
			if (!folderIds.includes(entry.folder.id)) continue

			const content = this.extractJournalContent(entry)
			if (!content) continue

			documents.push({
				id: entry.id,
				name: entry.name,
				type: 'journal',
				folderId: entry.folder?.id || null,
				folderName: entry.folder?.name || 'Uncategorized',
				content,
				lastModified: Date.now(), // Foundry doesn't expose modification time easily
				metadata: {
					pageCount: entry.pages.size,
					folderPath: this.getFolderPath(entry.folder),
				},
			})
		}

		return documents
	}

	getAllJournals(): ExtractedDocument[] {
		if (!game.journal) return []

		const documents: ExtractedDocument[] = []

		for (const entry of game.journal.values()) {
			const content = this.extractJournalContent(entry)
			if (!content) continue

			documents.push({
				id: entry.id,
				name: entry.name,
				type: 'journal',
				folderId: entry.folder?.id || null,
				folderName: entry.folder?.name || 'Uncategorized',
				content,
				lastModified: Date.now(),
				metadata: {
					pageCount: entry.pages.size,
					folderPath: entry.folder ? this.getFolderPath(entry.folder) : '',
				},
			})
		}

		return documents
	}

	private extractJournalContent(entry: JournalEntry): string {
		const parts: string[] = []

		parts.push(`# ${entry.name}`)

		for (const page of entry.pages.values()) {
			if (page.type === 'text' && page.text?.content) {
				const plainText = this.stripHtml(page.text.content)
				if (plainText.trim()) {
					if (entry.pages.size > 1) {
						parts.push(`\n## ${page.name}\n`)
					}
					parts.push(plainText)
				}
			}
		}

		return parts.join('\n').trim()
	}

	// ---- Actors ----

	getActorsByFolders(folderIds: string[]): ExtractedDocument[] {
		if (!game.actors) return []

		const documents: ExtractedDocument[] = []

		for (const actor of game.actors.values()) {
			if (!actor.folder) continue
			if (!folderIds.includes(actor.folder.id)) continue

			const content = this.extractActorContent(actor)
			if (!content) continue

			documents.push({
				id: actor.id,
				name: actor.name,
				type: 'actor',
				folderId: actor.folder?.id || null,
				folderName: actor.folder?.name || 'Uncategorized',
				content,
				lastModified: Date.now(),
				metadata: {
					actorType: actor.type,
					img: actor.img,
					itemCount: actor.items?.size || 0,
					folderPath: actor.folder ? this.getFolderPath(actor.folder) : '',
				},
			})
		}

		return documents
	}

	private extractActorContent(actor: Actor): string {
		const parts: string[] = []

		parts.push(`# ${actor.name}`)
		parts.push(`Type: ${actor.type}`)

		// Extract biography/description
		const bio =
			actor.system?.details?.biography?.value ||
			actor.system?.details?.biography ||
			actor.system?.description?.value ||
			actor.system?.description ||
			''

		if (bio) {
			const plainBio = typeof bio === 'string' ? this.stripHtml(bio) : ''
			if (plainBio.trim()) {
				parts.push(`\nBiography:\n${plainBio}`)
			}
		}

		// Extract basic stats if available
		const hp = actor.system?.attributes?.hp
		if (hp) {
			parts.push(`HP: ${hp.value ?? hp.max ?? '?'}/${hp.max ?? '?'}`)
		}

		const ac = actor.system?.attributes?.ac
		if (ac) {
			parts.push(`AC: ${ac.value ?? ac.flat ?? '?'}`)
		}

		// Extract ability scores if available
		const abilities = actor.system?.abilities
		if (abilities) {
			const scores: string[] = []
			for (const [key, val] of Object.entries(abilities)) {
				const abil = val as any
				if (abil?.value != null) {
					scores.push(`${key.toUpperCase()}: ${abil.value}`)
				}
			}
			if (scores.length) {
				parts.push(`Abilities: ${scores.join(', ')}`)
			}
		}

		// Extract items (inventory, spells, features)
		if (actor.items?.size > 0) {
			const itemsByType: Record<string, string[]> = {}
			for (const item of actor.items.values()) {
				const type = item.type || 'other'
				if (!itemsByType[type]) itemsByType[type] = []
				itemsByType[type].push(item.name)
			}

			for (const [type, names] of Object.entries(itemsByType)) {
				parts.push(`\n${type.charAt(0).toUpperCase() + type.slice(1)}s: ${names.join(', ')}`)
			}
		}

		return parts.join('\n').trim()
	}

	// ---- Utility: Get single document content ----

	getJournalContent(journalId: string): string | null {
		const entry = game.journal?.get(journalId)
		if (!entry) return null
		return this.extractJournalContent(entry)
	}

	getActorContent(actorId: string): string | null {
		const actor = game.actors?.get(actorId)
		if (!actor) return null
		return this.extractActorContent(actor)
	}

	// ---- Folder Helpers ----

	getJournalFolders(): Array<{ id: string; name: string; path: string; depth: number }> {
		if (!game.folders) return []

		const folders: Array<{ id: string; name: string; path: string; depth: number }> = []

		for (const folder of game.folders.values()) {
			if (folder.type === 'JournalEntry') {
				folders.push({
					id: folder.id,
					name: folder.name,
					path: this.getFolderPath(folder),
					depth: folder.depth || 0,
				})
			}
		}

		return folders.sort((a, b) => a.path.localeCompare(b.path))
	}

	getActorFolders(): Array<{ id: string; name: string; path: string; depth: number }> {
		if (!game.folders) return []

		const folders: Array<{ id: string; name: string; path: string; depth: number }> = []

		for (const folder of game.folders.values()) {
			if (folder.type === 'Actor') {
				folders.push({
					id: folder.id,
					name: folder.name,
					path: this.getFolderPath(folder),
					depth: folder.depth || 0,
				})
			}
		}

		return folders.sort((a, b) => a.path.localeCompare(b.path))
	}

	private getFolderPath(folder: Folder | null): string {
		if (!folder) return ''
		const parts: string[] = [folder.name]
		let parent = folder.parent
		while (parent) {
			parts.unshift(parent.name)
			parent = parent.parent
		}
		return parts.join(' / ')
	}

	// ---- Scene Info ----

	getCurrentSceneInfo(): string {
		const scene = game.scenes?.contents?.find((s) => s.active)
		if (!scene) return 'No active scene.'

		const parts = [`Active Scene: ${scene.name}`]

		if (scene.tokens?.size) {
			const tokenNames = Array.from(scene.tokens.values())
				.map((t: any) => t.name)
				.filter(Boolean)
			if (tokenNames.length) {
				parts.push(`Tokens: ${tokenNames.join(', ')}`)
			}
		}

		if (scene.notes?.size) {
			parts.push(`Map Notes: ${scene.notes.size}`)
		}

		return parts.join('\n')
	}

	// ---- HTML Stripping ----

	private stripHtml(html: string): string {
		// Create a temporary element to parse HTML
		const temp = document.createElement('div')
		temp.innerHTML = html

		// Remove script and style elements
		temp.querySelectorAll('script, style').forEach((el) => el.remove())

		// Get text content and clean up whitespace
		let text = temp.textContent || temp.innerText || ''
		text = text.replace(/\s+/g, ' ').trim()

		return text
	}
}

export const collectionReader = new CollectionReader()
