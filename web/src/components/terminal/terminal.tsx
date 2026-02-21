import React, { useState, useRef, useEffect } from 'react';
import './terminal.css';

interface TerminalLine {
  type: 'command' | 'output' | 'error' | 'system';
  content: string;
  timestamp: number;
}

interface TerminalProps {
  onCommand: (command: string) => Promise<string>;
  prompt?: string;
  welcomeMessage?: string;
  platform: 'android' | 'ios' | 'tvos';
}

export const Terminal: React.FC<TerminalProps> = ({
  onCommand,
  prompt = '$',
  welcomeMessage = 'Interactive Shell (Restricted Mode)',
  platform,
}) => {
  const [history, setHistory] = useState<TerminalLine[]>([
    { type: 'system', content: welcomeMessage, timestamp: Date.now() },
    { type: 'system', content: 'Type "help" for allowed commands.', timestamp: Date.now() },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

  const formatOutput = (content: string): string => {
    // Attempt to pretty-print JSON output
    const trimmed = content.trim();
    if (
      (trimmed.startsWith('{') || trimmed.startsWith('[')) &&
      (trimmed.endsWith('}') || trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return JSON.stringify(parsed, null, 2);
      } catch (e) {
        // Not valid JSON, return as is
      }
    }
    return content;
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isLoading) {
      const command = inputValue.trim();
      if (!command) return;

      setInputValue('');
      setHistory((prev) => [
        ...prev,
        { type: 'command', content: `${prompt} ${command}`, timestamp: Date.now() },
      ]);
      setCommandHistory((prev) => [...prev, command]);
      setHistoryIndex(-1);
      setIsLoading(true);

      if (command === 'clear') {
        setHistory([]);
        setIsLoading(false);
        return;
      }

      if (command === 'help') {
        let helpText = '';
        if (platform === 'android') {
          helpText = `
Android Allowed Commands:
  • System Info: getprop, ip addr, date, uptime, cat /proc/meminfo, cat /proc/cpuinfo
  • Process Mgmt: ps, top
  • File System: ls
  • Diagnostics: dumpsys [battery|wifi|power]
  • Packages: pm list packages
            `;
        } else if (platform === 'ios' || platform === 'tvos') {
          helpText = `
iOS Allowed Commands:
  • Simulator (xcrun simctl): 
      listapps, get_app_container, list, getenv
  • Real Device (go-ios): 
      apps, info, syslog, list
            `;
        }

        setHistory((prev) => [
          ...prev,
          { type: 'output', content: helpText.trim(), timestamp: Date.now() },
        ]);
        setIsLoading(false);
        return;
      }

      try {
        const rawOutput = await onCommand(command);
        const formattedOutput = formatOutput(rawOutput || '(No output)');
        setHistory((prev) => [
          ...prev,
          { type: 'output', content: formattedOutput, timestamp: Date.now() },
        ]);
      } catch (err: any) {
        setHistory((prev) => [
          ...prev,
          { type: 'error', content: err.message || 'Unknown error', timestamp: Date.now() },
        ]);
      } finally {
        setIsLoading(false);
        // Refocus input after command execution
        setTimeout(() => inputRef.current?.focus(), 10);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const newIndex =
          historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInputValue(commandHistory[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= commandHistory.length) {
          setHistoryIndex(-1);
          setInputValue('');
        } else {
          setHistoryIndex(newIndex);
          setInputValue(commandHistory[newIndex]);
        }
      }
    }
  };

  return (
    <div className="terminal-container">
      {/* Mission Control Scanline Overlay */}
      <div className="scanline" style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        opacity: 0.05,
        zIndex: 1001
      }}></div>
      <header className="terminal-header">
        <div className="terminal-controls">
          <div className="dot red" />
          <div className="dot yellow" />
          <div className="dot green" />
        </div>
        <div className="terminal-title">{platform.toUpperCase()} INTERNAL SHELL</div>
        <div className="terminal-actions">
          <button
            className="terminal-action-btn"
            onClick={() => setHistory([])}
            title="Clear Terminal"
          >
            CLEAR
          </button>
        </div>
      </header>
      <div className="terminal-history" ref={scrollRef} onClick={() => inputRef.current?.focus()}>
        {history.map((line, index) => (
          <div key={index} className={`terminal-line ${line.type}`}>
            {line.content}
          </div>
        ))}
        {isLoading && (
          <div className="terminal-line system animate-pulse">Executing command...</div>
        )}
      </div>
      <div className="terminal-input-area">
        <span className="terminal-prompt">{prompt}</span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          placeholder="Type a command..."
        />
      </div>
    </div>
  );
};
