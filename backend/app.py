import os
import sqlite3
import json
import uuid
import time
from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
CORS(app)

DB_PATH = 'conversations.db'
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

try:
    groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))
except Exception as e:
    groq_client = None
    print(f"Warning: Groq client failed to initialize -> {e}")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            audio_path TEXT,
            transcript TEXT,
            summary TEXT,
            entities TEXT,
            metrics TEXT,
            insights TEXT,
            next_steps TEXT,
            status TEXT
        )
    ''')
    
    # Simple migration for existing DBs
    c.execute("PRAGMA table_info(conversations)")
    columns = [row[1] for row in c.fetchall()]
    if 'metrics' not in columns:
        c.execute('ALTER TABLE conversations ADD COLUMN metrics TEXT')
    if 'next_steps' not in columns:
        c.execute('ALTER TABLE conversations ADD COLUMN next_steps TEXT')
        
    conn.commit()
    conn.close()

init_db()

@app.route('/api/upload', methods=['POST'])
def upload_audio():
    if 'audio' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400
    
    file = request.files['audio']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400

    conv_id = str(uuid.uuid4())
    file_extension = file.filename.split('.')[-1]
    if file_extension not in ['wav', 'mp3', 'webm', 'ogg', 'm4a']:
        file_extension = 'webm' # default for web uploads often
        
    filename = f"{conv_id}.{file_extension}"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)

    if not groq_client:
        return jsonify({'error': 'Groq API Key not configured'}), 500

    # 1. Transcribe with Whisper (Groq)
    try:
        with open(filepath, "rb") as f:
            prompt_text = "This is a financial conversation. The audio may be in English, Hindi, Hinglish, Spanish, or another language. CRITICAL INSTRUCTION: Transcribe the audio exactly in the language it is spoken. DO NOT translate non-English audio to English. If they speak Hindi, output Hindi script. Keywords: EMI, SIP, mutual funds, loan, budget."
            transcription = groq_client.audio.transcriptions.create(
                file=(filename, f.read()),
                model="whisper-large-v3-turbo",
                prompt=prompt_text,
                response_format="json",
            )
        transcript_text = transcription.text
    except Exception as e:
        return jsonify({'error': f'Transcription failed: {str(e)}'}), 500

    # Save initial record to DB
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        INSERT INTO conversations (id, audio_path, transcript, status)
        VALUES (?, ?, ?, ?)
    ''', (conv_id, filepath, transcript_text, 'transcribed'))
    conn.commit()
    conn.close()

    return jsonify({
        'id': conv_id,
        'transcript': transcript_text,
        'message': 'Upload and transcription successful'
    })

@app.route('/api/stream_insights/<conv_id>', methods=['GET'])
def stream_insights(conv_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT transcript FROM conversations WHERE id = ?', (conv_id,))
    row = c.fetchone()
    conn.close()

    if not row:
        return jsonify({'error': 'Conversation not found'}), 404
        
    transcript = row[0]
    
    if not groq_client:
        return jsonify({'error': 'Groq API Key not configured'}), 500

    prompt = f"""
You are a financial analysis assistant.

Your task is to analyze the following financial conversation transcript and extract structured financial insights. 
Focus on identifying key financial details, financial health indicators, and actionable recommendations.

Carefully analyze the transcript and extract the following:

1. SUMMARY
Provide a concise but informative summary (3–5 sentences) explaining the main financial discussion and the financial decisions being discussed.
Do not include categories or metrics that are not mentioned in the transcript.

2. ENTITIES
Identify and list all financial entities mentioned in the conversation. 
These may include but are not limited to:

• Income sources (salary, business income, freelance income)
• Expenses (rent, utilities, groceries, subscriptions)
• Loans (home loan, personal loan, student loan, car loan)
• EMI payments
• Credit cards
• CIBIL / credit score
• Investments (SIP, mutual funds, stocks, bonds, ETFs)
• Savings accounts
• Fixed deposits (FD)
• Recurring deposits (RD)
• Insurance policies (life, health, vehicle)
• Taxes or tax-saving instruments (ELSS, PPF, NPS, 80C)
• Budget amounts or financial figures
• Assets (property, gold, vehicles)
• Liabilities or debts
• Financial goals (retirement, buying house, education fund)
• Financial ratios if implied (debt-to-income, savings rate)

List them clearly in bullet points.

3. FINANCIAL METRICS (if present)
Extract any numerical financial information mentioned, such as:
• Salary
• Monthly expenses
• Loan amount
• EMI value
• Investment amounts
• Interest rates
• CIBIL score
• Savings amount
• Debt amount
• Budget limits


4. INSIGHTS
Provide clear financial insights derived from the discussion. These may include:
• Financial health observations
• Spending behavior patterns
• Debt risks
• Investment opportunities
• Credit score improvement suggestions
• Budget optimization tips
• Loan management advice

5. ACTIONABLE NEXT STEPS
Give practical steps the person could take based on the discussion.

IMPORTANT RULES:
• Only extract information that appears in the transcript.
• Do not hallucinate financial numbers.
• Only list items that are actually mentioned. Do not include categories that are not discussed.
• Keep the response structured and easy to read.

Return the result using the exact format:

[SUMMARY]
...

[ENTITIES]
...

[FINANCIAL METRICS]
...

[INSIGHTS]
...

[ACTIONABLE NEXT STEPS]
...

Transcript:
\"\"\"{transcript}\"\"\"
"""

    def generate():
        try:
            stream = groq_client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "You are a financial intelligence assistant that extracts structured insights from transcribed conversations."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                model="llama-3.1-8b-instant",
                stream=True,
            )
            
            full_response = ""
            for chunk in stream:
                if chunk.choices[0].delta.content is not None:
                    content = chunk.choices[0].delta.content
                    full_response += content
                    # Yield as SSE data
                    yield f"data: {json.dumps({'chunk': content})}\n\n"
                    
            # After stream is complete, parse full_response and save to DB
            summary_part = ""
            entities_part = ""
            metrics_part = ""
            insights_part = ""
            next_steps_part = ""
            
            current_section = None
            for line in full_response.split('\n'):
                line = line.strip()
                if line.startswith('[SUMMARY]'):
                    current_section = 'summary'
                elif line.startswith('[ENTITIES]'):
                    current_section = 'entities'
                elif line.startswith('[FINANCIAL METRICS]'):
                    current_section = 'metrics'
                elif line.startswith('[INSIGHTS]'):
                    current_section = 'insights'
                elif line.startswith('[ACTIONABLE NEXT STEPS]'):
                    current_section = 'next_steps'
                else:
                    if current_section == 'summary':
                        summary_part += line + "\n"
                    elif current_section == 'entities':
                        entities_part += line + "\n"
                    elif current_section == 'metrics':
                        metrics_part += line + "\n"
                    elif current_section == 'insights':
                        insights_part += line + "\n"
                    elif current_section == 'next_steps':
                        next_steps_part += line + "\n"

            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute('''
                UPDATE conversations 
                SET summary = ?, entities = ?, metrics = ?, insights = ?, next_steps = ?, status = ?
                WHERE id = ?
            ''', (
                summary_part.strip(), 
                entities_part.strip(), 
                metrics_part.strip(),
                insights_part.strip(), 
                next_steps_part.strip(),
                'analyzed', 
                conv_id
            ))
            conn.commit()
            conn.close()
            
            yield f"data: {json.dumps({'done': True})}\n\n"
            
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(stream_with_context(generate()), mimetype='text/event-stream')

@app.route('/api/conversations', methods=['GET'])
def get_conversations():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM conversations ORDER BY timestamp DESC')
    rows = c.fetchall()
    conn.close()
    
    result = []
    for r in rows:
        result.append(dict(r))
    return jsonify(result)

@app.route('/api/conversations/<conv_id>', methods=['GET'])
def get_conversation(conv_id):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute('SELECT * FROM conversations WHERE id = ?', (conv_id,))
    row = c.fetchone()
    conn.close()
    
    if row:
        return jsonify(dict(row))
    return jsonify({'error': 'Not found'}), 404

@app.route('/api/conversations/<conv_id>', methods=['DELETE'])
def delete_conversation(conv_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    # Get the audio path first to delete the file
    c.execute('SELECT audio_path FROM conversations WHERE id = ?', (conv_id,))
    row = c.fetchone()
    
    if row:
        audio_path = row[0]
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except Exception as e:
                print(f"Error removing file {audio_path}: {e}")
                
        # Delete from DB
        c.execute('DELETE FROM conversations WHERE id = ?', (conv_id,))
        conn.commit()
        conn.close()
        return jsonify({'message': 'Conversation deleted successfully'})
        
    conn.close()
    return jsonify({'error': 'Not found'}), 404

@app.route('/api/conversations/batch', methods=['DELETE'])
def delete_conversations_batch():
    data = request.json
    if not data or 'ids' not in data:
        return jsonify({'error': 'Missing ids'}), 400
        
    ids = data['ids']
    if not isinstance(ids, list) or len(ids) == 0:
        return jsonify({'error': 'Invalid ids'}), 400
        
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    
    placeholders = ','.join(['?'] * len(ids))
    
    # Get audio paths
    c.execute(f'SELECT audio_path FROM conversations WHERE id IN ({placeholders})', ids)
    rows = c.fetchall()
    
    for row in rows:
        audio_path = row[0]
        if audio_path and os.path.exists(audio_path):
            try:
                os.remove(audio_path)
            except Exception as e:
                print(f"Error removing file {audio_path}: {e}")
                
    # Delete from DB
    c.execute(f'DELETE FROM conversations WHERE id IN ({placeholders})', ids)
    conn.commit()
    conn.close()
    
    return jsonify({'message': f'Deleted {len(ids)} conversations successfully'})

from flask import send_file

@app.route('/api/audio/<conv_id>', methods=['GET'])
def get_audio(conv_id):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT audio_path FROM conversations WHERE id = ?', (conv_id,))
    row = c.fetchone()
    conn.close()
    
    if row and row[0] and os.path.exists(row[0]):
        return send_file(row[0])
    
    return jsonify({'error': 'Audio file not found'}), 404

if __name__ == '__main__':
    app.run(debug=True, port=5000)
