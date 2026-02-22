/* ==========================================================================
   Vector Store - IndexedDB-backed vector storage for RAG
   ========================================================================== */

export interface VectorEntry {
	id: string // unique chunk ID: `${documentType}:${documentId}:${chunkIndex}`
	documentId: string
	documentType: 'journal' | 'actor'
	documentName: string
	folderName: string
	chunkIndex: number
	text: string
	vector: number[]
	metadata: Record<string, any>
}

export interface IndexMeta {
	documentId: string
	documentType: 'journal' | 'actor'
	documentName: string
	lastModified: number // timestamp
	chunkCount: number
}

export interface SearchResult {
	entry: VectorEntry
	score: number // cosine similarity
}

const DB_VERSION = 1
const VECTORS_STORE = 'vectors'
const INDEX_META_STORE = 'index-meta'

export class VectorStore {
	private db: IDBDatabase | null = null
	private dbName: string

	constructor(worldId: string) {
		this.dbName = `foundry-ai-vectors-${worldId}`
	}

	// ---- Initialization ----

	async open(): Promise<void> {
		if (this.db) return

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(this.dbName, DB_VERSION)

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result

				if (!db.objectStoreNames.contains(VECTORS_STORE)) {
					const vectorStore = db.createObjectStore(VECTORS_STORE, { keyPath: 'id' })
					vectorStore.createIndex('documentId', 'documentId', { unique: false })
					vectorStore.createIndex('documentType', 'documentType', { unique: false })
				}

				if (!db.objectStoreNames.contains(INDEX_META_STORE)) {
					db.createObjectStore(INDEX_META_STORE, { keyPath: 'documentId' })
				}
			}

			request.onsuccess = (event) => {
				this.db = (event.target as IDBOpenDBRequest).result
				resolve()
			}

			request.onerror = () => {
				reject(new Error(`Failed to open vector database: ${request.error?.message}`))
			}
		})
	}

	close(): void {
		this.db?.close()
		this.db = null
	}

	private ensureOpen(): IDBDatabase {
		if (!this.db) throw new Error('VectorStore not opened. Call open() first.')
		return this.db
	}

	// ---- CRUD Operations ----

	async upsertVectors(entries: VectorEntry[]): Promise<void> {
		const db = this.ensureOpen()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(VECTORS_STORE, 'readwrite')
			const store = tx.objectStore(VECTORS_STORE)

			for (const entry of entries) {
				store.put(entry)
			}

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(new Error(`Failed to upsert vectors: ${tx.error?.message}`))
		})
	}

	async deleteByDocument(documentId: string): Promise<void> {
		const db = this.ensureOpen()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(VECTORS_STORE, 'readwrite')
			const store = tx.objectStore(VECTORS_STORE)
			const index = store.index('documentId')
			const request = index.openCursor(IDBKeyRange.only(documentId))

			request.onsuccess = (event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
				if (cursor) {
					cursor.delete()
					cursor.continue()
				}
			}

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(new Error(`Failed to delete vectors: ${tx.error?.message}`))
		})
	}

	async setIndexMeta(meta: IndexMeta): Promise<void> {
		const db = this.ensureOpen()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(INDEX_META_STORE, 'readwrite')
			const store = tx.objectStore(INDEX_META_STORE)
			store.put(meta)

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(new Error(`Failed to set index meta: ${tx.error?.message}`))
		})
	}

	async getIndexMeta(documentId: string): Promise<IndexMeta | undefined> {
		const db = this.ensureOpen()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(INDEX_META_STORE, 'readonly')
			const store = tx.objectStore(INDEX_META_STORE)
			const request = store.get(documentId)

			request.onsuccess = () => resolve(request.result || undefined)
			request.onerror = () => reject(new Error(`Failed to get index meta: ${request.error?.message}`))
		})
	}

	async getAllIndexMeta(): Promise<IndexMeta[]> {
		const db = this.ensureOpen()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(INDEX_META_STORE, 'readonly')
			const store = tx.objectStore(INDEX_META_STORE)
			const request = store.getAll()

			request.onsuccess = () => resolve(request.result || [])
			request.onerror = () => reject(new Error(`Failed to get all index meta: ${request.error?.message}`))
		})
	}

	async deleteIndexMeta(documentId: string): Promise<void> {
		const db = this.ensureOpen()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(INDEX_META_STORE, 'readwrite')
			const store = tx.objectStore(INDEX_META_STORE)
			store.delete(documentId)

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(new Error(`Failed to delete index meta: ${tx.error?.message}`))
		})
	}

	// ---- Vector Search ----

	async search(
		queryVector: number[],
		topK: number = 5,
		filter?: {
			documentType?: 'journal' | 'actor'
		},
	): Promise<SearchResult[]> {
		const db = this.ensureOpen()

		return new Promise((resolve, reject) => {
			const tx = db.transaction(VECTORS_STORE, 'readonly')
			const store = tx.objectStore(VECTORS_STORE)
			const results: SearchResult[] = []

			let request: IDBRequest

			if (filter?.documentType) {
				const index = store.index('documentType')
				request = index.openCursor(IDBKeyRange.only(filter.documentType))
			} else {
				request = store.openCursor()
			}

			request.onsuccess = (event) => {
				const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
				if (cursor) {
					const entry = cursor.value as VectorEntry
					const score = cosineSimilarity(queryVector, entry.vector)
					results.push({ entry, score })
					cursor.continue()
				}
			}

			tx.oncomplete = () => {
				// Sort by score descending and take top K
				results.sort((a, b) => b.score - a.score)
				resolve(results.slice(0, topK))
			}

			tx.onerror = () => reject(new Error(`Search failed: ${tx.error?.message}`))
		})
	}

	// ---- Statistics ----

	async getStats(): Promise<{
		totalVectors: number
		totalDocuments: number
		byType: Record<string, number>
	}> {
		const db = this.ensureOpen()

		const allMeta = await this.getAllIndexMeta()
		const byType: Record<string, number> = {}

		for (const meta of allMeta) {
			byType[meta.documentType] = (byType[meta.documentType] || 0) + 1
		}

		const totalVectors = await new Promise<number>((resolve, reject) => {
			const tx = db.transaction(VECTORS_STORE, 'readonly')
			const store = tx.objectStore(VECTORS_STORE)
			const request = store.count()

			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(new Error(`Count failed: ${request.error?.message}`))
		})

		return {
			totalVectors,
			totalDocuments: allMeta.length,
			byType,
		}
	}

	// ---- Clear ----

	async clear(): Promise<void> {
		const db = this.ensureOpen()

		return new Promise((resolve, reject) => {
			const tx = db.transaction([VECTORS_STORE, INDEX_META_STORE], 'readwrite')
			tx.objectStore(VECTORS_STORE).clear()
			tx.objectStore(INDEX_META_STORE).clear()

			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(new Error(`Clear failed: ${tx.error?.message}`))
		})
	}
}

// ---- Math Utilities ----

function cosineSimilarity(a: number[], b: number[]): number {
	if (a.length !== b.length) return 0

	let dotProduct = 0
	let normA = 0
	let normB = 0

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}

	const denominator = Math.sqrt(normA) * Math.sqrt(normB)
	return denominator === 0 ? 0 : dotProduct / denominator
}
