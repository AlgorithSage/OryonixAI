import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidePanel, usePanelStore } from '../src/ui/hitl_overlay';
import { aomParser } from '../src/perception/aom_parser';

export default defineContentScript({
  matches: ['<all_urls>'],

  async main() {
    console.log('[Oryonix] Content script loaded.');

    // --- Message Listener (Registered Immediately) ---
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const store = usePanelStore.getState();

      switch (message.type) {
        case 'TOGGLE_PANEL':
          store.toggle();
          break;

        case 'GET_AOM': {
          const aom = aomParser.parseFlat();
          sendResponse({ aom });
          return false; // sync response
        }

        case 'EXECUTE_ACTION': {
          executeAction(message.payload);
          sendResponse({ ok: true });
          return false;
        }

        case 'CHAT_STREAM_START':
          store.addMessage({
            id: `msg-${Date.now()}`,
            role: 'assistant',
            content: '',
            pending: true,
          });
          break;

        case 'CHAT_STREAM_TOKEN':
          store.updateLastAssistant(message.payload);
          break;

        case 'CHAT_STREAM_END':
          store.finalizeLastAssistant(message.payload);
          break;

        case 'CHAT_ERROR':
          store.addMessage({
            id: `err-${Date.now()}`,
            role: 'system',
            content: `❌ ${message.payload}`,
          });
          break;

        case 'AGENT_THINKING_START':
          store.setThinking(true);
          break;

        case 'AGENT_THOUGHT':
          store.addAgentThought(message.payload);
          break;

        case 'AGENT_THINKING_END':
          store.setThinking(false);
          break;
      }
    });

    // --- Idempotency Check ---
    if (document.getElementById('oryonix-root')) {
      console.log('[Oryonix] Already mounted on this page.');
      return;
    }

    console.log('[Oryonix] Initializing Shadow DOM mount...');

    // --- Mount the side panel into a Shadow DOM ---
    const host = document.createElement('div');
    host.id = 'oryonix-root';
    // Position fixed to ensure the shadow root is a top-level layering host
    host.style.cssText = `
      all: initial !important;
      display: block !important;
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      width: 0 !important;
      height: 0 !important;
      z-index: 2147483647 !important;
    `;
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    // Inject Inter font into main document (Shadow DOM can't load fonts on its own)
    if (!document.querySelector('link[data-oryonix-font]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap';
      link.setAttribute('data-oryonix-font', 'true');
      document.head.appendChild(link);
    }

    const container = document.createElement('div');
    shadow.appendChild(container);

    console.log('[Oryonix] Rendering React root...');
    const root = createRoot(container);
    root.render(<SidePanel />);
    console.log('[Oryonix] React mounted successfully.');

    // Restore persistent visibility state (NON-BLOCKING)
    if (typeof browser !== 'undefined' && browser.storage) {
      browser.storage.local.get('isPanelOpen').then((storage) => {
        if (storage.isPanelOpen) {
          console.log('[Oryonix] Restoring open state from storage...');
          usePanelStore.getState().show();
        }
      }).catch(e => console.warn('[Oryonix] Storage error:', e));
    }
  },
});

// --- DOM Action Executor ---
function executeAction(action: { type: string; target_id?: string; value?: string }) {
  if (!action.target_id && action.type !== 'scroll') return;

  // The target_id is the AOM index number. Re-parse to find the actual element.
  const nodes = aomParser.parseNodes();
  const targetIndex = parseInt(action.target_id || '0', 10);
  const targetNode = nodes.find((n) => n.index === targetIndex);

  if (action.type === 'scroll') {
    const amount = action.value === 'up' ? -400 : 400;
    window.scrollBy({ top: amount, behavior: 'smooth' });
    return;
  }

  if (!targetNode) {
    console.warn(`[Oryonix] No element found for AOM index ${targetIndex}`);
    return;
  }

  // Find the actual DOM element by matching attributes
  const allInteractive = document.querySelectorAll(
    'a, button, input, select, textarea, [role="button"], [role="link"], [onclick], [tabindex]'
  );

  let idx = 0;
  for (const el of allInteractive) {
    const htmlEl = el as HTMLElement;
    if (htmlEl.offsetParent === null) continue; // skip hidden
    idx++;
    if (idx === targetIndex) {
      if (action.type === 'click') {
        htmlEl.click();
        htmlEl.focus();
      } else if (action.type === 'type' && action.value) {
        if (htmlEl instanceof HTMLInputElement || htmlEl instanceof HTMLTextAreaElement) {
          htmlEl.focus();
          htmlEl.value = action.value;
          htmlEl.dispatchEvent(new Event('input', { bubbles: true }));
          htmlEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      return;
    }
  }
}
