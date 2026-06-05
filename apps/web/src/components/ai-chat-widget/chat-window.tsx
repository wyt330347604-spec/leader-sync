'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChatMessage } from './hooks/useAiChat';

// Quick question presets shown before first message
const QUICK_QUESTIONS = [
  '哪些任务快逾期了？',
  '本月完成率最低的是谁？',
  '哪些任务已延期？',
  '团队项目现在什么进度？',
];

interface ChatWindowProps {
  messages: ChatMessage[];
  isLoading: boolean;
  onSend: (question: string) => void;
  onClose: () => void;
}

export function ChatWindow({ messages, isLoading, onSend, onClose }: ChatWindowProps) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Focus input on open
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = () => {
    const trimmed = inputValue.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInputValue('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="flex flex-col"
      style={{ width: 360, height: 480 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--bg-card)] rounded-t-xl">
        <div className="flex items-center gap-2">
          <span className="text-base font-semibold text-[var(--text-primary)]">督办助手</span>
          <span className="w-2 h-2 rounded-full bg-green-500" title="在线" />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors p-1 rounded"
          aria-label="关闭"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-[var(--bg-page)]">
        {/* Welcome state — show quick questions */}
        {messages.length === 0 && !isLoading && (
          <div className="space-y-3">
            <p className="text-xs text-[var(--text-secondary)] text-center">
              你好！我是督办助手，可以回答任务管理相关问题。
            </p>
            <div className="space-y-1.5">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onSend(q)}
                  disabled={isLoading}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message bubbles */}
        {messages.map((msg, idx) => (
          <MessageBubble key={idx} message={msg} />
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex items-start gap-2">
            <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center flex-shrink-0 text-xs">
              AI
            </div>
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl rounded-tl-sm px-4 py-3">
              <LoadingDots />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="px-3 py-3 border-t border-[var(--border)] bg-[var(--bg-card)] rounded-b-xl">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            placeholder="输入问题，按 Enter 发送..."
            rows={1}
            className="flex-1 resize-none text-sm px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-page)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50 transition-colors"
            style={{ maxHeight: 80, overflowY: 'auto' }}
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            className="flex-shrink-0 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            发送
          </button>
        </div>
        <p className="mt-1.5 text-xs text-[var(--text-secondary)] text-center">
          Enter 发送 · Shift+Enter 换行
        </p>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-start gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-medium ${
          isUser
            ? 'bg-blue-600 text-white'
            : message.isError
            ? 'bg-red-100 dark:bg-red-900 text-red-600'
            : 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
        }`}
      >
        {isUser ? '我' : 'AI'}
      </div>

      {/* Bubble */}
      <div
        className={`max-w-[78%] px-3 py-2 rounded-xl text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-blue-600 text-white rounded-tr-sm'
            : message.isError
            ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-[var(--text-primary)] rounded-tl-sm'
            : 'bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-tl-sm'
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

function LoadingDots() {
  return (
    <div className="flex items-center gap-1" aria-label="正在思考">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[var(--text-secondary)] animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}
