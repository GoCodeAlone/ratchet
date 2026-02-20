import { useEffect, useRef, useState } from 'react';
import { useMessageStore } from '../store/messageStore';
import { useAgentStore } from '../store/agentStore';
import { colors, baseStyles } from '../theme';
import { Message } from '../types';

function MessageBubble({ message }: { message: Message }) {
  const isSystem = message.type === 'system' || !message.from;
  const time = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div
      style={{
        marginBottom: '12px',
        padding: '10px 14px',
        backgroundColor: isSystem ? `${colors.overlay0}22` : colors.surface0,
        borderRadius: '8px',
        borderLeft: `3px solid ${isSystem ? colors.overlay0 : colors.blue}`,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '8px',
          marginBottom: '4px',
        }}
      >
        <span
          style={{
            fontSize: '13px',
            fontWeight: '600',
            color: isSystem ? colors.overlay1 : colors.blue,
          }}
        >
          {message.from || 'System'}
        </span>
        {message.to && (
          <>
            <span style={{ fontSize: '11px', color: colors.overlay0 }}>&rarr;</span>
            <span style={{ fontSize: '13px', color: colors.subtext0 }}>{message.to}</span>
          </>
        )}
        {message.subject && (
          <span
            style={{
              fontSize: '11px',
              color: colors.overlay0,
              fontStyle: 'italic',
            }}
          >
            [{message.subject}]
          </span>
        )}
        <span style={{ fontSize: '11px', color: colors.overlay0, marginLeft: 'auto' }}>
          {time}
        </span>
      </div>
      <div
        style={{
          fontSize: '14px',
          color: colors.text,
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {message.content}
      </div>
    </div>
  );
}

export default function MessageFeed() {
  const { messages, loading, fetchMessages, subscribeSSE, unsubscribeSSE } = useMessageStore();
  const { agents, fetchAgents } = useAgentStore();
  const [agentFilter, setAgentFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAgents();
    fetchMessages(undefined, 100);
    subscribeSSE();
    return () => unsubscribeSSE();
  }, [fetchAgents, fetchMessages, subscribeSSE, unsubscribeSSE]);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, autoScroll]);

  const filtered: Message[] = agentFilter
    ? messages.filter((m) => m.from === agentFilter || m.to === agentFilter)
    : messages;

  return (
    <div style={{ maxWidth: '900px', display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)' }}>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexShrink: 0 }}>
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          style={{ ...baseStyles.input, width: '200px' }}
        >
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <button
          onClick={() => fetchMessages(agentFilter || undefined, 100)}
          style={{ ...baseStyles.button.secondary, fontSize: '13px', padding: '8px 14px' }}
        >
          Refresh
        </button>

        <div style={{ flex: 1 }} />

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px',
            color: colors.subtext0,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
      </div>

      {/* Feed */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          ...baseStyles.card,
          padding: '16px',
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          setAutoScroll(atBottom);
        }}
      >
        {loading && filtered.length === 0 ? (
          <div style={{ color: colors.subtext0, textAlign: 'center', padding: '40px' }}>
            Loading messages...
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ color: colors.overlay0, textAlign: 'center', padding: '40px' }}>
            No messages yet. Messages will appear here as agents communicate.
          </div>
        ) : (
          filtered.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div
        style={{
          marginTop: '8px',
          fontSize: '12px',
          color: colors.overlay0,
          flexShrink: 0,
        }}
      >
        {filtered.length} message{filtered.length !== 1 ? 's' : ''}
        {agentFilter && ` filtered by: ${agentFilter}`}
      </div>
    </div>
  );
}
