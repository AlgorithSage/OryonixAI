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
          num_ctx: 4096,
          temperature: 0.4,
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
    chatHistory: ChatMessage[] = []
  ): Promise<AgentAction> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are the ORYONIX STRATEGIC CORE, a high-intelligence autonomous browser agent. 
Your brain is composed of 5 specialized internal sub-agents who must collaborate to accomplish the objective.

### THE INTERNAL PENTARCHY:
1. @INTEL (DOM Expert): Deeply analyzes the AOM tree. Identifies semantic meaning of elements (search bars, filters, hidden menus).
2. @TACTICIAN (The Strategist): Maps the multi-step journey. If the user wants a YouTube channel, @TACTICIAN decides to go to youtube.com/search before clicking.
3. @EXECUTOR (Technical Operator): Decides the exact CDP action (click, type, navigate) on specific target IDs.
4. @CRITIC (The Auditor): Audits the outcome of the last action. Checks if we are on the right page or if a pop-up blocked us.
5. @GUARD (Privacy Guardian): Performs a pre-flight safety check. BLOCKS any action that involves passwords or PII.

### OPERATIONAL PROTOCOL:
- You MUST think through each role before deciding the final action.
- @TACTICIAN should favor internal site features (e.g. search bars, filters) over generic Google searches for depth.
- If an objective requires multiple steps (like Amazon filtering), @TACTICIAN must roadmap them.

### OUTPUT FORMAT:
Return ONLY valid JSON. The "thought" field must contain the internal dialogue starting with the agent handles.

{
  "thought": "@INTEL: [analysis of DOM] \n@TACTICIAN: [multi-step logic] \n@EXECUTOR: [picked ID] \n@GUARD: [safety check] \n@CRITIC: [success validation]",
  "action": {
    "type": "click|type|scroll|navigate|wait|done",
    "target_id": "the [number] element ID",
    "value": "text or URL"
  }
}

Rules:
- click: Buttons/links
- type: Fill inputs
- navigate: Go to URL
- wait: Page loading
- done: Objective complete
- DO NOT use markdown code fences. Raw JSON only.`,
      },
      {
        role: 'user',
        content: `Current Objective: ${objective}

Conversation Context:
${chatHistory.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n')}

Action History (technical steps taken):
${actionHistory.length > 0 ? JSON.stringify(actionHistory, null, 2) : 'No actions taken yet.'}

Current Interactive elements:
${aomSnapshot}

What is the next action?`,
      },
    ];

    const fullResponse = await this.chat(messages);

    // Try to extract JSON from the response
    let jsonStr = fullResponse.trim();

    // 1. Extract content between first '{' and last '}'
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      jsonStr = jsonStr.substring(start, end + 1);
    }

    // 2. Escape literal newlines within the 'thought' field (LLMs often forget this)
    const thoughtMatch = jsonStr.match(/"thought"\s*:\s*"([\s\S]*?)"\s*(?:,|\})/);
    if (thoughtMatch) {
      const originalThought = thoughtMatch[1];
      const escapedThought = originalThought.replace(/\n/g, '\\n');
      jsonStr = jsonStr.replace(originalThought, escapedThought);
    }

    try {
      const parsed = AgentActionSchema.parse(JSON.parse(jsonStr));
      return parsed;
    } catch (err: any) {
      console.error('[Oryonix] JSON Parsing failed:', err);
      console.log('[Oryonix] Raw Response:', fullResponse);
      throw new Error(`Agent Thinking Error: ${err.message}. Please retry.`);
    }
  }
}

export const ollama = new OllamaBridge();
