import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [ollamaStatus, setOllamaStatus] = useState<'IDLE' | 'CONNECTED' | 'ERROR'>('IDLE');
  const [sdecStatus, setSdecStatus] = useState<boolean>(true);
  const [objective, setObjective] = useState<string>('');

  useEffect(() => {
    // Attempt a ping to local Ollama server to check status
    const pingOllama = async () => {
      try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (response.ok) {
          setOllamaStatus('CONNECTED');
        } else {
          setOllamaStatus('ERROR');
        }
      } catch (err) {
        setOllamaStatus('ERROR');
      }
    };
    
    pingOllama();
    const interval = setInterval(pingOllama, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);

  const handleStartAgent = async () => {
    if (!objective.trim()) {
      alert("Please enter an objective for the agent!");
      return;
    }

    try {
      // Get the currently active tab to send the objective to the background script
      const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id) {
        // Send the objective to the background worker which will query the content script
        browser.runtime.sendMessage({ 
          type: 'START_AGENT_LOOP', 
          payload: objective 
        });
        
        // Let the user know it was triggered
        setObjective('Agent deployed to active tab!');
        setTimeout(() => window.close(), 1500); // Close popup after 1.5s
      }
    } catch (e) {
      console.error("Failed to start agent:", e);
      alert("Error starting agent. Make sure you are on a compatible web page.");
    }
  };

  return (
    <div className="app-container">
      <div className="header">
        <div className="logo-circle">O</div>
        <div>
          <h1 className="title">Oryonix AI</h1>
          <p className="subtitle">Universal Agentic Copilot</p>
        </div>
      </div>

      <div className="status-card">
        <div className="status-row">
          <span className="status-label">Local Inference</span>
          <span className="status-value">
            {ollamaStatus === 'CONNECTED' ? (
              <><div className="dot active"></div> Ready</>
            ) : ollamaStatus === 'ERROR' ? (
              <><div className="dot inactive"></div> Offline</>
            ) : (
              <><div className="dot warning"></div> Detecting...</>
            )}
          </span>
        </div>
        
        <div className="status-row">
          <span className="status-label">Memory SDEC</span>
          <span className="status-value">
            {sdecStatus ? (
              <><div className="dot active"></div> Encrypted</>
            ) : (
              <><div className="dot inactive"></div> Unsecured</>
            )}
          </span>
        </div>

        <div className="status-row">
          <span className="status-label">Active Tab CDP</span>
          <span className="status-value">
            <div className="dot warning"></div> Standby
          </span>
        </div>
      </div>

      {ollamaStatus === 'ERROR' && (
        <div style={{ color: '#ef4444', fontSize: '13px', marginBottom: '20px', textAlign: 'center', background: 'rgba(239, 68, 68, 0.1)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          Local Ollama instance not found.<br/>Ensure GLM-4.6V-Flash is running on port 11434.
        </div>
      )}

      <input 
        type="text" 
        className="objective-input" 
        placeholder="e.g. Find the cheapest mechanical keyboard..."
        value={objective}
        onChange={(e) => setObjective(e.target.value)}
        disabled={ollamaStatus !== 'CONNECTED'}
      />

      <button 
        className="action-btn" 
        onClick={handleStartAgent}
        disabled={ollamaStatus !== 'CONNECTED' || !objective.trim()}
        style={{ opacity: (ollamaStatus !== 'CONNECTED' || !objective.trim()) ? 0.5 : 1 }}
      >
        Summon Agent
      </button>
    </div>
  );
}

export default App;
