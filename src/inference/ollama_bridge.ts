import { z } from 'zod';

// --- Zod Schemas ---

export const AgentActionSchema = z.object({
  evaluation: z.preprocess((val) => String(val ?? ''), z.string()).optional().default(''),
  memory: z.preprocess((val) => String(val ?? ''), z.string()).optional().default(''),
  next_goal: z.preprocess((val) => String(val ?? ''), z.string()).optional().default(''),
  thought: z.preprocess((val) => String(val ?? ''), z.string()).optional().default(''),
  action: z.object({
    type: z.enum(['click', 'type', 'scroll', 'navigate', 'wait', 'done']),
    target_id: z.union([z.string(), z.number()]).nullish().transform(val => val?.toString()).describe('Element ID from the AOM snapshot'),
    value: z.string().preprocess((val) => val ? String(val) : null, z.string().nullish()).describe('Value to type or URL to navigate to'),
  }).catch({ type: 'wait' } as any), // Emergency fallback to 'wait' if action is corrupted
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
          num_ctx: 32768, // Expanded for massive AOM trees and long history
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
        content: `You are the ORYONIX STRATEGIC CORE. Your objective is: achievement through precision and brevity.

<perception>
- You act on a DEHYDRATED DOM TREE. 
- INDENTATION = Nesting (sidebar/modal/footer context).
- [idx]<tag> = INTERACTIVE element.
- <tag> = SEMANTIC LANDMARK (landmark context).
</perception>

<rules>
1. OBSERVE: Look at the last action in HISTORY. Did it work? (State in 'evaluation').
2. PLAN: What is the immediate SUB-GOAL? (State in 'next_goal').
3. EXECUTE: Return ONE valid JSON action.
4. BE CONCISE: Use exactly ONE sentence per thought field. NO yapping.
</rules>

<actions>
- click, type, navigate, wait, scroll (value: up/down), done.
</actions>

Return ONLY valid JSON.`,
      },
      {
        role: 'user',
        content: `${isRetry ? '⚠️ PREVIOUS JSON ERROR DETECTED. FIX SYNTAX.\n' : ''}Objective: ${objective}

History:
${actionHistory.length > 0 ? JSON.stringify(actionHistory.slice(-3), null, 2) : 'Start of session.'}

AOM Snapshot:
${aomSnapshot}

Output (JSON ONLY):`,
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
