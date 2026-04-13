export interface AOMNode {
  index: number;
  tag: string;
  id?: string;
  text?: string;
  role?: string;
  attributes?: Record<string, string>;
}

export class AOMParser {
  private static INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY',
  ]);

  private static INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'menuitem',
    'tab', 'switch', 'option', 'combobox', 'searchbox', 'slider',
  ]);

  private static MAX_ELEMENTS = 50;

  /**
   * Returns a flat, numbered list of interactive elements on the page.
   * This is what gets sent to the LLM — compact and token-efficient.
   *
   * Example output:
   *   [1] button "Submit" id=submit-btn
   *   [2] input[text] placeholder="Search..." id=search-input
   *   [3] a "Home" href=/home
   */
  public parseFlat(root: HTMLElement = document.body): string {
    const nodes = this.collectInteractive(root);
    return nodes
      .map((n) => {
        let line = `[${n.index}] ${n.tag}`;
        if (n.role) line += `[role=${n.role}]`;
        if (n.text) line += ` "${n.text}"`;
        if (n.id) line += ` id=${n.id}`;
        if (n.attributes) {
          for (const [k, v] of Object.entries(n.attributes)) {
            line += ` ${k}=${v}`;
          }
        }
        return line;
      })
      .join('\n');
  }

  /**
   * Returns the structured array of interactive AOM nodes.
   */
  public parseNodes(root: HTMLElement = document.body): AOMNode[] {
    return this.collectInteractive(root);
  }

  private collectInteractive(root: HTMLElement): AOMNode[] {
    const results: AOMNode[] = [];
    let index = 1;

    const walk = (el: HTMLElement) => {
      if (index > AOMParser.MAX_ELEMENTS) return;

      // Skip invisible elements
      if (el.offsetParent === null && el.tagName !== 'BODY') return;
      const tag = el.tagName;

      const role = el.getAttribute('role') || '';
      const isInteractive =
        AOMParser.INTERACTIVE_TAGS.has(tag) ||
        AOMParser.INTERACTIVE_ROLES.has(role) ||
        el.hasAttribute('onclick') ||
        el.hasAttribute('tabindex');

      if (isInteractive) {
        const node: AOMNode = {
          index,
          tag: tag.toLowerCase(),
        };

        if (el.id) node.id = el.id;
        if (role) node.role = role;

        // Get visible text (trimmed, capped)
        const label =
          el.getAttribute('aria-label') ||
          el.textContent?.trim().slice(0, 60) ||
          '';
        if (label) node.text = label;

        // Capture key attributes
        const attrs: Record<string, string> = {};
        for (const a of ['type', 'name', 'placeholder', 'href', 'value']) {
          const v = el.getAttribute(a);
          if (v) attrs[a] = v.slice(0, 80);
        }
        if (Object.keys(attrs).length > 0) node.attributes = attrs;

        results.push(node);
        index++;
      }

      for (const child of Array.from(el.children)) {
        walk(child as HTMLElement);
      }
    };

    walk(root);
    return results;
  }
}

export const aomParser = new AOMParser();
