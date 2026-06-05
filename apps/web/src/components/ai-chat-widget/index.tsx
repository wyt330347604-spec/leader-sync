'use client';

import { useState, useId } from 'react';
import { ChatWindow } from './chat-window';
import { useAiChat } from './hooks/useAiChat';

// Roles that can see the AI assistant widget
const ALLOWED_ROLES = new Set(['leader', 'boss', 'pmo', 'admin']);

interface AiChatWidgetProps {
  role?: string;
}

export function AiChatWidget({ role }: AiChatWidgetProps) {
  // Generate a stable session ID for this mount lifecycle
  const sessionId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const { messages, isLoading, sendMessage } = useAiChat(sessionId);

  // employee role or unknown role: don't render
  if (!role || !ALLOWED_ROLES.has(role)) {
    return null;
  }

  return (
    <>
      {/* Floating trigger button (visible when closed) */}
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="打开督办助手"
          className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center"
          style={{ boxShadow: '0 4px 24px rgba(37,99,235,0.4)' }}
        >
          <ChatIcon />
        </button>
      )}

      {/* Chat window (visible when open) */}
      {isOpen && (
        <div
          className="fixed bottom-6 right-6 z-50 rounded-xl shadow-2xl overflow-hidden"
          style={{
            border: '1px solid var(--border)',
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
          }}
        >
          <ChatWindow
            messages={messages}
            isLoading={isLoading}
            onSend={sendMessage}
            onClose={() => setIsOpen(false)}
          />
        </div>
      )}
    </>
  );
}

function ChatIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}
