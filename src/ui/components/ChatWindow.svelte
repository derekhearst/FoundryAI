<script lang="ts">
  import MessageBubble from './MessageBubble.svelte';
  import SessionList from './SessionList.svelte';
  import { openRouterService, type LLMMessage, type StreamCallback } from '@core/openrouter-service';
  import { chatSessionManager } from '@core/chat-session-manager';
  import { sessionRecapManager, type RecapProgress } from '@core/session-recap-manager';
  import { embeddingService } from '@core/embedding-service';
  import { TOOL_DEFINITIONS, executeTool } from '@core/tool-system';
  import { buildSystemPrompt } from '@core/system-prompt';
  import { getSetting } from '../../settings';
  import { openSettingsDialog } from '../svelte-application';
  import SettingsPanel from './SettingsPanel.svelte';

  interface Props {
    isSidebar?: boolean;
    application?: any;
  }

  let { isSidebar = false, application }: Props = $props();

  // ---- State ----
  type ViewMode = 'chat' | 'sessions' | 'recap';

  let viewMode = $state<ViewMode>('chat');
  let messages = $state<LLMMessage[]>([]);
  let inputText = $state('');
  let isGenerating = $state(false);
  let streamingContent = $state('');
  let currentSessionId = $state<string | null>(null);
  let currentSessionName = $state('New Chat');
  let messagesEndEl: HTMLDivElement | undefined = $state();
  let inputEl: HTMLTextAreaElement | undefined = $state();
  let recapProgress = $state<RecapProgress | null>(null);
  let isIndexing = $state(false);
  let indexProgress = $state('');

  // ---- Derived ----

  // Group messages: merge consecutive tool-call assistant + tool results into compact groups
  type CompactMessage =
    | { type: 'message'; msg: LLMMessage; index: number }
    | { type: 'tool-group'; toolCalls: Array<{ name: string; args: string }>; results: Array<{ name: string; content: string }> };

  const compactMessages = $derived.by((): CompactMessage[] => {
    const filtered = messages.filter(m => m.role !== 'system');
    const result: CompactMessage[] = [];
    let i = 0;

    while (i < filtered.length) {
      const msg = filtered[i];

      // If this is an assistant message with tool_calls, group it with following tool results
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        const toolCalls = msg.tool_calls.map((tc: any) => ({
          name: tc.function?.name || 'unknown',
          args: tc.function?.arguments || '{}',
        }));
        const results: Array<{ name: string; content: string }> = [];

        // Consume all following tool result messages
        let j = i + 1;
        while (j < filtered.length && filtered[j].role === 'tool') {
          results.push({
            name: filtered[j].name || 'unknown',
            content: typeof filtered[j].content === 'string' ? filtered[j].content : '',
          });
          j++;
        }

        result.push({ type: 'tool-group', toolCalls, results });
        i = j;
        continue;
      }

      // Skip standalone tool messages (shouldn't happen but safety)
      if (msg.role === 'tool') {
        i++;
        continue;
      }

      // Track original index for edit/retry
      const originalIndex = messages.indexOf(msg);
      result.push({ type: 'message', msg, index: originalIndex });
      i++;
    }

    return result;
  });

  const hasApiKey = $derived.by(() => {
    try {
      return !!getSetting('apiKey');
    } catch {
      return false;
    }
  });

  // ---- Lifecycle ----
  $effect(() => {
    // Reference reactive state so this effect re-runs when they change
    void messages.length;
    void streamingContent;

    // Auto-scroll to bottom after DOM update
    if (messagesEndEl) {
      // Use tick to wait for DOM to render, then scroll
      requestAnimationFrame(() => {
        messagesEndEl?.scrollIntoView({ behavior: 'smooth' });
      });
    }
  });

  // ---- Session Management ----
  let editingIndex = $state<number | null>(null);
  let editText = $state('');

  async function startNewSession() {
    const session = await chatSessionManager.createSession();
    currentSessionId = session.id;
    currentSessionName = session.name;
    messages = [];
    streamingContent = '';
    viewMode = 'chat';
    inputEl?.focus();
  }

  function loadSession(sessionId: string) {
    const session = chatSessionManager.loadSession(sessionId);
    if (!session) {
      ui.notifications.error('Session not found.');
      return;
    }
    currentSessionId = session.id;
    currentSessionName = session.name;
    messages = session.messages;
    streamingContent = '';
    viewMode = 'chat';
  }

  // ---- Message Sending ----
  async function sendMessage() {
    const text = inputText.trim();
    if (!text || isGenerating) return;

    if (!hasApiKey) {
      ui.notifications.warn('Please configure your OpenRouter API key in FoundryAI settings.');
      return;
    }

    // Create session if needed
    if (!currentSessionId) {
      await startNewSession();
    }

    inputText = '';
    isGenerating = true;
    streamingContent = '';

    // Add user message
    const userMessage: LLMMessage = { role: 'user', content: text };
    messages = [...messages, userMessage];

    try {
      // Build context
      const systemPrompt = buildSystemPrompt();
      const ragContext = await getRelevantContext(text);

      // Build message array for API
      const apiMessages: LLMMessage[] = [
        { role: 'system', content: systemPrompt + (ragContext ? `\n\n# Relevant Context\n${ragContext}` : '') },
        ...messages,
      ];

      const model = getSetting('chatModel');
      const temperature = getSetting('temperature');
      const maxTokens = getSetting('maxTokens');
      const stream = getSetting('streamResponses');
      const useTools = getSetting('enableTools');

      if (stream) {
        await handleStreamingResponse(apiMessages, model, temperature, maxTokens, useTools);
      } else {
        await handleNonStreamingResponse(apiMessages, model, temperature, maxTokens, useTools);
      }

      // Save full conversation to session
      if (currentSessionId) {
        await chatSessionManager.saveFullConversation(
          currentSessionId,
          messages,
          model,
        );
      }
    } catch (error: any) {
      console.error('FoundryAI: Chat error:', error);
      const errorMsg: LLMMessage = {
        role: 'assistant',
        content: `⚠️ Error: ${error.message || 'Unknown error occurred'}`,
      };
      messages = [...messages, errorMsg];
    } finally {
      isGenerating = false;
      streamingContent = '';
    }
  }

  // ---- Edit & Retry ----
  function startEditMessage(index: number) {
    const msg = messages[index];
    if (!msg || msg.role !== 'user') return;
    editingIndex = index;
    editText = typeof msg.content === 'string' ? msg.content : '';
  }

  function cancelEdit() {
    editingIndex = null;
    editText = '';
  }

  async function submitEdit() {
    if (editingIndex === null || !editText.trim()) return;

    // Truncate messages up to (but not including) the edited message
    messages = messages.slice(0, editingIndex);
    editingIndex = null;

    // Re-send with edited text
    inputText = editText;
    editText = '';
    await sendMessage();
  }

  async function retryFromMessage(index: number) {
    // Find the user message at or before this index
    let userIndex = index;
    while (userIndex >= 0 && messages[userIndex].role !== 'user') {
      userIndex--;
    }
    if (userIndex < 0) return;

    const userText = typeof messages[userIndex].content === 'string' ? messages[userIndex].content : '';
    if (!userText) return;

    // Truncate everything from this user message onward and resend
    messages = messages.slice(0, userIndex);
    inputText = userText;
    await sendMessage();
  }

  async function handleStreamingResponse(
    apiMessages: LLMMessage[],
    model: string,
    temperature: number,
    maxTokens: number,
    useTools: boolean,
  ) {
    let fullContent = '';

    let pendingToolCalls: Partial<import('@core/openrouter-service').ToolCall>[] | undefined;

    const onChunk: StreamCallback = (chunk) => {
      if (chunk.content) {
        fullContent += chunk.content;
        streamingContent = fullContent;
      }
      if (chunk.toolCalls) {
        pendingToolCalls = chunk.toolCalls;
      }
    };

    await openRouterService.chatCompletionStream(
      {
        model,
        messages: apiMessages,
        temperature,
        max_tokens: maxTokens,
        tools: useTools ? TOOL_DEFINITIONS : undefined,
        tool_choice: useTools ? 'auto' : undefined,
      },
      onChunk,
    );

    if (pendingToolCalls?.length) {
      // Handle tool calls via a non-streaming follow-up
      const assistantMessage = { content: fullContent || null, tool_calls: pendingToolCalls };
      await handleToolCalls(assistantMessage, apiMessages, model, temperature, maxTokens);
    } else {
      // Normal text response
      const msg: LLMMessage = { role: 'assistant', content: fullContent };
      messages = [...messages, msg];
    }
  }

  async function handleNonStreamingResponse(
    apiMessages: LLMMessage[],
    model: string,
    temperature: number,
    maxTokens: number,
    useTools: boolean,
  ) {
    const response = await openRouterService.chatCompletion({
      model,
      messages: apiMessages,
      temperature,
      max_tokens: maxTokens,
      tools: useTools ? TOOL_DEFINITIONS : undefined,
      tool_choice: useTools ? 'auto' : undefined,
    });

    const assistantMessage = response.choices?.[0]?.message;

    if (assistantMessage?.tool_calls?.length) {
      await handleToolCalls(assistantMessage, apiMessages, model, temperature, maxTokens);
    } else {
      const msg: LLMMessage = { role: 'assistant', content: assistantMessage?.content || '' };
      messages = [...messages, msg];
    }
  }

  async function handleToolCalls(
    assistantMessage: any,
    apiMessages: LLMMessage[],
    model: string,
    temperature: number,
    maxTokens: number,
    depth: number = 0,
  ) {
    const maxDepth = getSetting('maxToolDepth');
    if (maxDepth > 0 && depth >= maxDepth) {
      messages = [...messages, { role: 'assistant', content: '⚠️ Tool call depth limit reached.' }];
      return;
    }

    // Add assistant message with tool_calls to the conversation
    const assistantMsg: LLMMessage = {
      role: 'assistant',
      content: assistantMessage.content || null,
      tool_calls: assistantMessage.tool_calls,
    };
    messages = [...messages, assistantMsg];

    // Execute all tool calls in parallel
    const toolResults: LLMMessage[] = await Promise.all(
      assistantMessage.tool_calls.map(async (toolCall: any) => {
        const result = await executeTool(toolCall);
        return {
          role: 'tool' as const,
          content: result,
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
        };
      })
    );

    messages = [...messages, ...toolResults];

    // Continue the conversation with tool results
    const continuedMessages = [...apiMessages, assistantMsg, ...toolResults];

    const response = await openRouterService.chatCompletion({
      model,
      messages: continuedMessages,
      temperature,
      max_tokens: maxTokens,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
    });

    const nextMessage = response.choices?.[0]?.message;

    if (nextMessage?.tool_calls?.length) {
      // Recursive tool calls
      await handleToolCalls(nextMessage, continuedMessages, model, temperature, maxTokens, depth + 1);
    } else {
      messages = [...messages, { role: 'assistant', content: nextMessage?.content || '' }];
    }
  }

  // ---- RAG Context ----
  async function getRelevantContext(query: string): Promise<string | null> {
    try {
      const stats = await embeddingService.getStats();
      if (!stats || stats.totalVectors === 0) return null;

      const results = await embeddingService.search(query, 5);
      if (results.length === 0) return null;

      return embeddingService.buildContext(results);
    } catch {
      return null;
    }
  }

  // ---- Reindexing ----
  async function handleReindex() {
    if (isIndexing) return;
    isIndexing = true;
    indexProgress = 'Starting...';

    try {
      const journalFolders = getSetting('journalFolders') || [];
      const actorFolders = getSetting('actorFolders') || [];

      await embeddingService.reindexAll(
        journalFolders,
        actorFolders,
        (progress) => {
          indexProgress = progress.message || progress.phase;
        },
      );

      ui.notifications.info('FoundryAI: Indexing complete!');
    } catch (error: any) {
      ui.notifications.error(`Indexing failed: ${error.message}`);
    } finally {
      isIndexing = false;
      indexProgress = '';
    }
  }

  // ---- Session Recap ----
  async function handleGenerateRecap() {
    const sessions = chatSessionManager.listSessions();
    if (sessions.length === 0) {
      ui.notifications.warn('No chat sessions to recap.');
      return;
    }

    // Use today's sessions
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todaySessions = sessions.filter(s => s.updatedAt >= today.getTime());

    const sessionIds = todaySessions.length > 0
      ? todaySessions.map(s => s.id)
      : [sessions[0].id]; // Fallback to most recent

    recapProgress = { phase: 'preparing', message: 'Starting...' };

    try {
      const model = getSetting('chatModel');
      await sessionRecapManager.generateRecap(
        sessionIds,
        model,
        (progress) => { recapProgress = progress; },
      );
      ui.notifications.info('Session recap saved!');
    } catch (error: any) {
      ui.notifications.error(`Recap failed: ${error.message}`);
    } finally {
      recapProgress = null;
    }
  }

  // ---- Input Handling ----
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function openSettings() {
    openSettingsDialog(SettingsPanel);
  }
</script>

<div class="chat-window" class:sidebar={isSidebar}>
  <!-- Toolbar -->
  <div class="toolbar">
    <div class="toolbar-left">
      <button
        class="toolbar-btn"
        class:active={viewMode === 'chat'}
        onclick={() => { viewMode = 'chat'; }}
        title="Chat"
      >
        <i class="fas fa-comments"></i>
      </button>
      <button
        class="toolbar-btn"
        class:active={viewMode === 'sessions'}
        onclick={() => { viewMode = 'sessions'; }}
        title="Sessions"
      >
        <i class="fas fa-list"></i>
      </button>
    </div>

    <span class="toolbar-title" title={currentSessionName}>
      {currentSessionName}
    </span>

    <div class="toolbar-right">
      <button
        class="toolbar-btn"
        onclick={handleReindex}
        disabled={isIndexing}
        title={isIndexing ? indexProgress : 'Reindex RAG'}
      >
        <i class="fas fa-sync-alt" class:fa-spin={isIndexing}></i>
      </button>
      <button
        class="toolbar-btn"
        onclick={handleGenerateRecap}
        disabled={!!recapProgress}
        title="Generate Session Recap"
      >
        <i class="fas fa-scroll"></i>
      </button>
      <button class="toolbar-btn" onclick={openSettings} title="Settings">
        <i class="fas fa-cog"></i>
      </button>
    </div>
  </div>

  <!-- Recap Progress Banner -->
  {#if recapProgress}
    <div class="progress-banner">
      <i class="fas fa-spinner fa-spin"></i>
      {recapProgress.message}
    </div>
  {/if}

  <!-- Index Progress Banner -->
  {#if isIndexing}
    <div class="progress-banner index-banner">
      <i class="fas fa-database"></i>
      {indexProgress}
    </div>
  {/if}

  <!-- Content Area -->
  {#if viewMode === 'sessions'}
    <SessionList
      onSelectSession={loadSession}
      onNewSession={startNewSession}
      activeSessionId={currentSessionId ?? undefined}
    />
  {:else if viewMode === 'chat'}
    <!-- Messages Area -->
    <div class="messages-area">
      {#if !hasApiKey}
        <div class="setup-notice">
          <i class="fas fa-key"></i>
          <h3>Welcome to FoundryAI</h3>
          <p>Configure your OpenRouter API key to get started.</p>
          <button class="setup-btn" onclick={openSettings}>
            <i class="fas fa-cog"></i> Open Settings
          </button>
        </div>
      {:else if compactMessages.length === 0}
        <div class="empty-chat">
          <i class="fas fa-brain"></i>
          <h3>FoundryAI</h3>
          <p>Your AI DM Assistant</p>
          <div class="suggestions">
            <button onclick={() => { inputText = 'What do the players see when they enter the room?'; sendMessage(); }}>
              🎭 Describe a scene
            </button>
            <button onclick={() => { inputText = 'What DC should a Perception check be to notice the hidden door?'; sendMessage(); }}>
              🎲 Skill check guidance
            </button>
            <button onclick={() => { inputText = 'Voice the tavern keeper greeting the party'; sendMessage(); }}>
              🗣️ NPC dialogue
            </button>
            <button onclick={() => { inputText = 'Search my journals for information about the villain'; sendMessage(); }}>
              📖 Search lore
            </button>
          </div>
        </div>
      {:else}
        {#each compactMessages as item, i (i)}
          {#if item.type === 'tool-group'}
            <!-- Single compact box for all tool calls in this round -->
            <details class="tool-activity-group">
              <summary>
                <i class="fas fa-wrench"></i>
                <span>Tool calls: {item.toolCalls.map(tc => tc.name).join(', ')}</span>
                <span class="tool-count">({item.results.length} result{item.results.length !== 1 ? 's' : ''})</span>
              </summary>
              <div class="tool-results-list">
                {#each item.results as result}
                  <div class="tool-result-item">
                    <span class="tool-result-name">{result.name}</span>
                    <pre class="tool-result-data">{(() => { try { return JSON.stringify(JSON.parse(result.content), null, 2); } catch { return result.content; } })()}</pre>
                  </div>
                {/each}
              </div>
            </details>
          {:else if item.msg.role === 'user'}
            <!-- User message with edit/retry actions -->
            {#if editingIndex === item.index}
              <div class="message-edit-form">
                <textarea
                  class="edit-textarea"
                  bind:value={editText}
                  onkeydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitEdit(); } if (e.key === 'Escape') cancelEdit(); }}
                ></textarea>
                <div class="edit-actions">
                  <button class="edit-btn save" onclick={submitEdit}><i class="fas fa-check"></i> Send</button>
                  <button class="edit-btn cancel" onclick={cancelEdit}><i class="fas fa-times"></i> Cancel</button>
                </div>
              </div>
            {:else}
              <div class="user-message-wrapper">
                <MessageBubble
                  role="user"
                  content={typeof item.msg.content === 'string' ? item.msg.content : ''}
                />
                <div class="message-actions">
                  <button class="action-btn" title="Edit & resend" onclick={() => startEditMessage(item.index)}>
                    <i class="fas fa-pen"></i>
                  </button>
                  <button class="action-btn" title="Retry" onclick={() => retryFromMessage(item.index)}>
                    <i class="fas fa-redo"></i>
                  </button>
                </div>
              </div>
            {/if}
          {:else}
            <MessageBubble
              role={item.msg.role as 'user' | 'assistant' | 'system' | 'tool'}
              content={typeof item.msg.content === 'string' ? item.msg.content : ''}
              toolName={item.msg.name}
            />
          {/if}
        {/each}

        <!-- Streaming message -->
        {#if isGenerating && streamingContent}
          <MessageBubble
            role="assistant"
            content={streamingContent}
            isStreaming={true}
          />
        {/if}

        <!-- Generating indicator -->
        {#if isGenerating && !streamingContent}
          <div class="generating-indicator">
            <div class="dot-loader">
              <span></span><span></span><span></span>
            </div>
            <span>Thinking...</span>
          </div>
        {/if}
      {/if}

      <div bind:this={messagesEndEl}></div>
    </div>

    <!-- Input Area -->
    <div class="input-area">
      <textarea
        bind:this={inputEl}
        bind:value={inputText}
        onkeydown={handleKeydown}
        placeholder={isGenerating ? 'Generating...' : 'Ask FoundryAI...'}
        disabled={isGenerating || !hasApiKey}
        rows="1"
      ></textarea>
      <button
        class="send-btn"
        onclick={sendMessage}
        disabled={isGenerating || !inputText.trim() || !hasApiKey}
        title="Send (Enter)"
      >
        {#if isGenerating}
          <i class="fas fa-spinner fa-spin"></i>
        {:else}
          <i class="fas fa-paper-plane"></i>
        {/if}
      </button>
    </div>
  {/if}
</div>

<style>
  .chat-window {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--foundry-ai-bg, #1a1a2e);
    color: var(--foundry-ai-text, #e0e0e0);
    font-family: 'Signika', sans-serif;
    overflow: hidden;
  }

  /* ---- Toolbar ---- */
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.3);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    gap: 6px;
    min-height: 36px;
  }

  .toolbar-left,
  .toolbar-right {
    display: flex;
    gap: 2px;
  }

  .toolbar-title {
    flex: 1;
    text-align: center;
    font-size: 0.82em;
    font-weight: 500;
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding: 0 8px;
  }

  .toolbar-btn {
    background: none;
    border: 1px solid transparent;
    color: rgba(255, 255, 255, 0.5);
    padding: 4px 8px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85em;
    transition: all 0.15s;
  }

  .toolbar-btn:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
  }

  .toolbar-btn.active {
    color: #8b5cf6;
    background: rgba(139, 92, 246, 0.15);
    border-color: rgba(139, 92, 246, 0.3);
  }

  .toolbar-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  /* ---- Progress Banners ---- */
  .progress-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: rgba(139, 92, 246, 0.15);
    border-bottom: 1px solid rgba(139, 92, 246, 0.2);
    font-size: 0.8em;
    color: #c4b5fd;
  }

  .index-banner {
    background: rgba(59, 130, 246, 0.15);
    border-color: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
  }

  /* ---- Messages Area ---- */
  .messages-area {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    scroll-behavior: smooth;
  }

  .messages-area::-webkit-scrollbar {
    width: 6px;
  }

  .messages-area::-webkit-scrollbar-track {
    background: transparent;
  }

  .messages-area::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }

  /* ---- Tool activity group (compact) ---- */
  .tool-activity-group {
    margin: 4px 8px;
    border-left: 3px solid #f59e0b;
    border-radius: 4px;
    background: rgba(245, 158, 11, 0.08);
    font-size: 0.8em;
  }

  .tool-activity-group summary {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    color: #f59e0b;
    cursor: pointer;
    font-weight: 600;
    user-select: none;
  }

  .tool-activity-group summary::-webkit-details-marker {
    display: none;
  }

  .tool-activity-group summary::before {
    content: '▶';
    font-size: 0.7em;
    transition: transform 0.15s;
  }

  .tool-activity-group[open] summary::before {
    transform: rotate(90deg);
  }

  .tool-count {
    opacity: 0.6;
    font-weight: 400;
    font-size: 0.9em;
  }

  .tool-results-list {
    padding: 2px 8px 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .tool-result-item {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
    padding: 4px 6px;
  }

  .tool-result-name {
    font-weight: 600;
    color: #f59e0b;
    font-size: 0.85em;
    display: block;
    margin-bottom: 2px;
  }

  .tool-result-data {
    max-height: 150px;
    overflow-y: auto;
    white-space: pre-wrap;
    font-size: 0.8em;
    margin: 0;
    background: rgba(0, 0, 0, 0.15);
    padding: 4px;
    border-radius: 2px;
    color: rgba(255, 255, 255, 0.7);
  }

  /* ---- User message wrapper with actions ---- */
  .user-message-wrapper {
    position: relative;
  }

  .user-message-wrapper:hover .message-actions {
    opacity: 1;
  }

  .message-actions {
    display: flex;
    gap: 4px;
    position: absolute;
    bottom: -2px;
    right: 8px;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .action-btn {
    background: rgba(59, 130, 246, 0.3);
    border: none;
    color: rgba(255, 255, 255, 0.7);
    width: 22px;
    height: 22px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.65em;
    padding: 0;
  }

  .action-btn:hover {
    background: rgba(59, 130, 246, 0.6);
    color: #fff;
  }

  /* ---- Edit form ---- */
  .message-edit-form {
    margin: 4px 12px;
    background: rgba(59, 130, 246, 0.1);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 8px;
    padding: 8px;
  }

  .edit-textarea {
    width: 100%;
    min-height: 60px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: inherit;
    font-family: inherit;
    font-size: 0.9em;
    padding: 6px;
    resize: vertical;
    box-sizing: border-box;
  }

  .edit-actions {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    justify-content: flex-end;
  }

  .edit-btn {
    border: none;
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.8em;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .edit-btn.save {
    background: #3b82f6;
    color: #fff;
  }

  .edit-btn.save:hover {
    background: #2563eb;
  }

  .edit-btn.cancel {
    background: rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
  }

  .edit-btn.cancel:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* ---- Setup / Empty States ---- */
  .setup-notice,
  .empty-chat {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    text-align: center;
    padding: 24px;
    gap: 8px;
  }

  .setup-notice i,
  .empty-chat i {
    font-size: 3em;
    opacity: 0.2;
    margin-bottom: 8px;
  }

  .setup-notice h3,
  .empty-chat h3 {
    margin: 0;
    font-size: 1.1em;
    color: #e0c080;
  }

  .setup-notice p,
  .empty-chat p {
    margin: 0;
    font-size: 0.85em;
    opacity: 0.6;
  }

  .setup-btn {
    margin-top: 12px;
    background: rgba(139, 92, 246, 0.3);
    border: 1px solid rgba(139, 92, 246, 0.5);
    color: #c4b5fd;
    padding: 8px 16px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.9em;
    transition: all 0.2s;
  }

  .setup-btn:hover {
    background: rgba(139, 92, 246, 0.5);
    color: #fff;
  }

  .suggestions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 16px;
    justify-content: center;
  }

  .suggestions button {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.7);
    padding: 6px 12px;
    border-radius: 16px;
    cursor: pointer;
    font-size: 0.78em;
    transition: all 0.15s;
  }

  .suggestions button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
    border-color: rgba(255, 255, 255, 0.2);
  }

  /* ---- Generating Indicator ---- */
  .generating-indicator {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    font-size: 0.85em;
    color: rgba(255, 255, 255, 0.5);
  }

  .dot-loader {
    display: flex;
    gap: 4px;
  }

  .dot-loader span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #8b5cf6;
    animation: dot-bounce 1.4s infinite both;
  }

  .dot-loader span:nth-child(2) { animation-delay: 0.2s; }
  .dot-loader span:nth-child(3) { animation-delay: 0.4s; }

  @keyframes dot-bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.3; }
    40% { transform: scale(1); opacity: 1; }
  }

  /* ---- Input Area ---- */
  .input-area {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    padding: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.2);
  }

  .input-area textarea {
    flex: 1;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: inherit;
    padding: 8px 12px;
    font-family: inherit;
    font-size: 0.9em;
    resize: none;
    min-height: 38px;
    max-height: 120px;
    line-height: 1.4;
    outline: none;
    transition: border-color 0.15s;
  }

  .input-area textarea:focus {
    border-color: rgba(139, 92, 246, 0.5);
  }

  .input-area textarea:disabled {
    opacity: 0.4;
  }

  .input-area textarea::placeholder {
    color: rgba(255, 255, 255, 0.3);
  }

  .send-btn {
    background: #8b5cf6;
    border: none;
    color: #fff;
    width: 38px;
    height: 38px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.9em;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .send-btn:hover:not(:disabled) {
    background: #7c3aed;
    transform: scale(1.05);
  }

  .send-btn:disabled {
    background: rgba(139, 92, 246, 0.3);
    cursor: not-allowed;
  }

  /* ---- Sidebar adjustments ---- */
  .chat-window.sidebar {
    font-size: 0.95em;
  }

  .chat-window.sidebar .toolbar {
    padding: 4px 6px;
  }

  .chat-window.sidebar .messages-area {
    padding: 6px;
  }
</style>
