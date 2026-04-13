import React from 'react';
import { createRoot } from 'react-dom/client';
import { SidePanel, usePanelStore } from '../src/ui/hitl_overlay';
import { treeDehydrator } from '../src/perception/tree_dehydrator';

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

        case 'PING':
          sendResponse({ pong: true });
          break;

        case 'GET_AOM': {
          const aom = treeDehydrator.dehydrate();
          sendResponse({ aom });
          return false; // sync response
        }

        case 'EXECUTE_ACTION': {
          executeAction(message.payload).then((result) => {
            sendResponse(result);
          });
          return true; // async response
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

    // --- Inject Global Layout Styles ---
    const styleId = 'oryonix-layout-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        html.oryonix-shifted {
          transition: margin-right 0.2s ease !important;
          width: auto !important;
        }
        body.oryonix-shifted-body {
          overflow-x: hidden !important;
        }
      `;
      document.head.appendChild(style);
    }

    // --- Mount the side panel into a Shadow DOM ---
    const host = document.createElement('div');
    host.id = 'oryonix-root';
    host.style.cssText = `
      all: initial !important;
      display: block !important;
      position: fixed !important;
      top: 0 !important;
      right: 0 !important;
      width: 0 !important;
      height: 100vh !important;
      z-index: 2147483647 !important;
    `;
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    // Inject Inter font
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

    // --- Layout Driver: Sync Page Margin with Sidebar ---
    usePanelStore.subscribe((state) => {
      const html = document.documentElement;
      const body = document.body;
      
      if (state.visible) {
        html.classList.add('oryonix-shifted');
        body.classList.add('oryonix-shifted-body');
        html.style.marginRight = `${state.panelWidth}px`;
        host.style.width = `${state.panelWidth}px`;
      } else {
        html.style.marginRight = '0';
        host.style.width = '0';
        // Delay cleanup for transition
        setTimeout(() => {
          if (!usePanelStore.getState().visible) {
            html.classList.remove('oryonix-shifted');
            body.classList.remove('oryonix-shifted-body');
          }
        }, 200);
      }
    });

    // Restore persistent visibility state
    if (typeof browser !== 'undefined' && browser.storage) {
      browser.storage.local.get(['isPanelOpen', 'panelWidth']).then((storage) => {
        if (storage.panelWidth) usePanelStore.getState().setPanelWidth(storage.panelWidth);
        if (storage.isPanelOpen) {
          console.log('[Oryonix] Restoring open state from storage...');
          usePanelStore.getState().show();
        }
      }).catch(e => console.warn('[Oryonix] Storage error:', e));
    }
  },
});

// --- DOM Action Executor ---
async function executeAction(action: { type: string; target_id?: string; value?: string }): Promise<{ status: string; message: string }> {
  if (action.type === 'scroll') {
    const amount = action.value === 'up' ? -400 : 400;
    window.scrollBy({ top: amount, behavior: 'smooth' });
    return { status: 'success', message: `Scrolled ${action.value}` };
  }

  if (action.type === 'navigate' && action.value) {
    window.location.href = action.value;
    return { status: 'success', message: `Navigating to ${action.value}` };
  }

  if (action.type === 'wait') {
    await new Promise(r => setTimeout(r, 1500));
    return { status: 'success', message: 'Waited 1.5s' };
  }

  if (!action.target_id) {
    return { status: 'failed', message: 'No target_id provided' };
  }

  const targetIndex = parseInt(action.target_id, 10);
  const el = treeDehydrator.getElementMap().get(targetIndex);

  if (!el) {
    return { status: 'failed', message: `Element [${targetIndex}] not found. Page structure might have shifted.` };
  }

  try {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    
    if (action.type === 'click') {
      el.click();
      el.focus();
    } else if (action.type === 'type' && action.value) {
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
        el.value = action.value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        // Auto-submit search/forms
        const isSearch = el.type === 'search' || el.name?.includes('q') || el.placeholder?.toLowerCase().includes('search');
        if (isSearch) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
          (el.closest('form') as HTMLFormElement)?.submit();
        }
      }
    }
    return { status: 'success', message: `Successfully ${action.type}ed element [${targetIndex}]` };
  } catch (err: any) {
    return { status: 'failed', message: `Action failed: ${err.message}` };
  }
}

