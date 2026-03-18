import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FileText, TrendingUp, Tags, Loader, Trash2, CheckCircle2, Headphones } from 'lucide-react';

export default function Dashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);

  // Specific conversation state
  const [activeConv, setActiveConv] = useState(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamError, setStreamError] = useState(null);

  // Streamed context
  const [summary, setSummary] = useState('');
  const [entities, setEntities] = useState('');
  const [metrics, setMetrics] = useState('');
  const [insights, setInsights] = useState('');
  const [nextSteps, setNextSteps] = useState('');

  useEffect(() => {
    if (id) {
      loadConversationWithStream(id);
    } else {
      loadAllConversations();
    }
  }, [id]);

  const loadAllConversations = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/conversations');
      const data = await res.json();
      setConversations(data);
    } catch (err) {
      console.error("Failed to load conversations", err);
    }
  };

  const toggleSelection = (e, convId) => {
    e.stopPropagation();
    setSelectedIds(prev =>
      prev.includes(convId) ? prev.filter(id => id !== convId) : [...prev, convId]
    );
  };

  const toggleAll = () => {
    if (selectedIds.length === conversations.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(conversations.map(c => c.id));
    }
  };

  const deleteSelected = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedIds.length} recording(s)?`)) return;

    try {
      const res = await fetch('http://localhost:5000/api/conversations/batch', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedIds }),
      });
      if (res.ok) {
        setConversations(conversations.filter(c => !selectedIds.includes(c.id)));
        setSelectedIds([]);
      } else {
        alert("Failed to delete the selected conversations.");
      }
    } catch (err) {
      console.error("Error batch deleting conversations:", err);
    }
  };

  const deleteConversation = async (convId, e) => {
    e.stopPropagation(); // Prevent navigating to insights
    if (!window.confirm("Are you sure you want to delete this recording?")) return;

    try {
      const res = await fetch(`http://localhost:5000/api/conversations/${convId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setConversations(conversations.filter(c => c.id !== convId));
        setSelectedIds(prev => prev.filter(id => id !== convId));
      } else {
        console.error("Failed to delete conversation");
        alert("Failed to delete the conversation.");
      }
    } catch (err) {
      console.error("Error deleting conversation:", err);
    }
  };

  const loadConversationWithStream = async (convId) => {
    try {
      const res = await fetch(`http://localhost:5000/api/conversations/${convId}`);
      if (res.ok) {
        const data = await res.json();
        setActiveConv(data);

        // If it was already fully analyzed, load the DB fields directly
        if (data.status === 'analyzed') {
          setSummary(data.summary || '');
          setEntities(data.entities || '');
          setMetrics(data.metrics || '');
          setInsights(data.insights || '');
          setNextSteps(data.next_steps || '');
          return;
        }

        // If newly uploaded, trigger SSE stream for insights from Groq LLaMA
        if (data.status === 'transcribed' || !data.summary) {
          startInsightStream(convId);
        }
      } else {
        setStreamError("Conversation not found");
      }
    } catch (err) {
      setStreamError("Failed to fetch conversation details.");
    }
  };

  const startInsightStream = (convId) => {
    setIsStreaming(true);
    setSummary(''); setEntities(''); setMetrics(''); setInsights(''); setNextSteps('');

    let fullText = '';

    const eventSource = new EventSource(`http://localhost:5000/api/stream_insights/${convId}`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.done) {
        eventSource.close();
        setIsStreaming(false);
        return;
      }

      if (data.error) {
        setStreamError(data.error);
        eventSource.close();
        setIsStreaming(false);
        return;
      }

      if (data.chunk) {
        fullText += data.chunk;

        // Very basic parsing logic on the fly to simulate section filling 
        // We know Groq will generate exactly [SUMMARY], [ENTITIES], [INSIGHTS] sequentially
        // For real app we parse more robustly or wait for done, but this gives the streaming effect!

        const summaryMatch = fullText.split('[SUMMARY]')[1]?.split('[ENTITIES]')[0];
        const entitiesMatch = fullText.split('[ENTITIES]')[1]?.split('[FINANCIAL METRICS]')[0];
        const metricsMatch = fullText.split('[FINANCIAL METRICS]')[1]?.split('[INSIGHTS]')[0];
        const insightsMatch = fullText.split('[INSIGHTS]')[1]?.split('[ACTIONABLE NEXT STEPS]')[0];
        const nextStepsMatch = fullText.split('[ACTIONABLE NEXT STEPS]')[1];

        if (summaryMatch !== undefined) setSummary(summaryMatch);
        if (entitiesMatch !== undefined) setEntities(entitiesMatch);
        if (metricsMatch !== undefined) setMetrics(metricsMatch);
        if (insightsMatch !== undefined) setInsights(insightsMatch);
        if (nextStepsMatch !== undefined) setNextSteps(nextStepsMatch);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE Error:", err);
      eventSource.close();
      setIsStreaming(false);
      setStreamError("Stream interrupted.");
    };
  };

  const renderEntities = (text) => {
    // Entities often generated as "1. EMI, 2. SIP..." or list. We split by punctuation
    const words = text.split(/[\n,]/)
      .map(w => w.replace(/^[\d\.\-\*\s]+/, '').trim())
      .filter(w => w.length > 2 && !w.toLowerCase().includes('not mentioned'));
    return (
      <div className="entity-list">
        {words.length > 0 ? words.map((w, i) => (
          <span key={i} className="entity-pill">{w}</span>
        )) : <span className="text-muted">{isStreaming ? 'Detecting...' : 'No specific entities detected.'}</span>}
      </div>
    );
  };

  const renderSimpleList = (text) => {
    if (!text) return <span className="text-muted">{isStreaming ? 'Analyzing...' : 'N/A'}</span>;
    const items = text.split('\n').map(i => i.trim()).filter(i => i.length > 0);
    return (
      <ul className="insight-list">
        {items.map((item, idx) => (
          <li key={idx}>{item.replace(/^[\d\.\-\*\s]+/, '')}</li>
        ))}
      </ul>
    );
  };

  if (!id) {
    return (
      <div className="glass-panel dashboard-history-panel" style={{ textAlign: 'left' }}>
        <h2 style={{ marginBottom: '1.5rem', textAlign: 'center' }}>Conversation History</h2>

        {conversations.length === 0 ? (
          <p className="status-text" style={{ textAlign: 'center' }}>No conversations yet. Start recording one!</p>
        ) : (
          <>
            <div className="history-bulk-actions">
              <div className="selection-info">
                <div className="checkbox-wrapper" onClick={toggleAll}>
                  <input
                    type="checkbox"
                    className="custom-checkbox"
                    checked={conversations.length > 0 && selectedIds.length === conversations.length}
                    readOnly
                    title="Select All"
                  />
                </div>
                <span style={{ fontSize: '0.95rem', color: 'var(--text-muted)' }}>
                  {selectedIds.length > 0 ? `${selectedIds.length} selected` : 'Select All'}
                </span>
              </div>

              {selectedIds.length > 0 && (
                <button
                  className="btn btn-danger"
                  onClick={deleteSelected}
                  style={{ padding: '0.5rem 1rem', fontSize: '0.85rem' }}
                >
                  <Trash2 size={16} /> Delete Selected
                </button>
              )}
            </div>

            <div className="history-list">
              {conversations.map(c => {
                const isSelected = selectedIds.includes(c.id);
                return (
                  <div
                    key={c.id}
                    className={`history-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => navigate(`/insights/${c.id}`)}
                  >
                    <div className="history-item-content">
                      <div className="checkbox-wrapper" onClick={(e) => toggleSelection(e, c.id)}>
                        <input
                          type="checkbox"
                          className="custom-checkbox"
                          checked={isSelected}
                          readOnly
                        />
                      </div>

                      <div className="history-item-details">
                        <div className="history-item-date">
                          {new Date(c.timestamp).toLocaleString(undefined, {
                            dateStyle: 'medium',
                            timeStyle: 'short'
                          })}
                        </div>
                        <div className="history-item-status">
                          <span className={`status-badge status-${c.status}`}>
                            {c.status}
                          </span>
                          <span>• ID: {c.id.split('-')[0]}</span>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={(e) => deleteConversation(c.id, e)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        padding: '0.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'color 0.2s'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                      title="Delete Recording"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="dashboard-grid">
        <div className="insight-card glass-panel">
          <h3><FileText size={20} /> Summary</h3>
          <div className="streaming-text">{summary || (isStreaming ? <Loader size={16} className="animate-spin" /> : "N/A")}</div>
        </div>

        <div className="insight-card glass-panel">
          <h3><Tags size={20} /> Financial Entities</h3>
          {renderEntities(entities)}
          {isStreaming && !entities && <Loader size={16} className="animate-spin" />}
        </div>

        <div className="insight-card glass-panel">
          <h3><TrendingUp size={20} /> Financial Metrics</h3>
          <div className="streaming-text">{renderSimpleList(metrics)}</div>
        </div>

        <div className="insight-card glass-panel">
          <h3><TrendingUp size={20} /> Actionable Insights</h3>
          <div className="streaming-text">{insights || (isStreaming ? <Loader size={16} className="animate-spin" /> : "N/A")}</div>
        </div>

        <div className="insight-card glass-panel">
          <h3><CheckCircle2 size={20} /> Next Steps</h3>
          <div className="streaming-text">{renderSimpleList(nextSteps)}</div>
        </div>
      </div>

      {activeConv && (
        <div className="glass-panel transcript-section">
          <h3>Original Transcript (Whisper)</h3>
          <div className="transcript-content">
            {activeConv.transcript}
          </div>
          {activeConv.audio_path && (
            <div className="audio-player-wrapper">
              <h4><Headphones size={20} color="var(--primary)" /> Original Audio Recording</h4>
              <audio
                controls
                src={`http://localhost:5000/api/audio/${activeConv.id}`}
                className="custom-audio-player"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
