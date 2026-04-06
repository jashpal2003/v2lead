import { useEffect, useRef, useState } from 'react';
import { Loader2, MessageCircle, Mic, Send, X } from 'lucide-react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

interface Message {
  role: 'user' | 'bot';
  text: string;
  isAudio?: boolean;
}

type LeadStage = 'email' | 'name' | 'chat';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const FLOATING_BOT_IMAGE_URL = import.meta.env.VITE_FLOATING_BOT_IMAGE_URL || '';

const SESSION_STORAGE_KEY = 'vtl_session_id';
const EMAIL_STORAGE_KEY = 'vtl_lead_email';
const NAME_STORAGE_KEY = 'vtl_lead_name';
const DEFAULT_SUGGESTED_QUESTIONS = [
  'What services does Desire Infoweb provide?',
  'What is Desire Infoweb?',
  'What type of AI solutions does Desire create?',
];

const normalizeQuestionText = (value: string): string => {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
};

const decodeHeaderValue = (value: string | null): string => {
  if (!value) {
    return '';
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeMarkdownText = (text: string): string => {
  const normalized = (text || '').replace(/\r\n?/g, '\n');
  const fenceCount = (normalized.match(/(^|\n)```/g) || []).length;
  if (fenceCount % 2 === 1) {
    return `${normalized}\n\n\`\`\``;
  }
  return normalized;
};

function MarkdownMessage({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]} className="vtl-markdown">
      {normalizeMarkdownText(text)}
    </ReactMarkdown>
  );
}

const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
};

const createSessionId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  }
  return `session_${Date.now()}`;
};

function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [floatingImageError, setFloatingImageError] = useState(false);

  const [sessionId, setSessionId] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadName, setLeadName] = useState('');
  const [leadStage, setLeadStage] = useState<LeadStage>('email');
  const [dynamicSuggestedQuestions, setDynamicSuggestedQuestions] = useState<string[]>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const storedSessionId = localStorage.getItem(SESSION_STORAGE_KEY)?.trim();
    const storedEmail = localStorage.getItem(EMAIL_STORAGE_KEY)?.trim() || '';
    const storedName = localStorage.getItem(NAME_STORAGE_KEY)?.trim() || '';

    const resolvedSessionId = storedSessionId || createSessionId();
    setSessionId(resolvedSessionId);
    localStorage.setItem(SESSION_STORAGE_KEY, resolvedSessionId);

    setLeadEmail(storedEmail);
    setLeadName(storedName);

    if (storedEmail && storedName) {
      setLeadStage('chat');
      setMessages([
        {
          role: 'bot',
          text: `Welcome back ${storedName}! How can I help you today?`,
        },
      ]);
      return;
    }

    if (storedEmail) {
      setLeadStage('name');
      setMessages([
        { role: 'bot', text: 'Please share your full name to continue.' },
      ]);
      return;
    }

    setLeadStage('email');
    setMessages([
      {
        role: 'bot',
        text: 'Hi! Before we begin, please share your email address.',
      },
    ]);
  }, []);

  useEffect(() => {
    if (leadEmail) {
      localStorage.setItem(EMAIL_STORAGE_KEY, leadEmail);
    }
  }, [leadEmail]);

  useEffect(() => {
    if (leadName) {
      localStorage.setItem(NAME_STORAGE_KEY, leadName);
    }
  }, [leadName]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading]);

  const refreshSuggestedQuestions = async (targetSessionId: string = sessionId) => {
    if (!targetSessionId) {
      return;
    }

    try {
      const response = await axios.get(`${API_BASE_URL}/api/chat/suggestions`, {
        params: {
          session_id: targetSessionId,
          limit: 6,
        },
      });

      const starterKeys = new Set(DEFAULT_SUGGESTED_QUESTIONS.map(normalizeQuestionText));
      const nextSuggestions = Array.isArray(response.data?.suggestions)
        ? response.data.suggestions
          .filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0)
          .filter((item: string) => !starterKeys.has(normalizeQuestionText(item)))
          .slice(0, 3)
        : [];

      setDynamicSuggestedQuestions(nextSuggestions);
    } catch {
      setDynamicSuggestedQuestions([]);
    }
  };

  const visibleSuggestedQuestions = [...DEFAULT_SUGGESTED_QUESTIONS, ...dynamicSuggestedQuestions];

  useEffect(() => {
    if (leadStage === 'chat' && sessionId) {
      void refreshSuggestedQuestions(sessionId);
    }
  }, [leadStage, sessionId]);

  const submitUserMessage = async (rawMessage: string) => {
    if (!rawMessage.trim()) {
      return;
    }

    const userMsg = rawMessage.trim();
    setMessages((prev) => [...prev, { role: 'user', text: userMsg }]);

    if (leadStage === 'email') {
      if (!isValidEmail(userMsg)) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'bot',
            text: 'That email looks invalid. Please enter a valid email address.',
          },
        ]);
        return;
      }

      const normalizedEmail = userMsg.toLowerCase();
      setLeadEmail(normalizedEmail);
      setLeadStage('name');
      setMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          text: 'Thanks! Now please share your name.',
        },
      ]);
      return;
    }

    if (leadStage === 'name') {
      const normalizedName = userMsg.replace(/\s+/g, ' ').trim();
      if (normalizedName.length < 2) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'bot',
            text: 'Please enter your full name to continue.',
          },
        ]);
        return;
      }

      setLeadName(normalizedName);
      setLeadStage('chat');
      setMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          text: `Nice to meet you, ${normalizedName}. How can I help you today?`,
        },
      ]);
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('query', userMsg);
      formData.append('session_id', sessionId);
      formData.append('lead_email', leadEmail);
      formData.append('lead_name', leadName);
      const response = await axios.post(`${API_BASE_URL}/api/chat/text`, formData);
      setMessages((prev) => [...prev, { role: 'bot', text: response.data.reply }]);
      void refreshSuggestedQuestions(response.data.session_id || sessionId);
    } catch {
      setMessages((prev) => [...prev, { role: 'bot', text: 'Sorry, an error occurred.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTextSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) {
      return;
    }

    const messageToSend = inputText;
    setInputText('');
    await submitUserMessage(messageToSend);
  };

  const handleSuggestedQuestionClick = async (question: string) => {
    if (leadStage !== 'chat' || isLoading || isRecording) {
      return;
    }

    await submitUserMessage(question);
  };

  const startRecording = async () => {
    if (isLoading || isRecording || leadStage !== 'chat') {
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = handleAudioStop;
      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      alert('Please allow microphone access to use voice features.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }
  };

  const handleAudioStop = async () => {
    setIsLoading(true);
    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
    const audioFile = new File([audioBlob], 'recording.webm', { type: 'audio/webm' });

    const formData = new FormData();
    formData.append('audio', audioFile);

    try {
      const response = await fetch(`${API_BASE_URL}/api/chat/voice`, {
        method: 'POST',
        headers: {
          'X-Session-Id': sessionId,
          'X-Lead-Email': leadEmail,
          'X-Lead-Name': leadName,
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Voice API failed');
      }

      let userQuery = decodeHeaderValue(response.headers.get('X-User-Query-Encoded'))
        || response.headers.get('X-User-Query')
        || 'Voice Message';
      let botReply = decodeHeaderValue(response.headers.get('X-Bot-Reply-Encoded'))
        || response.headers.get('X-Bot-Reply')
        || 'Audio Reply';

      try {
        const lastTurnResponse = await axios.get(`${API_BASE_URL}/api/chat/last`, {
          params: { session_id: sessionId },
        });
        userQuery = lastTurnResponse.data.user_query || userQuery;
        botReply = lastTurnResponse.data.reply || botReply;
      } catch {
        // Keep header-based fallbacks when last-turn lookup is unavailable.
      }

      setMessages((prev) => [
        ...prev,
        { role: 'user', text: userQuery, isAudio: true },
        { role: 'bot', text: botReply, isAudio: true },
      ]);
      void refreshSuggestedQuestions(sessionId);

      const audioResponseBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioResponseBlob);
      const audio = new Audio(audioUrl);
      await audio.play();
      audio.onended = () => URL.revokeObjectURL(audioUrl);
    } catch {
      setMessages((prev) => [...prev, { role: 'bot', text: 'Sorry, failed to process audio.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const voiceHintText = isRecording
    ? '🔴 Recording... release to send'
    : leadStage === 'chat'
      ? 'Hold mic to record • Release to send'
      : 'Complete email and name first to enable voice';

  const showFloatingImage = !isOpen && !!FLOATING_BOT_IMAGE_URL && !floatingImageError;

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`fixed bottom-6 right-6 z-50 transition-transform hover:scale-105 flex items-center justify-center ${
          showFloatingImage
            ? 'w-[110px] h-[110px] rounded-full bg-transparent shadow-none overflow-hidden p-0'
            : 'p-4 bg-blue-600 text-white rounded-full shadow-2xl hover:bg-blue-700'
        }`}
      >
        {isOpen ? (
          <X className="w-6 h-6" />
        ) : showFloatingImage ? (
          <img
            src={FLOATING_BOT_IMAGE_URL}
            alt="Assistant"
            className="w-full h-full object-cover object-center rounded-full"
            onError={() => setFloatingImageError(true)}
          />
        ) : (
          <MessageCircle className="w-6 h-6" />
        )}
      </button>

      {isOpen && (
        <div className="fixed bottom-28 right-6 z-50 w-[94vw] sm:w-[540px] h-[760px] max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col border border-gray-100 overflow-hidden">
          <div className="bg-blue-600 p-4 text-white font-bold text-lg flex justify-between items-center shadow-md z-10">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
              <span>AI Assistant</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
            {messages.map((msg, idx) => (
              <div key={`${msg.role}-${idx}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`p-3 rounded-2xl text-sm max-w-[85%] shadow-sm ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-none'
                      : 'bg-white border border-gray-100 text-gray-800 rounded-bl-none'
                  }`}
                >
                  {msg.isAudio && <span className="text-xs opacity-75 block mb-1">🎤 Voice</span>}
                  {msg.role === 'bot' ? (
                    <MarkdownMessage text={msg.text} />
                  ) : (
                    <span className="whitespace-pre-wrap break-words">{msg.text}</span>
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white border border-gray-100 p-3 rounded-2xl rounded-bl-none flex items-center gap-2 text-gray-500 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" /> Thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-3 bg-white border-t">
            {leadStage === 'chat' && (
              <div className="mb-3">
                <div className="text-xs text-gray-500 mb-2">Suggested questions</div>
                <div className="flex flex-wrap gap-2">
                  {visibleSuggestedQuestions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={() => void handleSuggestedQuestionClick(question)}
                      disabled={isLoading || isRecording}
                      className="px-3 py-1.5 rounded-full text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={`text-xs mb-2 ${isRecording ? 'text-red-500 font-medium' : 'text-gray-500'}`}>
              {voiceHintText}
            </div>

            <div className="flex items-center gap-2">
            <button
              onMouseDown={startRecording}
              onMouseUp={stopRecording}
              onMouseLeave={stopRecording}
              onTouchStart={startRecording}
              onTouchEnd={stopRecording}
              title="Hold to record voice message, release to send"
              className={`p-2.5 rounded-full flex-shrink-0 ${
                isRecording
                  ? 'bg-red-500 text-white animate-pulse'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed'
              }`}
              disabled={leadStage !== 'chat' || isLoading}
            >
              <Mic className="w-5 h-5" />
            </button>

            <form onSubmit={handleTextSubmit} className="flex-1 flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={
                  leadStage === 'email'
                    ? 'Enter your email address'
                    : leadStage === 'name'
                      ? 'Enter your full name'
                      : 'Message...'
                }
                className="flex-1 px-4 py-2 text-sm rounded-full bg-gray-100 border-transparent focus:bg-white focus:border-blue-500 outline-none"
                disabled={isRecording || isLoading}
              />
              <button
                type="submit"
                title="Send message"
                disabled={!inputText.trim() || isRecording || isLoading}
                className="p-2.5 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50"
              >
                <Send className="w-4 h-4 ml-0.5" />
              </button>
            </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default App;
