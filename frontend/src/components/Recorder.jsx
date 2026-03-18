import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mic, Square, Loader, Upload } from 'lucide-react';

export default function Recorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [liveTranscript, setLiveTranscript] = useState('');
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const fileInputRef = useRef(null);
  const recognitionRef = useRef(null);
  const navigate = useNavigate();

  // Initialize SpeechRecognition on component mount if supported
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US'; // It works best if left generic or matched to user target
      
      recognition.onresult = (event) => {
        let currentTranscript = '';
        for (let i = 0; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }
        setLiveTranscript(currentTranscript);
      };

      recognition.onerror = (event) => {
        console.warn("Speech recognition error:", event.error);
        // We don't hard fail here since MediaRecorder is still capturing the actual audio for Groq
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setLiveTranscript(''); // Clear previous transcript

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await handleAudioUpload(audioBlob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      
      // Start live transcription UI if supported
      if (recognitionRef.current) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          console.warn("Could not start speech recognition overlay:", e);
        }
      }

      setIsRecording(true);
      setError(null);
    } catch (err) {
      console.error("Microphone access denied:", err);
      setError("Please allow microphone access to record financial conversations.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch(e) {}
      }
      setIsRecording(false);
      setIsProcessing(true);
    }
  };

  const transcriptEndRef = useRef(null);

  useEffect(() => {
    if (transcriptEndRef.current) {
      transcriptEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [liveTranscript]);

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    await handleAudioUpload(file, file.name);
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleAudioUpload = async (audioBlob, filename = 'recording.webm') => {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, filename);

      const response = await fetch('http://localhost:5000/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();
      setIsProcessing(false);
      
      // Navigate to dashboard which will stream insights for this conversation
      navigate(`/insights/${data.id}`);
      
    } catch (err) {
      console.error("Upload error:", err);
      setError(err.message || "Failed to upload audio to the server. Is it running?");
      setIsProcessing(false);
    }
  };

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div className="glass-panel recorder-container">
      <h2>Capture Your Financial Discussion</h2>
      <p className="status-text">
        {isProcessing 
          ? "Groq Whisper is transcribing your audio..." 
          : isRecording 
            ? "Recording... Speak clearly." 
            : "Click the microphone to record, or upload an existing audio file."}
      </p>

      {error && <div style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</div>}

      <div className="recorder-actions">
        <button 
          className={`mic-button ${isRecording ? 'recording' : ''}`}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={isProcessing}
          title={isRecording ? "Stop Recording" : "Start Recording"}
        >
          {isProcessing ? (
            <Loader size={36} className="animate-spin" />
          ) : isRecording ? (
            <Square size={36} fill="white" />
          ) : (
            <Mic size={48} />
          )}
        </button>

        {!isRecording && !isProcessing && (
          <button
            className="mic-button upload-button"
            onClick={handleUploadClick}
            disabled={isProcessing}
            title="Upload Audio File (.wav, .mp3, .webm)"
          >
            <Upload size={36} />
          </button>
        )}
      </div>

      <input 
        type="file" 
        accept="audio/*" 
        ref={fileInputRef} 
        onChange={handleFileUpload} 
        style={{ display: 'none' }} 
      />

      {isRecording && liveTranscript && (
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: 'rgba(0, 0, 0, 0.2)',
          borderRadius: '8px',
          color: 'var(--text-main)',
          fontSize: '1.1rem',
          lineHeight: '1.5',
          fontStyle: 'italic',
          minHeight: '150px',
          maxHeight: '400px',
          overflowY: 'auto',
          borderLeft: '4px solid var(--primary)',
          textAlign: 'left',
          whiteSpace: 'pre-wrap'
        }}>
          "{liveTranscript}"
          <div ref={transcriptEndRef} />
        </div>
      )}

      {isRecording && !liveTranscript && recognitionRef.current && (
         <div style={{ marginTop: '1.5rem', minHeight: '60px', color: 'var(--text-muted)' }}>
           Listening...
         </div>
      )}

      {!isRecording && !isProcessing && (
        <div style={{ marginTop: '2rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        </div>
      )}
    </div>
  );
}
