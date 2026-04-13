import { ollama } from '../src/inference/ollama_bridge';
import type { ChatMessage } from '../src/inference/ollama_bridge';

export default defineBackground(() => {
  console.log('[Oryonix] Background worker started.');

  // --- State ---
  let chatHistory: ChatMessage[] = [];
  let currentObjective: string | null = null;
  let actionHistory: any[] = [];
  let isAgentRunning = false;

  // --- Icon Click → Toggle Side Panel ---
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    
    try {
      // Try sending toggle — works if content script is already injected
      await browser.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' });
    } catch {
      // Content script not injected yet on this tab.
      // Inject it programmatically, then toggle after a short delay.
      console.log('[Oryonix] Injecting content script into tab', tab.id);
      try {
        await browser.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content-scripts/content.js'],
        });
        // Wait for React to mount
        setTimeout(async () => {
          try {
            await browser.tabs.sendMessage(tab.id!, { type: 'TOGGLE_PANEL' });
          } catch (e) {
            console.warn('[Oryonix] Still could not reach content script after injection.', e);
          }
        }, 500);
      } catch (e) {
        console.error('[Oryonix] Failed to inject content script:', e);
      }
    }
  });

  // --- Message Router ---
  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const tabId = sender.tab?.id;

    switch (message.type) {
      case 'CHAT_SEND': {
        // User sent a chat message from the side panel
        handleChat(message.payload, tabId).catch(console.error);
        break;
      }

      case 'PING_OLLAMA': {
        ollama.ping().then((ok) => sendResponse({ online: ok }));
        return true; // async sendResponse
      }

      case 'CLEAR_HISTORY': {
        chatHistory = [];
        // Clear agent loop context
        currentObjective = null;
        actionHistory = [];
        isAgentRunning = false;
        break;
      }
    }
  });

  // --- Chat Handler ---
  async function handleChat(userMessage: string, tabId?: number) {
    if (!tabId) {
      // Message came from popup — find the active tab
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      tabId = activeTab?.id;
    }
    if (!tabId) return;

    // Add user message to history
    chatHistory.push({ role: 'user', content: userMessage });

    // Check if this looks like an action request (mentions clicking, typing, page interactions)
    const isActionRequest = /\b(click|type|fill|scroll|open|go to|navigate|search|submit|press|select|find.*(button|link|input))\b/i.test(userMessage);

    if (isActionRequest) {
      await startAgentLoop(userMessage, tabId);
    } else {
      await handleGeneralChat(userMessage, tabId);
    }
  }

  // --- General Conversation (no page interaction) ---
  async function handleGeneralChat(userMessage: string, tabId: number) {
    // Notify UI: assistant is typing
    sendToTab(tabId, { type: 'CHAT_STREAM_START' });

    try {
      const fullResponse = await ollama.chat(chatHistory, (token) => {
        sendToTab(tabId, { type: 'CHAT_STREAM_TOKEN', payload: token });
      });

      chatHistory.push({ role: 'assistant', content: fullResponse });
      sendToTab(tabId, { type: 'CHAT_STREAM_END', payload: fullResponse });
    } catch (err: any) {
      sendToTab(tabId, {
        type: 'CHAT_ERROR',
        payload: `Failed to reach Ollama: ${err.message}`,
      });
    }
  }

  // --- Autonomous Agent ReAct Loop ---
  async function startAgentLoop(objective: string, tabId: number) {
    if (isAgentRunning) {
      sendToTab(tabId, { type: 'CHAT_ERROR', payload: 'Agent is already running. Please wait.' });
      return;
    }
    
    currentObjective = objective;
    isAgentRunning = true;
    
    runAgentCycle(tabId);
  }

  async function runAgentCycle(tabId: number, isRetry = false) {
    if (!isAgentRunning || !currentObjective) return;

    try {
      // 1. Ensure we have a stable connection (Handle navigation)
      await ensureTabConnection(tabId);

      // 2. Tell UI we are thinking (only if not a silent retry)
      if (!isRetry) await safeSendMessage(tabId, { type: 'AGENT_THINKING_START' });

      // 3. Get AOM Snapshot
      const aomResponse = await safeSendMessage(tabId, { type: 'GET_AOM' });
      const aomSnapshot: string = aomResponse?.aom || '(no interactive elements found)';

      // 4. Plan next action using LLM
      let plan;
      try {
        plan = await ollama.planAction(
          currentObjective, 
          aomSnapshot, 
          actionHistory.slice(-5), 
          chatHistory,
          isRetry
        );
      } catch (err: any) {
        if (!isRetry && (err.message.includes('Thinking Error') || err.message.includes('JSON'))) {
          console.warn('[Oryonix] Detected JSON/Truncation error, attempting self-correction retry...');
          return runAgentCycle(tabId, true);
        }
        throw err;
      }

      // 5. Broadcast the 'thought' to the UI
      await safeSendMessage(tabId, { type: 'AGENT_THOUGHT', payload: plan.thought });

      // 6. Check if done
      if (plan.action.type === 'done') {
        chatHistory.push({ role: 'assistant', content: plan.thought });
        await safeSendMessage(tabId, { type: 'CHAT_STREAM_END', payload: plan.thought });
        isAgentRunning = false;
        currentObjective = null;
        await safeSendMessage(tabId, { type: 'AGENT_THINKING_END' });
        return;
      }

      // 7. Execute action and capture result
      const result = await safeSendMessage(tabId, { type: 'EXECUTE_ACTION', payload: plan.action });
      actionHistory.push({ ...plan, result });

      // 8. Wait and loop back
      const waitTime = plan.action.type === 'navigate' ? 1200 : 500;
      setTimeout(() => {
        runAgentCycle(tabId);
      }, waitTime);

    } catch (err: any) {
      console.error('[Oryonix] Agent Loop Error:', err);
      // Don't kill the loop for transient connection errors if we can help it
      if (err.message.includes('Could not establish connection')) {
        console.log('[Oryonix] Connection lost during cycle, attempting recovery...');
        setTimeout(() => runAgentCycle(tabId), 1000);
        return;
      }

      isAgentRunning = false;
      sendToTab(tabId, { type: 'AGENT_THINKING_END' });
      sendToTab(tabId, { type: 'CHAT_ERROR', payload: `Agent Loop Error: ${err.message}` });
      chatHistory.push({ role: 'system', content: `❌ Agent stopped due to error: ${err.message}` });
    }
  }

  // --- Resilience Helpers ---

  /**
   * Waits for the tab to finish loading and ensures the content script is injected.
   */
  async function ensureTabConnection(tabId: number) {
    let tab = await browser.tabs.get(tabId);
    
    // 1. Wait for navigation to complete
    let attempts = 0;
    while (tab.status === 'loading' && attempts < 10) {
      console.log(`[Oryonix] Tab ${tabId} is loading, waiting...`);
      await new Promise(r => setTimeout(r, 1000));
      tab = await browser.tabs.get(tabId);
      attempts++;
    }

    // 2. Test if content script responds
    try {
      await browser.tabs.sendMessage(tabId, { type: 'PING' });
    } catch {
      console.log('[Oryonix] Content script missing after navigation. Re-injecting...');
      await browser.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      });
      // Give React a moment to mount
      await new Promise(r => setTimeout(r, 500));
    }
  }

  /**
   * Sends a message with a retry mechanism for transient connection issues.
   */
  async function safeSendMessage(tabId: number, message: any, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await browser.tabs.sendMessage(tabId, message);
      } catch (e: any) {
        if (i === retries - 1) throw e;
        console.warn(`[Oryonix] Send failed, retrying (${i + 1}/${retries})...`, e.message);
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  // --- Utility ---
  function sendToTab(tabId: number, message: any) {
    browser.tabs.sendMessage(tabId, message).catch(() => {
      // Tab might have navigated, ignore
    });
  }
});

