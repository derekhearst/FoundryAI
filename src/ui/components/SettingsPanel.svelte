<script lang="ts">
  import { openRouterService, type ModelInfo } from '@core/openrouter-service';
  import { embeddingService } from '@core/embedding-service';
  import { collectionReader } from '@core/collection-reader';
  import { getSetting, setSetting } from '../../settings';

  interface Props {
    application?: any;
  }

  let { application }: Props = $props();

  // ---- State ----
  let apiKey = $state('');
  let chatModel = $state('');
  let embeddingModel = $state('');
  let temperature = $state(0.8);
  let maxTokens = $state(4096);
  let maxToolDepth = $state(0);
  let streamResponses = $state(true);
  let autoIndex = $state(true);
  let enableTools = $state(true);
  let systemPromptOverride = $state('');
  let selectedJournalFolders = $state<string[]>([]);
  let selectedActorFolders = $state<string[]>([]);

  let chatModels = $state<ModelInfo[]>([]);
  let embeddingModels = $state<ModelInfo[]>([]);
  let journalFolders = $state<Array<{ id: string; name: string; path: string }>>([]);
  let actorFolders = $state<Array<{ id: string; name: string; path: string }>>([]);

  let isLoadingModels = $state(false);
  let isTesting = $state(false);
  let testResult = $state<{ success: boolean; message: string } | null>(null);
  let isSaving = $state(false);
  let indexStats = $state<{ totalVectors: number; documents: number } | null>(null);
  let isIndexing = $state(false);
  let indexProgress = $state('');

  // ---- Load current settings ----
  $effect(() => {
    try {
      apiKey = getSetting('apiKey') || '';
      chatModel = getSetting('chatModel') || 'anthropic/claude-sonnet-4';
      embeddingModel = getSetting('embeddingModel') || 'openai/text-embedding-3-small';
      temperature = getSetting('temperature') ?? 0.8;
      maxTokens = getSetting('maxTokens') ?? 4096;
      maxToolDepth = getSetting('maxToolDepth') ?? 0;
      streamResponses = getSetting('streamResponses') ?? true;
      autoIndex = getSetting('autoIndex') ?? true;
      enableTools = getSetting('enableTools') ?? true;
      systemPromptOverride = getSetting('systemPromptOverride') || '';
      selectedJournalFolders = getSetting('journalFolders') || [];
      selectedActorFolders = getSetting('actorFolders') || [];
    } catch { /* settings not registered yet */ }

    // Load available folders
    journalFolders = collectionReader.getJournalFolders();
    actorFolders = collectionReader.getActorFolders();

    // Load index stats
    embeddingService.getStats().then(stats => {
      if (stats) indexStats = { totalVectors: stats.totalVectors, documents: stats.totalDocuments };
    });
  });

  // ---- Model Loading ----
  async function loadModels() {
    if (!apiKey) {
      ui.notifications.warn('Enter your API key first.');
      return;
    }

    isLoadingModels = true;
    try {
      openRouterService.configure({ apiKey, embeddingModel });
      const allModels = await openRouterService.listModels();
      chatModels = allModels.filter(m =>
        m.architecture?.modality?.includes('text') &&
        !m.id.includes('embedding')
      ).sort((a, b) => a.name.localeCompare(b.name));
      embeddingModels = allModels.filter(m =>
        m.id.includes('embedding')
      ).sort((a, b) => a.name.localeCompare(b.name));
    } catch (err: any) {
      ui.notifications.error(`Failed to load models: ${err.message}`);
    } finally {
      isLoadingModels = false;
    }
  }

  // ---- Connection Test ----
  async function testConnection() {
    if (!apiKey) {
      testResult = { success: false, message: 'API key is required.' };
      return;
    }

    isTesting = true;
    testResult = null;
    try {
      openRouterService.configure({ apiKey, embeddingModel });
      const ok = await openRouterService.testConnection();
      testResult = ok
        ? { success: true, message: '✅ Connection successful!' }
        : { success: false, message: '❌ Connection failed.' };
    } catch (err: any) {
      testResult = { success: false, message: `❌ ${err.message}` };
    } finally {
      isTesting = false;
    }
  }

  // ---- Save ----
  async function handleSave() {
    isSaving = true;
    try {
      await setSetting('apiKey', apiKey);
      await setSetting('chatModel', chatModel);
      await setSetting('embeddingModel', embeddingModel);
      await setSetting('temperature', temperature);
      await setSetting('maxTokens', maxTokens);
      await setSetting('maxToolDepth', maxToolDepth);
      await setSetting('streamResponses', streamResponses);
      await setSetting('autoIndex', autoIndex);
      await setSetting('enableTools', enableTools);
      await setSetting('systemPromptOverride', systemPromptOverride);
      await setSetting('journalFolders', selectedJournalFolders);
      await setSetting('actorFolders', selectedActorFolders);

      // Reconfigure the service with all model settings
      openRouterService.configure({ apiKey, defaultModel: chatModel, embeddingModel });

      // Refresh stats display
      await refreshStats();

      ui.notifications.info('FoundryAI settings saved!');
      application?.close();
    } catch (err: any) {
      ui.notifications.error(`Failed to save: ${err.message}`);
    } finally {
      isSaving = false;
    }
  }

  function toggleFolder(list: string[], folderId: string): string[] {
    if (list.includes(folderId)) {
      return list.filter(id => id !== folderId);
    }
    return [...list, folderId];
  }

  async function refreshStats() {
    try {
      const stats = await embeddingService.getStats();
      if (stats) indexStats = { totalVectors: stats.totalVectors, documents: stats.totalDocuments };
      else indexStats = { totalVectors: 0, documents: 0 };
    } catch {
      indexStats = { totalVectors: 0, documents: 0 };
    }
  }

  async function handleReindex() {
    if (!apiKey) {
      ui.notifications.warn('Enter your API key first.');
      return;
    }

    if (selectedJournalFolders.length === 0 && selectedActorFolders.length === 0) {
      ui.notifications.warn('Select at least one folder to index.');
      return;
    }

    isIndexing = true;
    indexProgress = 'Starting...';

    try {
      // Make sure service is configured
      openRouterService.configure({ apiKey, defaultModel: chatModel, embeddingModel });

      // Ensure embedding service is initialized
      if (!embeddingService.isInitialized) {
        const worldId = game.world?.id || 'default';
        await embeddingService.initialize(worldId);
      }

      // Save folder selections first
      await setSetting('journalFolders', selectedJournalFolders);
      await setSetting('actorFolders', selectedActorFolders);

      await embeddingService.reindexAll(selectedJournalFolders, selectedActorFolders, (progress) => {
        indexProgress = progress.message || `${progress.phase}: ${progress.current}/${progress.total}`;
      });

      await refreshStats();
      ui.notifications.info('Indexing complete!');
    } catch (err: any) {
      console.error('FoundryAI | Reindex failed:', err);
      ui.notifications.error(`Indexing failed: ${err.message}`);
    } finally {
      isIndexing = false;
      indexProgress = '';
    }
  }
</script>

<div class="settings-panel">
  <div class="settings-scroll">
    <!-- API Configuration -->
    <section class="settings-section">
      <h2><i class="fas fa-key"></i> API Configuration</h2>

      <div class="field">
        <label for="api-key">OpenRouter API Key</label>
        <div class="input-group">
          <input
            id="api-key"
            type="password"
            bind:value={apiKey}
            placeholder="sk-or-v1-..."
          />
          <button class="inline-btn" onclick={testConnection} disabled={isTesting}>
            {isTesting ? 'Testing...' : 'Test'}
          </button>
        </div>
        {#if testResult}
          <span class="field-result" class:success={testResult.success} class:error={!testResult.success}>
            {testResult.message}
          </span>
        {/if}
      </div>
    </section>

    <!-- Model Selection -->
    <section class="settings-section">
      <h2><i class="fas fa-robot"></i> Models</h2>

      <button class="load-models-btn" onclick={loadModels} disabled={isLoadingModels}>
        <i class="fas" class:fa-download={!isLoadingModels} class:fa-spinner={isLoadingModels} class:fa-spin={isLoadingModels}></i>
        {isLoadingModels ? 'Loading...' : 'Load Available Models'}
      </button>

      <div class="field">
        <label for="chat-model">Chat Model</label>
        {#if chatModels.length > 0}
          <select id="chat-model" bind:value={chatModel}>
            {#each chatModels as model (model.id)}
              <option value={model.id}>{model.name} ({model.id})</option>
            {/each}
          </select>
        {:else}
          <input id="chat-model" type="text" bind:value={chatModel} placeholder="e.g. anthropic/claude-sonnet-4" />
        {/if}
      </div>

      <div class="field">
        <label for="embedding-model">Embedding Model</label>
        {#if embeddingModels.length > 0}
          <select id="embedding-model" bind:value={embeddingModel}>
            {#each embeddingModels as model (model.id)}
              <option value={model.id}>{model.name} ({model.id})</option>
            {/each}
          </select>
        {:else}
          <input id="embedding-model" type="text" bind:value={embeddingModel} placeholder="e.g. openai/text-embedding-3-small" />
        {/if}
      </div>
    </section>

    <!-- LLM Parameters -->
    <section class="settings-section">
      <h2><i class="fas fa-sliders-h"></i> Parameters</h2>

      <div class="field">
        <label for="temperature">Temperature: {temperature.toFixed(1)}</label>
        <input id="temperature" type="range" min="0" max="2" step="0.1" bind:value={temperature} />
      </div>

      <div class="field">
        <label for="max-tokens">Max Tokens</label>
        <input id="max-tokens" type="number" bind:value={maxTokens} min="256" max="128000" step="256" />
      </div>

      <div class="field">
        <label for="max-tool-depth">Max Tool Call Rounds (0 = unlimited)</label>
        <input id="max-tool-depth" type="number" bind:value={maxToolDepth} min="0" max="50" step="1" />
        <small class="hint">How many rounds of tool calls the AI can chain. 0 means no limit.</small>
      </div>

      <div class="field checkbox-field">
        <label>
          <input type="checkbox" bind:checked={streamResponses} />
          Stream Responses
        </label>
      </div>

      <div class="field checkbox-field">
        <label>
          <input type="checkbox" bind:checked={enableTools} />
          Enable Tool Use (search, create journals, etc.)
        </label>
      </div>

      <div class="field checkbox-field">
        <label>
          <input type="checkbox" bind:checked={autoIndex} />
          Auto-index on startup
        </label>
      </div>
    </section>

    <!-- RAG Configuration -->
    <section class="settings-section">
      <h2><i class="fas fa-database"></i> RAG Knowledge Base</h2>

      {#if indexStats}
        <div class="stats-bar">
          <span>📊 {indexStats.totalVectors} vectors across {indexStats.documents} documents</span>
        </div>
      {/if}

      {#if isIndexing}
        <div class="index-progress">
          <i class="fas fa-spinner fa-spin"></i> {indexProgress}
        </div>
      {/if}

      <div class="field">
        <span class="field-label">Journal Folders to Index</span>
        <div class="folder-list">
          {#if journalFolders.length === 0}
            <span class="empty-hint">No journal folders found in this world.</span>
          {:else}
            {#each journalFolders as folder (folder.id)}
              <label class="folder-item">
                <input
                  type="checkbox"
                  checked={selectedJournalFolders.includes(folder.id)}
                  onchange={() => { selectedJournalFolders = toggleFolder(selectedJournalFolders, folder.id); }}
                />
                <span title={folder.path}>{folder.name}</span>
              </label>
            {/each}
          {/if}
        </div>
      </div>

      <div class="field">
        <span class="field-label">Actor Folders to Index</span>
        <div class="folder-list">
          {#if actorFolders.length === 0}
            <span class="empty-hint">No actor folders found in this world.</span>
          {:else}
            {#each actorFolders as folder (folder.id)}
              <label class="folder-item">
                <input
                  type="checkbox"
                  checked={selectedActorFolders.includes(folder.id)}
                  onchange={() => { selectedActorFolders = toggleFolder(selectedActorFolders, folder.id); }}
                />
                <span title={folder.path}>{folder.name}</span>
              </label>
            {/each}
          {/if}
        </div>
      </div>

      <button class="reindex-btn" onclick={handleReindex} disabled={isIndexing}>
        <i class="fas" class:fa-sync-alt={!isIndexing} class:fa-spinner={isIndexing} class:fa-spin={isIndexing}></i>
        {isIndexing ? 'Indexing...' : 'Reindex Now'}
      </button>
    </section>

    <!-- System Prompt -->
    <section class="settings-section">
      <h2><i class="fas fa-scroll"></i> System Prompt Override</h2>
      <div class="field">
        <label for="system-prompt">Leave blank to use the default DM assistant prompt.</label>
        <textarea
          id="system-prompt"
          bind:value={systemPromptOverride}
          rows="6"
          placeholder="Custom system prompt (optional)..."
        ></textarea>
      </div>
    </section>
  </div>

  <!-- Actions -->
  <div class="settings-actions">
    <button class="btn-cancel" onclick={() => application?.close()}>Cancel</button>
    <button class="btn-save" onclick={handleSave} disabled={isSaving}>
      {isSaving ? 'Saving...' : 'Save Settings'}
    </button>
  </div>
</div>

<style>
  .settings-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--foundry-ai-bg, #1a1a2e);
    color: var(--foundry-ai-text, #e0e0e0);
    font-family: 'Signika', sans-serif;
  }

  .settings-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
  }

  .settings-scroll::-webkit-scrollbar {
    width: 6px;
  }

  .settings-scroll::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }

  .settings-section {
    margin-bottom: 20px;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .settings-section:last-child {
    border-bottom: none;
  }

  .settings-section h2 {
    font-size: 0.95em;
    color: #e0c080;
    margin: 0 0 12px 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .settings-section h2 i {
    font-size: 0.85em;
    opacity: 0.7;
  }

  .field {
    margin-bottom: 12px;
  }

  .field label {
    display: block;
    font-size: 0.82em;
    font-weight: 500;
    margin-bottom: 4px;
    opacity: 0.8;
  }

  .field-label {
    display: block;
    font-size: 0.82em;
    font-weight: 500;
    margin-bottom: 4px;
    opacity: 0.8;
  }

  .field input[type="text"],
  .field input[type="password"],
  .field input[type="number"],
  .field select,
  .field textarea {
    width: 100%;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    color: inherit;
    padding: 8px 10px;
    font-family: inherit;
    font-size: 0.88em;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .field input:focus,
  .field select:focus,
  .field textarea:focus {
    border-color: rgba(139, 92, 246, 0.5);
  }

  .field input[type="range"] {
    width: 100%;
    accent-color: #8b5cf6;
  }

  .field textarea {
    resize: vertical;
    min-height: 80px;
    line-height: 1.4;
  }

  .input-group {
    display: flex;
    gap: 6px;
  }

  .input-group input {
    flex: 1;
  }

  .inline-btn {
    background: rgba(139, 92, 246, 0.3);
    border: 1px solid rgba(139, 92, 246, 0.4);
    color: #c4b5fd;
    padding: 6px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85em;
    white-space: nowrap;
    transition: all 0.15s;
  }

  .inline-btn:hover:not(:disabled) {
    background: rgba(139, 92, 246, 0.5);
    color: #fff;
  }

  .inline-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .field-result {
    display: block;
    font-size: 0.8em;
    margin-top: 4px;
  }

  .field-result.success { color: #4ade80; }
  .field-result.error { color: #f87171; }

  .load-models-btn {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px dashed rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.6);
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85em;
    margin-bottom: 12px;
    transition: all 0.15s;
  }

  .load-models-btn:hover:not(:disabled) {
    border-color: rgba(139, 92, 246, 0.4);
    color: #c4b5fd;
  }

  .checkbox-field label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    font-size: 0.88em;
    opacity: 1;
  }

  .checkbox-field input[type="checkbox"] {
    accent-color: #8b5cf6;
    width: 16px;
    height: 16px;
  }

  .stats-bar {
    background: rgba(139, 92, 246, 0.1);
    border: 1px solid rgba(139, 92, 246, 0.2);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 0.8em;
    color: #c4b5fd;
    margin-bottom: 12px;
  }

  .index-progress {
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.2);
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 0.8em;
    color: #93c5fd;
    margin-bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .reindex-btn {
    width: 100%;
    background: rgba(34, 197, 94, 0.15);
    border: 1px solid rgba(34, 197, 94, 0.3);
    color: #86efac;
    padding: 8px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85em;
    margin-top: 8px;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .reindex-btn:hover:not(:disabled) {
    background: rgba(34, 197, 94, 0.25);
    color: #4ade80;
  }

  .reindex-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .folder-list {
    max-height: 160px;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.15);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 6px;
    padding: 6px;
  }

  .folder-item {
    display: flex !important;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
    transition: background 0.1s;
  }

  .folder-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .empty-hint {
    font-size: 0.82em;
    opacity: 0.4;
    padding: 8px;
  }

  /* ---- Actions Bar ---- */
  .settings-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px 16px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.2);
  }

  .btn-cancel {
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: rgba(255, 255, 255, 0.7);
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.88em;
    transition: all 0.15s;
  }

  .btn-cancel:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #fff;
  }

  .btn-save {
    background: #8b5cf6;
    border: none;
    color: #fff;
    padding: 8px 20px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.88em;
    font-weight: 500;
    transition: all 0.15s;
  }

  .btn-save:hover:not(:disabled) {
    background: #7c3aed;
  }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
