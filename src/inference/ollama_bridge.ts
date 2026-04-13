import { z } from 'zod';

// --- Zod Schemas ---

export const AgentActionSchema = z.object({
  thought: z.string().describe('Reasoning for the current step'),
  action: z.object({
    type: z.enum(['click', 'type', 'scroll', 'navigate', 'wait', 'done']),
    target_id: z.string().nullish().describe('Element ID from the AOM snapshot'),
    value: z.string().nullish().describe('Value to type or URL to navigate to'),
  }),
});

export type AgentAction = z.infer<typeof AgentActionSchema>;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// --- Ollama Bridge ---

export class OllamaBridge {
  private endpoint: string;
  private model: string;

  constructor(
    endpoint = 'http://localhost:11434',
    model = 'haervwe/GLM-4.6V-Flash-9B:latest'
  ) {
    this.endpoint = endpoint;
    this.model = model;
  }

  /**
   * Check if the Ollama server is reachable and the model is loaded.
   */
  public async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * General-purpose chat. Streams tokens back via the onToken callback.
   * Returns the full accumulated response when done.
   */
  public async chat(
    messages: ChatMessage[],
    onToken?: (token: string) => void
  ): Promise<string> {
    const res = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: true,
        options: {
          num_ctx: 8192, // Increased per user request for complex AOMs
          num_predict: 1024,
          temperature: 0.2,
        },
      }),



    });

    if (!res.ok) {
      throw new Error(`Ollama API returned ${res.status}`);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let fullResponse = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      // Ollama streams newline-delimited JSON objects
      const lines = chunk.split('\n').filter(Boolean);

      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          if (json.message?.content) {
            fullResponse += json.message.content;
            onToken?.(json.message.content);
          }
        } catch {
          // Partial JSON line, skip
        }
      }
    }

    return fullResponse;
  }

  /**
   * Action-planning mode. Sends the AOM + objective to the LLM
   * and parses a structured JSON action from the response.
   */
  public async planAction(
    objective: string,
    aomSnapshot: string,
    actionHistory: AgentAction[] = [],
    chatHistory: ChatMessage[] = [],
    isRetry = false
  ): Promise<AgentAction> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are the ORYONIX STRATEGIC CORE. 
Compose your brain of 5 specialized sub-agents: @INTEL, @TACTICIAN, @EXECUTOR, @CRITIC, @GUARD.

### PROTOCOL:
- Rapid reasoning. Return ONLY valid JSON.
- @CRITIC: Always verify the success of the last action from HISTORY.
- @TACTICIAN: Only issue "done" if the goal is FULLY achieved.
- Fields: "thought", "action" { "type", "target_id", "value" }.

Valid actions: click, type, navigate, wait, done.`,
      },
      {
        role: 'user',
        content: `${isRetry ? '⚠️ YOUR PREVIOUS RESPONSE HAD A JSON SYNTAX ERROR. PLEASE FIX IT.\n' : ''}Current Objective: ${objective}

Conversation Context:
${chatHistory.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n')}

Action History (Plan + Outcome):
${actionHistory.length > 0 ? JSON.stringify(actionHistory, null, 2) : 'No actions taken yet.'}

Current Interactive elements:
${aomSnapshot}

Next Action (JSON ONLY):`,
      },

    ];

    const fullResponse = await this.chat(messages);
    const healedJSON = this.robustJSONHeal(fullResponse);

    try {
      const parsed = AgentActionSchema.parse(JSON.parse(healedJSON));
      return parsed;
    } catch (err: any) {
      console.error('[Oryonix] JSON Parsing failed even after healing:', err);
      console.log('[Oryonix] Raw Response:', fullResponse);
      console.log('[Oryonix] Healed JSON Attempt:', healedJSON);
      throw new Error(`Agent Thinking Error: ${err.message}. Please retry.`);
    }
  }

  /**
   * Resilient JSON extraction and "healing" for LLM outputs.
   */
  private robustJSONHeal(raw: string): string {
    let result = raw.trim();

    // 1. Extract content between first '{' and last '}'
    const start = result.indexOf('{');
    const end = result.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      result = result.substring(start, end + 1);
    } else {
      return result; // Fallback to raw if no braces found
    }

    // 2. Fix literal newlines in multi-line strings
    // LLMs often forget to escape \n inside JSON values.
    result = result.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/g, (match) => {
      return match.replace(/\n/g, '\\n');
    });

    // 3. Remove trailing commas (e.g., [1, 2,] or {"a": 1,})
    result = result.replace(/,\s*([}\]])/g, '$1');

    // 4. Auto-close truncated JSON (Emergency Healing)
    if (result.startsWith('{') && !result.endsWith('}')) {
      const openBraces = (result.match(/{/g) || []).length;
      const closeBraces = (result.match(/}/g) || []).length;
      if (openBraces > closeBraces) {
        result += '}'.repeat(openBraces - closeBraces);
      }
    }

    return result;

  }

}

export const ollama = new OllamaBridge();
