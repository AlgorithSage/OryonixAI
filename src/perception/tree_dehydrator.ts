/**
 * TreeDehydrator: A hierarchical perception engine inspired by Alibaba Page-Agent.
 * It converts the complex DOM into a "dehydrated" skeleton of interactive and semantic elements.
 */

export interface DehydratedNode {
  index?: number;
  tag: string;
  text?: string;
  attributes?: Record<string, string>;
  children: DehydratedNode[];
  isSemantic: boolean;
}

export class TreeDehydrator {
  private static INTERACTIVE_TAGS = new Set([
    'A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY',
  ]);

  private static SEMANTIC_TAGS = new Set([
    'NAV', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'SECTION', 'FORM', 'ARTICLE',
  ]);

  private static INTERACTIVE_ROLES = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'menuitem', 'tab', 'switch',
  ]);

  private indexCounter = 1;
  private nodesMap = new Map<number, HTMLElement>();

  /**
   * Main entry point: Generates an indented tree string for the LLM.
   */
  public dehydrate(root: HTMLElement = document.body): string {
    this.indexCounter = 1;
    this.nodesMap.clear();
    
    const tree = this.walk(root);
    if (!tree) return "Empty Page";
    
    return this.render(tree, 0);
  }

  /**
   * Returns the mapping of numeric indices to DOM elements for execution.
   */
  public getElementMap(): Map<number, HTMLElement> {
    return this.nodesMap;
  }

  private walk(el: HTMLElement): DehydratedNode | null {
    // Skip invisible
    if (el.offsetParent === null && el.tagName !== 'BODY') return null;

    const tag = el.tagName;
    const role = el.getAttribute('role') || '';
    const isInteractive = 
      TreeDehydrator.INTERACTIVE_TAGS.has(tag) || 
      TreeDehydrator.INTERACTIVE_ROLES.has(role) ||
      el.hasAttribute('onclick') ||
      el.hasAttribute('tabindex');

    const isSemantic = TreeDehydrator.SEMANTIC_TAGS.has(tag);

    // If it's neither interactive nor semantic, check children
    const childrenNodes: DehydratedNode[] = [];
    for (const child of Array.from(el.children)) {
      const result = this.walk(child as HTMLElement);
      if (result) childrenNodes.push(result);
    }

    // A node is kept if it's interactive, semantic, or has interesting children
    if (isInteractive || isSemantic || childrenNodes.length > 0) {
      const node: DehydratedNode = {
        tag: tag.toLowerCase(),
        children: childrenNodes,
        isSemantic: isSemantic && !isInteractive,
      };

      if (isInteractive) {
        node.index = this.indexCounter++;
        this.nodesMap.set(node.index, el);

        // Capture text
        const label = el.getAttribute('aria-label') || el.textContent?.trim() || '';
        if (label) node.text = label.slice(0, 50);

        // Capture core attributes
        const attrs: Record<string, string> = {};
        for (const a of ['type', 'name', 'placeholder', 'value', 'href']) {
          const v = el.getAttribute(a);
          if (v) attrs[a] = v.slice(0, 50);
        }
        if (Object.keys(attrs).length > 0) node.attributes = attrs;
      }

      return node;
    }

    return null;
  }

  private render(node: DehydratedNode, depth: number): string {
    const indent = '  '.repeat(depth);
    const indexPart = node.index ? `[${node.index}]` : '';
    
    let attrsStr = '';
    if (node.attributes) {
      attrsStr = Object.entries(node.attributes)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      if (attrsStr) attrsStr = ' ' + attrsStr;
    }

    let line = `${indent}${indexPart}<${node.tag}${attrsStr}`;
    
    if (node.children.length === 0) {
      if (node.text) {
        return `${line}>${node.text}</${node.tag}>`;
      }
      return `${line} />`;
    }

    line += '>';
    if (node.text) line += ` ${node.text}`;

    const childrenStr = node.children
      .map(c => this.render(c, depth + 1))
      .join('\n');
    
    return `${line}\n${childrenStr}\n${indent}</${node.tag}>`;
  }
}

export const treeDehydrator = new TreeDehydrator();
