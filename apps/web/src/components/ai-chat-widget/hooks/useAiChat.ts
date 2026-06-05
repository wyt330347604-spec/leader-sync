'use client';

import { useState, useCallback } from 'react';
import { apiFetch } from '@/lib/api-client';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
}

interface AiChatResponse {
  answer: string;
  intent: string;
  conversation_uid: string;
}

export function useAiChat(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(
    async (question: string) => {
      if (!question.trim() || isLoading) return;

      // 1. Optimistic: append user message immediately (immutable pattern)
      const userMessage: ChatMessage = { role: 'user', content: question };
      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);

      try {
        // 2. Call API
        const data = await apiFetch<AiChatResponse>('/api/v1/ai/chat', {
          method: 'POST',
          body: JSON.stringify({ question, session_id: sessionId, source: 'web' }),
        });

        // 3. Append AI answer (immutable)
        const aiMessage: ChatMessage = { role: 'assistant', content: data.answer };
        setMessages((prev) => [...prev, aiMessage]);
      } catch {
        // 4. Show error bubble (immutable)
        const errorMessage: ChatMessage = {
          role: 'assistant',
          content: '抱歉，暂时无法回答，请稍后重试。',
          isError: true,
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, isLoading],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  return { messages, isLoading, sendMessage, clearMessages };
}
