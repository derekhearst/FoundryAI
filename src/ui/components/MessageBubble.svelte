<script lang="ts">
  import { micromark } from 'micromark';
  import { gfm, gfmHtml } from 'micromark-extension-gfm';

  interface Props {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    isStreaming?: boolean;
    toolName?: string;
  }

  let { role, content, isStreaming = false, toolName }: Props = $props();

  const renderedContent = $derived.by(() => {
    if (!content) return '';
    if (role === 'tool') {
      // Show tool results as preformatted
      try {
        const parsed = JSON.parse(content);
        return `<pre class="tool-result">${JSON.stringify(parsed, null, 2)}</pre>`;
      } catch {
        return `<pre class="tool-result">${escapeHtml(content)}</pre>`;
      }
    }
    // Render markdown for user/assistant messages
    try {
      return micromark(content, {
        extensions: [gfm()],
        htmlExtensions: [gfmHtml()],
      });
    } catch {
      return escapeHtml(content).replace(/\n/g, '<br>');
    }
  });

  function escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  const roleLabel = $derived(
    role === 'user' ? 'You'
    : role === 'assistant' ? 'FoundryAI'
    : role === 'tool' ? `🔧 ${toolName || 'Tool'}`
    : 'System'
  );

  const roleIcon = $derived(
    role === 'user' ? 'fa-user'
    : role === 'assistant' ? 'fa-brain'
    : role === 'tool' ? 'fa-wrench'
    : 'fa-cog'
  );
</script>

<div class="message-bubble message-{role}" class:streaming={isStreaming}>
  <div class="message-header">
    <i class="fas {roleIcon}"></i>
    <span class="message-role">{roleLabel}</span>
  </div>
  <div class="message-content">
    {#if role === 'tool'}
      <details class="tool-details">
        <summary>Tool Result: {toolName || 'Unknown'}</summary>
        <div class="tool-content">{@html renderedContent}</div>
      </details>
    {:else}
      {@html renderedContent}
    {/if}
    {#if isStreaming}
      <span class="streaming-cursor">▊</span>
    {/if}
  </div>
</div>

<style>
  .message-bubble {
    padding: 8px 12px;
    margin: 4px 0;
    border-radius: 8px;
    max-width: 95%;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }

  .message-user {
    background: rgba(59, 130, 246, 0.15);
    border-left: 3px solid #3b82f6;
    margin-left: 12px;
    align-self: flex-end;
  }

  .message-assistant {
    background: rgba(139, 92, 246, 0.15);
    border-left: 3px solid #8b5cf6;
    margin-right: 12px;
  }

  .message-system {
    background: rgba(100, 100, 100, 0.1);
    border-left: 3px solid #666;
    font-size: 0.85em;
    opacity: 0.7;
    margin: 2px 0;
  }

  .message-tool {
    background: rgba(245, 158, 11, 0.1);
    border-left: 3px solid #f59e0b;
    font-size: 0.9em;
    margin: 2px 8px;
  }

  .message-header {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75em;
    font-weight: 600;
    opacity: 0.7;
    margin-bottom: 4px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .message-content {
    line-height: 1.5;
    font-size: 0.9em;
  }

  .message-content :global(p) {
    margin: 0.3em 0;
  }

  .message-content :global(pre) {
    background: rgba(0, 0, 0, 0.3);
    padding: 8px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 0.85em;
    margin: 4px 0;
  }

  .message-content :global(code) {
    background: rgba(0, 0, 0, 0.2);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.9em;
  }

  .message-content :global(blockquote) {
    border-left: 3px solid #7b2d26;
    margin: 4px 0;
    padding: 4px 8px;
    background: rgba(123, 45, 38, 0.1);
    font-style: italic;
  }

  .message-content :global(ul),
  .message-content :global(ol) {
    margin: 4px 0;
    padding-left: 20px;
  }

  .message-content :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 4px 0;
    font-size: 0.9em;
  }

  .message-content :global(th),
  .message-content :global(td) {
    border: 1px solid rgba(255, 255, 255, 0.15);
    padding: 4px 8px;
  }

  .message-content :global(th) {
    background: rgba(255, 255, 255, 0.05);
    font-weight: 600;
  }

  .message-content :global(strong) {
    color: #e0c080;
  }

  .tool-details {
    cursor: pointer;
  }

  .tool-details summary {
    font-weight: 600;
    color: #f59e0b;
  }

  .tool-content {
    margin-top: 4px;
  }

  :global(.tool-result) {
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    font-size: 0.8em;
  }

  .streaming-cursor {
    display: inline-block;
    animation: blink 0.8s infinite;
    color: #8b5cf6;
    margin-left: 2px;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }

  .streaming {
    border-color: #8b5cf6;
    box-shadow: 0 0 8px rgba(139, 92, 246, 0.2);
  }
</style>
