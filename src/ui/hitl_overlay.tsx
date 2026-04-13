import React, { useState, useRef, useEffect } from 'react';
import { create } from 'zustand';

// --- Types ---

interface ChatMsg {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  pending?: boolean; // true while streaming
}

interface PendingAction {
  type: string;
  target_id?: string;
  value?: string;
}

interface PanelState {
  visible: boolean;
  messages: ChatMsg[];
  ollamaOnline: boolean;
  agentThoughts: string[];
  isThinking: boolean;
  toggle: () => void;
  show: () => void;
  hide: () => void;
  addMessage: (msg: ChatMsg) => void;
  updateLastAssistant: (content: string) => void;
  finalizeLastAssistant: (content: string) => void;
  setOllamaOnline: (online: boolean) => void;
  clearMessages: () => void;
  addAgentThought: (thought: string) => void;
  setThinking: (thinking: boolean) => void;
}

export const usePanelStore = create<PanelState>((set) => ({
  visible: false,
  messages: [],
  agentThoughts: [],
  isThinking: false,
  ollamaOnline: false,

  toggle: () => set((s) => {
    const next = !s.visible;
    if (typeof browser !== 'undefined' && browser.storage) browser.storage.local.set({ isPanelOpen: next });
    return { visible: next };
  }),
  show: () => set(() => {
    if (typeof browser !== 'undefined' && browser.storage) browser.storage.local.set({ isPanelOpen: true });
    return { visible: true };
  }),
  hide: () => set(() => {
    if (typeof browser !== 'undefined' && browser.storage) browser.storage.local.set({ isPanelOpen: false });
    return { visible: false };
  }),

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  updateLastAssistant: (content) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant' && last.pending) {
        last.content += content;
      }
      return { messages: msgs };
    }),

  finalizeLastAssistant: (content) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') {
        last.content = content;
        last.pending = false;
      }
      return { messages: msgs };
    }),

  setOllamaOnline: (online) => set({ ollamaOnline: online }),

  clearMessages: () => set({ messages: [], agentThoughts: [], isThinking: false }),

  addAgentThought: (thought) => set((s) => ({ agentThoughts: [...s.agentThoughts, thought] })),
  setThinking: (thinking) => set((s) => ({ isThinking: thinking, agentThoughts: thinking ? [] : s.agentThoughts })),
}));

// --- Component ---

export const SidePanel: React.FC = () => {
  const {
    visible,
    messages,
    ollamaOnline,
    agentThoughts,
    isThinking,
    toggle,
    addMessage,
    setOllamaOnline,
    clearMessages,
    hide,
  } = usePanelStore();

  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, agentThoughts, isThinking]);

  // Ping Ollama on mount
  useEffect(() => {
    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime.sendMessage({ type: 'PING_OLLAMA' }).then((res: any) => {
        setOllamaOnline(res?.online ?? false);
      }).catch(() => setOllamaOnline(false));
    }
  }, [visible]);

  const handleSend = () => {
    const text = input.trim();
    if (!text) return;

    addMessage({ id: `user-${Date.now()}`, role: 'user', content: text });
    setInput('');

    if (typeof browser !== 'undefined' && browser.runtime) {
      browser.runtime.sendMessage({ type: 'CHAT_SEND', payload: text });
    }
  };

  const [expandedThoughts, setExpandedThoughts] = useState(false);

  // --- Active Mode Glow Overlay ---
  const ActiveGlow = () => {
    if (!isThinking) return null;
    return (
      <div 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 2147483640, // Just below side panel
          pointerEvents: 'none',
          boxShadow: 'inset 0 0 60px rgba(251, 191, 36, 0.4)',
          animation: 'pulseGlow 2s infinite ease-in-out',
        }}
      />
    );
  };

  // --- Collapsed state: floating tab ---
  if (!visible) {
    return (
      <>
        <ActiveGlow />
        <div 
          id="oryonix-retract-handle"
        onClick={toggle}
        onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#6d28d9')}
        onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#7c3aed')}
        style={{
          position: 'fixed',
          top: '50%',
          right: 0,
          transform: 'translateY(-50%)',
          backgroundColor: '#7c3aed',
          color: '#fff',
          width: '28px',
          height: '60px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderTopLeftRadius: '12px',
          borderBottomLeftRadius: '12px',
          cursor: 'pointer',
          zIndex: 2147483647,
          boxShadow: '-2px 0 12px rgba(124, 58, 237, 0.5)',
          fontFamily: "'Inter', sans-serif",
          transition: 'all 0.2s ease',
        }}
        title="Open Oryonix AI"
      >
        <span style={{ transform: 'rotate(-90deg)', fontSize: '14px', fontWeight: 'bold' }}>▼</span>
      </div>
    </>
  );
}

  // --- Styles (inline for Shadow DOM compatibility) ---
  const S = {
    panel: {
      position: 'fixed' as const,
      top: 0,
      right: 0,
      width: '380px',
      height: '100vh',
      backgroundColor: '#1a1a2e',
      borderLeft: '1px solid rgba(255,255,255,0.08)',
      color: '#e2e8f0',
      fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
      display: 'flex',
      flexDirection: 'column' as const,
      zIndex: 2147483647,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
      boxSizing: 'border-box' as const,
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 20px',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
      flexShrink: 0,
    },
    headerTitle: {
      margin: 0,
      fontSize: '15px',
      fontWeight: 700,
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    headerActions: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    headerActionIcon: {
      background: 'none',
      border: 'none',
      color: '#94a3b8',
      cursor: 'pointer',
      fontSize: '14px',
      padding: '4px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '4px',
    },
    chatArea: {
      flex: 1,
      overflowY: 'auto' as const,
      padding: '16px 20px',
    },
    msgBubble: (isUser: boolean, isSystem: boolean) => ({
      maxWidth: '90%',
      padding: '10px 14px',
      borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
      marginBottom: '12px',
      fontSize: '13px',
      lineHeight: '1.5',
      backgroundColor: isSystem
        ? 'rgba(239, 68, 68, 0.1)'
        : isUser
        ? '#7c3aed'
        : 'rgba(255,255,255,0.06)',
      color: isSystem ? '#fca5a5' : '#e2e8f0',
      alignSelf: isUser ? 'flex-end' : 'flex-start',
      wordBreak: 'break-word' as const,
      whiteSpace: 'pre-wrap' as const,
    }),
    thinkingBox: {
      margin: '8px 0 16px',
      borderRadius: '10px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden',
    },
    thinkingHeader: {
      padding: '10px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      color: '#a78bfa',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      userSelect: 'none' as const,
    },
    thinkingBody: {
      padding: '0 14px 14px',
      fontSize: '13px',
      color: '#94a3b8',
      fontFamily: 'monospace',
      lineHeight: 1.5,
      whiteSpace: 'pre-wrap' as const,
    },
    inputArea: {
      padding: '12px 20px 16px',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      gap: '8px',
      flexShrink: 0,
    },
    input: {
      flex: 1,
      padding: '12px',
      background: 'rgba(255,255,255,0.06)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '10px',
      color: '#e2e8f0',
      fontSize: '14px',
      outline: 'none',
      fontFamily: 'inherit',
    },
    sendBtn: {
      padding: '12px 16px',
      background: '#7c3aed',
      color: '#fff',
      border: 'none',
      borderRadius: '10px',
      cursor: 'pointer',
      fontWeight: 600,
      fontSize: '14px',
    },
    statusDot: (online: boolean) => ({
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: online ? '#10b981' : '#ef4444',
      boxShadow: online ? '0 0 6px #10b981' : 'none',
    }),
  };

  return (
    <>
      <ActiveGlow />
      <style>
        {`
          @keyframes pulseGlow {
            0% { box-shadow: inset 0 0 40px rgba(251, 191, 36, 0.2); }
            50% { box-shadow: inset 0 0 80px rgba(251, 191, 36, 0.5); }
            100% { box-shadow: inset 0 0 40px rgba(251, 191, 36, 0.2); }
          }
        `}
      </style>
      <div style={S.panel}>
      {/* Header */}
      <div style={S.header}>
        <h3 style={S.headerTitle}>
          <span style={{ fontSize: '18px' }}>✦</span>
          Oryonix AI
          <span style={S.statusDot(ollamaOnline)} title={ollamaOnline ? 'Model online' : 'Model offline'} />
        </h3>
        <div style={S.headerActions}>
          <button style={S.headerActionIcon} title="Retract" onClick={hide}>
            ▶
          </button>
          <button style={S.headerActionIcon} title="New chat" onClick={() => {
            clearMessages();
            if (typeof browser !== 'undefined') browser.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
          }}>
            ⟳
          </button>
        </div>
      </div>

      {/* Chat Messages */}
      <div ref={scrollRef} style={S.chatArea}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {messages.length === 0 && (
            <div style={{ textAlign: 'center', color: '#64748b', marginTop: '40px' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>✦</div>
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>How can I help you today?</div>
              <div style={{ fontSize: '12px' }}>Ask me anything, or tell me to interact with this page.</div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} style={S.msgBubble(msg.role === 'user', msg.role === 'system')}>
              {msg.content || (msg.pending ? '...' : '')}
            </div>
          ))}

          {/* Agent Thoughts UI */}
          {(isThinking || agentThoughts.length > 0) && (
            <div style={S.thinkingBox}>
              <div 
                style={S.thinkingHeader}
                onClick={() => setExpandedThoughts(!expandedThoughts)}
              >
                {isThinking ? '🧠 Agent is thinking...' : '🧠 View agent thoughts'}
                <span style={{ marginLeft: 'auto', fontSize: '10px' }}>
                  {expandedThoughts ? '▲' : '▼'}
                </span>
              </div>
              {expandedThoughts && agentThoughts.length > 0 && (
                <div style={S.thinkingBody}>
                  {agentThoughts.map((t, i) => {
                    const formatThinking = (text: string) => {
                      const roles = {
                        '@INTEL:': '#22d3ee',
                        '@TACTICIAN:': '#fbbf24',
                        '@EXECUTOR:': '#fb7185',
                        '@GUARD:': '#ef4444',
                        '@CRITIC:': '#34d399',
                      };
                      
                      let formatted = text;
                      Object.entries(roles).forEach(([role, color]) => {
                        formatted = formatted.replaceAll(role, `<span style="color: ${color}; font-weight: bold;">${role}</span>`);
                      });
                      
                      return <div dangerouslySetInnerHTML={{ __html: formatted.replace(/\n/g, '<br/>') }} />;
                    };

                    return (
                      <div key={i} style={{ marginBottom: '12px', paddingBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '12px', lineHeight: '1.6' }}>
                        <strong style={{ color: '#94a3b8', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Step {i + 1}</strong>
                        <div style={{ marginTop: '4px' }}>
                          {formatThinking(t)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div style={S.inputArea}>
        <input
          style={S.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="How can I help you today?"
          disabled={!ollamaOnline}
        />
        <button
          style={{
            ...S.sendBtn,
            opacity: !input.trim() || !ollamaOnline ? 0.4 : 1,
          }}
          onClick={handleSend}
          disabled={!input.trim() || !ollamaOnline}
        >
          ↑
        </button>
      </div>
      </div>
    </>
  );
};
